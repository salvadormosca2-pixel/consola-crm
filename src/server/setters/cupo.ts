import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import { PASOS_QUE_CONSUMEN_CUPO } from '@/lib/pistas'
import { leerCupo, type CuentaDeSetter, type EstadoDeCupo } from '@/lib/setters-cupo'
import { opsDate } from '@/lib/tz'

/**
 * Cuánto le queda a cada cuenta de Instagram del setter, hoy.
 *
 * El número de "enviados hoy" se **recuenta** desde `setter_sends`; la columna
 * `enviados_hoy` de la cuenta es solo caché para mostrar en el panel. Un
 * contador guardado se desincroniza con un deshacer, con un reintento o con un
 * cambio de día a mitad de jornada; un recuento no.
 */

/**
 * Los pasos que descuentan cupo, como lista para un `in (...)`.
 *
 * Se arma con `sql.join` y no interpolando el array: drizzle bindea un array
 * como un solo parámetro, y `paso in $1` no es SQL válido.
 *
 * Todas las cuentas de cupo tienen que usar este mismo filtro. Si una lo usara
 * y otra no, el panel diría un número y el envío rebotaría con otro.
 */
export const PASOS_CON_CUPO = sql.join(
  PASOS_QUE_CONSUMEN_CUPO.map((p) => sql`${p}`),
  sql`, `,
)

export interface CupoDeSetter extends EstadoDeCupo {
  setterId: string
  tandaDiaria: number
}

export async function leerCupoDeSetter(setterId: string): Promise<CupoDeSetter> {
  const hoy = opsDate()

  const filas = await db.execute(sql`
    select sa.id, sa.ig_username, sa.cupo_diario, sa.orden, sa.activa,
           coalesce(u.n, 0) as enviados_hoy,
           s.cuenta_activa_id, s.tanda_diaria
      from setters s
      left join setter_accounts sa on sa.setter_id = s.id
      left join (
        select setter_account_id, count(*)::int as n
          from setter_sends
         where ops_date = ${hoy}::date and undone_at is null
           and paso in (${PASOS_CON_CUPO})
         group by setter_account_id
      ) u on u.setter_account_id = sa.id
     where s.id = ${setterId}::uuid
     order by sa.orden asc, sa.ig_username asc
  `)

  type Fila = {
    id: string | null
    ig_username: string | null
    cupo_diario: number | null
    orden: number | null
    activa: boolean | null
    enviados_hoy: number
    cuenta_activa_id: string | null
    tanda_diaria: number
  }

  const rows = filas.rows as unknown as Fila[]
  const primera = rows[0]

  const cuentas: CuentaDeSetter[] = rows
    .filter((f) => f.id !== null)
    .map((f) => ({
      id: f.id!,
      igUsername: f.ig_username!,
      cupoDiario: f.cupo_diario!,
      enviadosHoy: f.enviados_hoy,
      orden: f.orden ?? 1,
      activa: f.activa ?? true,
    }))

  return {
    ...leerCupo(cuentas, primera?.cuenta_activa_id ?? null),
    setterId,
    tandaDiaria: primera?.tanda_diaria ?? 60,
  }
}

/** Cupo de varios setters de una sola consulta, para el tablero del día. */
export async function leerCuposDelEquipo(): Promise<Map<string, CupoDeSetter>> {
  const hoy = opsDate()

  const filas = await db.execute(sql`
    select s.id as setter_id, s.cuenta_activa_id, s.tanda_diaria,
           sa.id, sa.ig_username, sa.cupo_diario, sa.orden, sa.activa,
           coalesce(u.n, 0) as enviados_hoy
      from setters s
      left join setter_accounts sa on sa.setter_id = s.id
      left join (
        select setter_account_id, count(*)::int as n
          from setter_sends
         where ops_date = ${hoy}::date and undone_at is null
           and paso in (${PASOS_CON_CUPO})
         group by setter_account_id
      ) u on u.setter_account_id = sa.id
     order by s.id, sa.orden asc, sa.ig_username asc
  `)

  type Fila = {
    setter_id: string
    cuenta_activa_id: string | null
    tanda_diaria: number
    id: string | null
    ig_username: string | null
    cupo_diario: number | null
    orden: number | null
    activa: boolean | null
    enviados_hoy: number
  }

  const porSetter = new Map<string, { activaId: string | null; tanda: number; cuentas: CuentaDeSetter[] }>()

  for (const f of filas.rows as unknown as Fila[]) {
    const entrada = porSetter.get(f.setter_id) ?? {
      activaId: f.cuenta_activa_id,
      tanda: f.tanda_diaria,
      cuentas: [],
    }
    if (f.id) {
      entrada.cuentas.push({
        id: f.id,
        igUsername: f.ig_username!,
        cupoDiario: f.cupo_diario!,
        enviadosHoy: f.enviados_hoy,
        orden: f.orden ?? 1,
        activa: f.activa ?? true,
      })
    }
    porSetter.set(f.setter_id, entrada)
  }

  const salida = new Map<string, CupoDeSetter>()
  for (const [setterId, { activaId, tanda, cuentas }] of porSetter) {
    salida.set(setterId, {
      ...leerCupo(cuentas, activaId),
      setterId,
      tandaDiaria: tanda,
    })
  }
  return salida
}

/**
 * El cupo de todo el equipo hoy, en un número.
 *
 * Lo mira el panel de pistas, y solo por una: el reintento de apertura es la
 * única que gasta cupo, porque el chat nunca se abrió. Poner el número al lado
 * de esa escalera es lo que hace visible que agregarle un escalón no sale
 * gratis — sale del mismo cupo con el que se abren leads nuevos.
 */
export async function cupoDelDia(): Promise<{ total: number; restante: number }> {
  const hoy = opsDate()

  const filas = await db.execute(sql`
    select coalesce(sum(sa.cupo_diario), 0)::int as total,
           coalesce(sum(greatest(sa.cupo_diario - coalesce(u.n, 0), 0)), 0)::int as restante
      from setter_accounts sa
      left join (
        select setter_account_id, count(*)::int as n
          from setter_sends
         where ops_date = ${hoy}::date and undone_at is null
           and paso in (${PASOS_CON_CUPO})
         group by setter_account_id
      ) u on u.setter_account_id = sa.id
     where sa.activa
  `)

  const f = filas.rows[0] as { total: number; restante: number } | undefined
  return { total: f?.total ?? 0, restante: f?.restante ?? 0 }
}
