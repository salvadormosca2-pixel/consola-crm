import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db, type Ejecutor } from '@/db'
import { planificarReparto, type CapacidadDeSetter, type PlanDeReparto } from '@/lib/reparto'
import { opsDate, opsTime } from '@/lib/tz'
import { asignarLeads, barrer, contarPozo } from '@/server/setters/asignacion'
import { leerConfigSetters } from '@/server/setters/config'
import { PASOS_CON_CUPO } from '@/server/setters/cupo'

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
           --
           -- El filtro por paso no es opcional: hay pasos que no consumen cupo,
           -- y contarlos acá hacía que el panel le viera menos capacidad de la
           -- que el envío le iba a permitir. El mismo setter recibía de menos
           -- por seguimientos que no le costaban nada.
           coalesce((
             select sum(greatest(sa.cupo_diario - coalesce(e.n, 0), 0))::int
               from setter_accounts sa
               left join (
                 select setter_account_id, count(*)::int as n
                   from setter_sends
                  where ops_date = ${hoy}::date and undone_at is null
                    and paso in (${PASOS_CON_CUPO})
                  group by setter_account_id
               ) e on e.setter_account_id = sa.id
              where sa.setter_id = s.id and sa.activa
           ), 0) as cupo_restante,

           -- Cuántas cuentas prendidas tiene. Sin ninguna, el cero de arriba no
           -- es "llegó al límite" sino "todavía no le cargaron la cuenta".
           (select count(*)::int from setter_accounts sa
             where sa.setter_id = s.id and sa.activa) as cuentas,

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
    cuentas: number
    pendientes: number
    seguimientos: number
  }>).map((f) => ({
    setterId: f.setter_id,
    nombre: f.nombre,
    tandaDiaria: f.tanda_diaria,
    activo: f.activo,
    cupoRestante: f.cupo_restante,
    cuentas: f.cuentas,
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

/* ── El reparto de la mañana, sin depender de un reloj externo ─────────── */

/**
 * Reparte la tanda del día si todavía no salió, y devuelve cuántos entregó.
 *
 * Antes esto vivía solo en `/api/tareas`, que hay que llamar desde afuera. El
 * cron estaba escrito en `vercel.json` y la aplicación corre en Railway, que no
 * lee ese archivo: **nadie llamaba a la ruta y el reparto automático no salía
 * nunca**. El pozo se quedaba lleno y el equipo abría la app con la cola vacía,
 * sin ningún error a la vista que explicara por qué.
 *
 * Ahora se resuelve al leer, igual que el vencimiento de leads: lo dispara la
 * primera pantalla que se abre después de la hora configurada. Con el
 * programador o sin él, el equipo encuentra su tanda puesta.
 *
 * Sale **una sola vez por día** y el candado lo pone la base: la marca del día
 * tiene un índice único, así que si dos setters abren la app en el mismo
 * segundo, uno la inserta y reparte y el otro choca y no hace nada. Contarlo
 * con un `select` antes del `insert` no alcanzaría: entre los dos hay un hueco,
 * y en ese hueco entran dos repartos.
 *
 * Nunca tira: que falle el reparto no puede dejar a alguien sin ver su cola.
 */
export async function repartoAutomaticoDelDia(cliente: Db = db): Promise<number> {
  try {
    const cfg = await leerConfigSetters(cliente)
    if (!cfg.repartoAutomatico) return 0
    if (opsTime() < cfg.horaReparto) return 0

    const hoy = opsDate()

    /*
     * Dos pasos, y los dos hacen falta.
     *
     * El `select` es el que corre casi siempre: esto se llama en cada lectura
     * de cola de cada setter, todo el día, y sin él cada una intentaría un
     * `insert` que choca. Un insert que choca igual escribe y deja basura que
     * después hay que limpiar.
     *
     * El `insert` de abajo es el que decide de verdad. Entre el select y él hay
     * un hueco, y en ese hueco entran dos repartos: por eso el que manda es el
     * índice único, no la consulta.
     */
    const yaSalio = await cliente.execute(sql`
      select 1 from events
       where type = 'leads_asignados'
         and payload_jsonb->>'automatico' = 'true'
         and payload_jsonb->>'dia' = ${hoy}
       limit 1
    `)
    if (yaSalio.rows.length > 0) return 0

    // Tomar el turno. Si la marca ya está, el reparto de hoy ya salió.
    const marca = await cliente.execute(sql`
      insert into events (type, payload_jsonb)
      values ('leads_asignados', ${JSON.stringify({ automatico: true, dia: hoy })}::jsonb)
      on conflict do nothing
      returning id
    `)
    if (marca.rows.length === 0) return 0
    const marcaId = (marca.rows[0] as { id: string }).id

    try {
      const r = await repartirAhora(null, cliente)
      await cliente.execute(sql`
        update events
           set payload_jsonb = payload_jsonb || ${JSON.stringify({ entregados: r.entregados })}::jsonb
         where id = ${marcaId}::uuid
      `)
      return r.entregados
    } catch (err) {
      // Si el reparto falló, la marca se saca: dejarla puesta sería quemar el
      // turno del día y que el equipo se quede sin tanda hasta mañana por un
      // error que quizá ya no está.
      await cliente.execute(sql`delete from events where id = ${marcaId}::uuid`).catch(() => {})
      throw err
    }
  } catch (err) {
    console.error('Falló el reparto automático del día.', err)
    return 0
  }
}
