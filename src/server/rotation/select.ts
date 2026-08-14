import { sql } from 'drizzle-orm'

import type { Db } from '@/db'
import type { Channel } from '@/db/enums'
import type { OpsConfig } from '@/lib/ops-config'

import { rangoDelDiaUtc } from './quota'

/**
 * Selección de cuenta emisora.
 *
 * Distinta de la reserva (reserve.ts) en el tipo de lock, y la diferencia
 * importa:
 *
 *   · Elegir  → FOR UPDATE SKIP LOCKED. Si otra transacción tiene tomada una
 *               candidata, la salteo: cualquier cuenta elegible sirve.
 *   · Reservar → FOR UPDATE a secas. La cuenta ya está decidida y saltearla
 *               sería perder el envío.
 */

export interface CandidataElegida {
  id: string
  code: string
  label: string
  usadoHoy: number
  cupo: number
}

/**
 * Elige la cuenta menos usada hoy y, a igualdad, la que hace más tiempo que no
 * envía. Ese orden genera solo el patrón de rotación pedido, sin llevar un
 * puntero de "próxima cuenta" que se desincroniza.
 *
 * `excluir` sirve para que no salgan dos envíos consecutivos del mismo número.
 */
export async function elegirCuenta(
  db: Db,
  params: {
    channel: Channel
    cfg: OpsConfig
    excluir?: string[]
    ahora?: Date
  },
): Promise<CandidataElegida | null> {
  const ahora = params.ahora ?? new Date()
  const { fecha, desde, hasta } = rangoDelDiaUtc(ahora)
  const excluir = params.excluir ?? []
  const escala = params.cfg.escalaCalentamiento

  const elegir = async (omitir: string[]): Promise<CandidataElegida | null> => {
    const filtroExcluir =
      omitir.length > 0 ? sql`and a.id not in ${sql.raw(`('${omitir.join("','")}')`)}` : sql``

    const r = await db.execute(sql`
      with escala as (
        select ordinality::int as dia, valor::int as cupo
          from unnest(${sql.raw(`array[${escala.join(',')}]`)}::int[]) with ordinality as t(valor, ordinality)
      ),
      real as (
        select account_id, count(*)::int as usado
          from messages
         where status in ('enviado','entregado','leido','respondido')
           and undone_at is null
           and sent_at >= ${desde.toISOString()} and sent_at < ${hasta.toISOString()}
         group by account_id
      )
      select a.id, a.code, a.label,
             coalesce(r.usado, 0) as usado,
             case
               when a.status = 'calentando'
                 then coalesce(
                        (select cupo from escala
                          where dia = least(coalesce(a.warmup_day, 1), ${escala.length})),
                        ${escala[0] ?? 5})
               else a.daily_cap
             end as cupo
        from messaging_accounts a
        left join real r on r.account_id = a.id
       where a.channel = ${params.channel}
         and a.status in ('activa', 'calentando')
         ${filtroExcluir}
         -- El cupo se vuelve a verificar bajo lock en la reserva; acá solo se
         -- descartan las que evidentemente no tienen lugar. Se usa el mismo
         -- techo que la reserva (cupo menos el colchón de Chatwoot): si acá se
         -- usara el cupo pelado, el selector ofrecería cuentas que después la
         -- reserva rechaza.
         and coalesce(r.usado, 0) < greatest(1, case
               when a.status = 'calentando'
                 then coalesce(
                        (select cupo from escala
                          where dia = least(coalesce(a.warmup_day, 1), ${escala.length})),
                        ${escala[0] ?? 5})
               else a.daily_cap
             end - ${params.cfg.colchonParaRespuestas})
         -- Espera mínima cumplida. Tiene que calcularse igual que en la reserva
         -- (esperaMinimaSeg de quota.ts): si acá se usara un valor más chico, el
         -- selector ofrecería cuentas que después la reserva rechaza.
         and (a.last_sent_at is null
              or a.last_sent_at < ${ahora.toISOString()}::timestamptz
                 - make_interval(secs => case
                     when a.status = 'calentando' then greatest(
                       ${params.cfg.calentamientoEsperaMinimaSeg},
                       floor(
                         extract(epoch from (a.window_end - a.window_start))
                         / greatest(coalesce(
                             (select cupo from escala
                               where dia = least(coalesce(a.warmup_day, 1), ${escala.length})),
                             ${escala[0] ?? 5}), 1)
                       )
                     )
                     else greatest(a.min_gap_seconds, ${params.cfg.esperaMismaCuentaSeg})
                   end))
       order by coalesce(r.usado, 0) asc, a.last_sent_at asc nulls first, a.code asc
       limit 1
       for update of a skip locked
    `)

    const fila = r.rows[0] as
      | { id: string; code: string; label: string; usado: number; cupo: number }
      | undefined
    if (!fila) return null
    return { id: fila.id, code: fila.code, label: fila.label, usadoHoy: fila.usado, cupo: fila.cupo }
  }

  const conExclusion = await elegirCuentaSegura(elegir, excluir)
  if (conExclusion) return conExclusion

  // Si excluir dejó el conjunto vacío, mejor repetir cuenta que no mandar:
  // "nunca dos consecutivos" es una preferencia, mandar es el objetivo.
  if (excluir.length > 0) return elegirCuentaSegura(elegir, [])

  void fecha
  return null
}

async function elegirCuentaSegura(
  elegir: (omitir: string[]) => Promise<CandidataElegida | null>,
  omitir: string[],
): Promise<CandidataElegida | null> {
  // Los ids vienen de la base, pero se validan igual antes de interpolarlos.
  const limpios = omitir.filter((x) => /^[0-9a-f-]{36}$/i.test(x))
  return elegir(limpios)
}

/**
 * Intercala una cola de contactos para que dos envíos consecutivos no salgan de
 * la misma cuenta.
 *
 * Acá se resuelve la contradicción entre "nunca dos consecutivos de la misma
 * cuenta" y "cuenta pegada al contacto": no se cambia el emisor, se cambia el
 * orden. Si no hay con qué intercalar, gana la cuenta pegada — cambiarle el
 * número a un cliente que ya vio otro es peor que dos envíos seguidos.
 */
export function intercalarPorCuenta<T>(items: T[], cuentaDe: (item: T) => string | null): T[] {
  if (items.length <= 1) return [...items]

  // Agrupa preservando el orden de prioridad original dentro de cada cuenta.
  const grupos = new Map<string, T[]>()
  for (const item of items) {
    const k = cuentaDe(item) ?? '__sin_cuenta__'
    const g = grupos.get(k)
    if (g) g.push(item)
    else grupos.set(k, [item])
  }

  const salida: T[] = []
  let ultima: string | null = null

  while (salida.length < items.length) {
    // De las cuentas que todavía tienen pendientes, se toma la que más tiene,
    // salteando la última usada. Así ninguna queda amontonada al final.
    let elegida: string | null = null
    let mayor = -1
    for (const [k, g] of grupos) {
      if (g.length === 0 || k === ultima) continue
      if (g.length > mayor) {
        mayor = g.length
        elegida = k
      }
    }

    // Solo queda la última usada: se repite, que es mejor que no mandar.
    if (elegida === null) {
      for (const [k, g] of grupos) {
        if (g.length > 0) {
          elegida = k
          break
        }
      }
    }
    if (elegida === null) break

    const grupo = grupos.get(elegida)
    const siguiente = grupo?.shift()
    if (siguiente !== undefined) salida.push(siguiente)
    ultima = elegida
  }

  return salida
}
