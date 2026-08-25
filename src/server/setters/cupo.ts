import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
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
