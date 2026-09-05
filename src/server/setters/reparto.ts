import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db, type Ejecutor } from '@/db'
import {
  capacidadDe,
  planificarReparto,
  type CapacidadDeSetter,
  type PlanDeReparto,
} from '@/lib/reparto'
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

           -- Estrenó su acceso: entró alguna vez y ya cambió la contraseña del
           -- alta. Las dos condiciones, no una: con la temporal la pantalla no
           -- lo deja pasar de la de cambio, así que "entró" a secas no alcanza
           -- para decir que puede trabajar.
           (u.last_login_at is not null and not u.must_change_password) as entro,

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
    entro: boolean
    cupo_restante: number
    cuentas: number
    pendientes: number
    seguimientos: number
  }>).map((f) => ({
    setterId: f.setter_id,
    nombre: f.nombre,
    tandaDiaria: f.tanda_diaria,
    activo: f.activo,
    entro: f.entro,
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
  /** Leads que volvieron al pozo por estar en manos de alguien que no entró. */
  recuperados: number
  pozoRestante: number
}

/**
 * Devuelve al pozo los leads de quien todavía no estrenó su acceso.
 *
 * Es la contracara de no repartirle: los que ya se le habían entregado antes de
 * esta regla —o los de alguien a quien se le restableció la contraseña y todavía
 * no volvió a entrar— están tomados en una cola que nadie puede abrir. Ahí no se
 * trabajan y encima no los ve nadie más: vuelven al pozo, y cuando la persona
 * estrene su acceso los recibe de nuevo en el acto.
 */
async function devolverLoDeLosQueNoEntraron(
  cliente: Ejecutor,
  actorUserId: string | null,
): Promise<number> {
  const filas = await cliente.execute(sql`
    update lead_assignments la
       set estado = 'devuelto', devuelto_at = now(),
           devuelto_motivo = 'Todavía no estrenó su acceso.'
      from setters s
      join users u on u.id = s.user_id
     where la.setter_id = s.id
       and la.estado in ('asignado', 'abierto', 'saltado')
       and (u.last_login_at is null or u.must_change_password)
    returning la.id
  `)

  const recuperados = filas.rows.length
  if (recuperados > 0) {
    await cliente.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('lead_devuelto', ${actorUserId}::uuid,
              ${JSON.stringify({ cantidad: recuperados, motivo: 'Todavía no estrenó su acceso.' })}::jsonb)
    `)
  }
  return recuperados
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
    // Antes de repartir, se recupera lo que está tomado por quien no puede
    // trabajarlo. Van juntas a propósito: si no, el pozo se mide sin esos leads
    // y el reparto entrega de menos.
    const recuperados = await devolverLoDeLosQueNoEntraron(tx, actorUserId)

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

    return { entregados, porSetter, recuperados, pozoRestante: Math.max(pozo - entregados, 0) }
  })
}

/**
 * La primera tanda del que acaba de estrenar su acceso.
 *
 * Se llama en el momento en que cambia la contraseña del alta, que es cuando
 * pasa a poder trabajar. Sin esto, el que entra a las nueve de la mañana con el
 * reparto del día ya salido abre la app y encuentra la cola vacía: tendría que
 * esperar hasta mañana para empezar, o depender de que un admin apriete
 * "Repartir ahora". Con esto, entra y su cola está puesta.
 *
 * No es un reparto aparte ni saltea ningún límite: le entrega lo que su propia
 * capacidad del día permite —su tanda menos lo que ya tenga, y nunca más que el
 * cupo de sus cuentas—, exactamente lo mismo que le habría tocado.
 */
export async function repartirAEsteSetter(
  setterId: string,
  actorUserId: string | null,
  cliente: Db = db,
): Promise<number> {
  await barrer(cliente)

  return cliente.transaction(async (tx) => {
    const capacidades = await leerCapacidades(tx)
    const suyo = capacidades.find((c) => c.setterId === setterId)
    if (!suyo) return 0

    const { capacidad } = capacidadDe(suyo)
    if (capacidad <= 0) return 0

    const pozo = await contarPozo(tx)
    if (pozo <= 0) return 0

    return asignarLeads(setterId, Math.min(capacidad, pozo), actorUserId, tx)
  })
}

/**
 * Por qué este setter no tiene nada para contactar.
 *
 * Nace de un caso concreto: un setter abrió la app, vio "0 leads asignados" y
 * no había forma de saber si el pozo estaba vacío, si su cuenta estaba apagada
 * o si ya había llegado a su tanda. La respuesta existía —la calcula
 * `capacidadDe` para el panel del admin— pero no llegaba al celular de la
 * persona que tenía el problema adelante.
 *
 * Devuelve `null` cuando **sí puede recibir y hay pozo**: ahí no hay nada que
 * explicar, el botón de pedir leads alcanza.
 */
export async function motivoSinLeads(
  setterId: string,
  cliente: Ejecutor = db,
): Promise<string | null> {
  const capacidades = await leerCapacidades(cliente)
  const suyo = capacidades.find((c) => c.setterId === setterId)
  if (!suyo) return null

  const { capacidad, paraElSetter } = capacidadDe(suyo)
  if (capacidad <= 0) return paraElSetter

  // Puede recibir, así que lo que falta está del otro lado.
  const pozo = await contarPozo(cliente)
  if (pozo <= 0) {
    return 'No quedan leads sin asignar en el sistema. Avisale al administrador que cargue más.'
  }

  return null
}

/**
 * Repone la cola cuando el setter saltea un lead.
 *
 * Saltear es "este ahora no": el lead se va al final de la cola de hoy y vuelve
 * mañana. Pero mientras tanto sigue ocupando lugar, y el setter se quedaba con
 * la cola trabada — abría la app, salteaba los cuatro que no podía hacer, y le
 * quedaban cuatro huecos que nadie llenaba hasta el día siguiente. Con cupo
 * libre sin usar, que es lo caro.
 *
 * La regla: **la cola tiene que tener tanto trabajo como cupo le quede hoy**,
 * sin contar los salteados. Cada salteo repone uno del pozo hasta llegar a ese
 * número, y ni uno más: entregarle leads por encima de lo que puede mandar hoy
 * es sacarlos del pozo para congelarlos 48 horas.
 */
export async function reponerTrasSaltear(
  setterId: string,
  actorUserId: string | null,
  cliente: Db = db,
): Promise<number> {
  return cliente.transaction(async (tx) => {
    const capacidades = await leerCapacidades(tx)
    const suyo = capacidades.find((c) => c.setterId === setterId)
    if (!suyo || !suyo.activo || !suyo.entro || suyo.cuentas === 0) return 0

    const filas = await tx.execute(sql`
      select count(*)::int as n from lead_assignments
       where setter_id = ${setterId}::uuid and estado in ('asignado', 'abierto')
    `)
    const trabajables = (filas.rows[0] as { n: number }).n

    if (trabajables >= suyo.cupoRestante) return 0

    return asignarLeads(setterId, 1, actorUserId, tx)
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
