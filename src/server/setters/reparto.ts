import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db, type Ejecutor } from '@/db'
import { planificarReparto, type CapacidadDeSetter, type PlanDeReparto } from '@/lib/reparto'
import { opsDate } from '@/lib/tz'
import { asignarLeads, barrer, contarPozo } from '@/server/setters/asignacion'

/**
 * Repartir el pozo entre los setters, desde el panel.
 *
 * El reparto a demanda —cada setter tocando "Pedir más leads"— sigue estando y
 * es el que se usa a mitad del día. Esto es lo otro: subís mil cuentas y las
 * mandás a trabajar de una, sin esperar a que cada uno abra la app.
 *
 * Las tres garantías salen de la base, no de acá:
 *
 *   · La misma cuenta de Instagram no entra dos veces (índice único sobre el
 *     usuario en minúsculas, al importar).
 *   · Un lead tiene un solo setter (índice único parcial sobre la asignación).
 *   · Dos repartos simultáneos no se pisan (`for update skip locked`).
 *
 * Lo que decide este archivo es solo **cuántos** le tocan a cada uno.
 */

export interface RepartoPropuesto extends PlanDeReparto {
  /** Leads del pozo sin asignar en este momento. */
  pozo: number
}

/** Capacidad real de cada setter activo, leída de la base. */
async function leerCapacidades(cliente: Ejecutor = db): Promise<CapacidadDeSetter[]> {
  const hoy = opsDate()

  const filas = await cliente.execute(sql`
    select s.id as setter_id, u.name as nombre, s.tanda_diaria,
           u.status = 'activo' as activo,

           -- Cupo que le queda hoy sumando sus cuentas activas. La autoridad es
           -- el recuento de envíos, no el contador guardado en la cuenta.
           coalesce((
             select sum(greatest(sa.cupo_diario - coalesce(e.n, 0), 0))::int
               from setter_accounts sa
               left join (
                 select setter_account_id, count(*)::int as n
                   from setter_sends
                  where ops_date = ${hoy}::date and undone_at is null
                  group by setter_account_id
               ) e on e.setter_account_id = sa.id
              where sa.setter_id = s.id and sa.activa
           ), 0) as cupo_restante,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id
               and la.estado in ('asignado', 'abierto', 'saltado')) as pendientes,

           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id and la.estado = 'contactado'
               and la.segundo_programado_at is not null
               and la.segundo_programado_at <= now()) as seguimientos

      from setters s
      join users u on u.id = s.user_id
     where u.status <> 'baja'
     order by u.name asc
  `)

  return (filas.rows as Array<{
    setter_id: string
    nombre: string
    tanda_diaria: number
    activo: boolean
    cupo_restante: number
    pendientes: number
    seguimientos: number
  }>).map((f) => ({
    setterId: f.setter_id,
    nombre: f.nombre,
    tandaDiaria: f.tanda_diaria,
    activo: f.activo,
    cupoRestante: f.cupo_restante,
    pendientes: f.pendientes,
    seguimientos: f.seguimientos,
  }))
}

/**
 * Qué pasaría si repartiera ahora. No toca nada.
 *
 * Existe para poder mirarlo antes de apretar: entregar leads es difícil de
 * deshacer de a uno, y ver "Bruno 0 porque sus cuentas llegaron al límite"
 * antes que después evita tener que devolverlos al pozo a mano.
 */
export async function proponerReparto(cliente: Db = db): Promise<RepartoPropuesto> {
  await barrer(cliente)
  const capacidades = await leerCapacidades(cliente)
  const pozo = await contarPozo(cliente)
  return { ...planificarReparto(capacidades, pozo), pozo }
}

export interface ResultadoReparto {
  entregados: number
  porSetter: Array<{ nombre: string; cantidad: number }>
  pozoRestante: number
}

/**
 * Reparte de verdad.
 *
 * Todo pasa en una transacción: se recalcula el plan adentro (el pozo pudo
 * moverse entre que se miró y se apretó) y se entregan las tandas una por una.
 * Cada entrega toma sus filas con `skip locked`, así un setter pidiendo leads
 * desde su celular al mismo tiempo no se lleva ninguno de estos.
 */
export async function repartirAhora(
  actorUserId: string | null,
  /** Se inyecta en los tests, que corren contra otra base. */
  cliente: Db = db,
): Promise<ResultadoReparto> {
  await barrer(cliente)

  return cliente.transaction(async (tx) => {
    /*
     * Una detrás de la otra, no en paralelo: una transacción es UNA conexión, y
     * dos consultas lanzadas a la vez sobre la misma conexión se pisan los
     * resultados. Acá eso significaba repartir números inventados.
     */
    const capacidades = await leerCapacidades(tx)
    const pozo = await contarPozo(tx)
    const plan = planificarReparto(capacidades, pozo)

    const porSetter: Array<{ nombre: string; cantidad: number }> = []
    let entregados = 0

    for (const tajada of plan.tajadas) {
      if (tajada.cantidad <= 0) continue
      const n = await asignarLeads(tajada.setterId, tajada.cantidad, actorUserId, tx)
      if (n > 0) {
        porSetter.push({ nombre: tajada.nombre, cantidad: n })
        entregados += n
      }
    }

    return { entregados, porSetter, pozoRestante: Math.max(pozo - entregados, 0) }
  })
}
