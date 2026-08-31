import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Ejecutor } from '@/db'
import { calcularVencimiento } from '@/lib/setters-config'
import { leerConfigSetters } from '@/server/setters/config'
import { OPS_TZ } from '@/lib/tz'

/**
 * De quién es cada lead.
 *
 * Tres reglas gobiernan todo este archivo:
 *
 *   · **Exclusiva.** Un lead lo tiene un solo setter. Dos setters escribiéndole
 *     al mismo negocio es exactamente lo que hace que parezcas spam. Lo
 *     garantiza un índice único parcial en la base, no una consulta.
 *   · **Al azar.** El reparto no sigue el orden de la lista. Con muestras
 *     aleatorias, las tasas de respuesta de dos setters son comparables, y ahí
 *     se ve quién necesita ayuda con el mensaje y qué cuenta está restringida.
 *   · **Vencimiento.** Un lead asignado y no trabajado vuelve solo al pozo a
 *     las 48 h. Es lo único que impide que un lead quede muerto en la cuenta de
 *     alguien que se cansó o dejó de trabajar.
 */

/**
 * Pone al día lo que depende del reloj.
 *
 * Se llama al abrir la cola del setter y al abrir el tablero del admin, en vez
 * de depender de una tarea programada: así el vencimiento funciona igual en una
 * máquina sin cron, y el resultado es el mismo se mire cuando se mire. Las dos
 * operaciones son idempotentes y van por índice.
 */
export async function barrer(
  cliente: Ejecutor = db,
): Promise<{ vencidos: number; desalteados: number }> {
  /*
   * Vencer y registrarlo, en una sola sentencia.
   *
   * Va con CTE y no con dos consultas por dos motivos. Uno: es atómico — no
   * puede quedar el lead vencido sin su línea en la bitácora si algo falla en
   * el medio. Dos: `barrer()` corre en cada carga de la cola del setter y del
   * tablero del admin, así que un viaje de más se paga muchas veces por día.
   *
   * El evento va sin actor porque no lo hizo nadie: es lo único que le pasa a
   * un lead por el reloj. Antes no se registraba, y un negocio podía pasar por
   * tres setters sin dejar una sola línea que explicara por qué.
   */
  const vencidos = await cliente.execute(sql`
    with caducados as (
      update lead_assignments
         set estado = 'vencido', devuelto_at = now(),
             devuelto_motivo = 'Pasaron las horas sin trabajarlo y volvió al pozo.'
       where estado in ('asignado', 'abierto', 'saltado')
         and vence_at <= now()
      returning id, contact_id, setter_id
    ), registro as (
      insert into events (type, contact_id, payload_jsonb)
      select 'lead_vencido', c.contact_id,
             jsonb_build_object('setterId', c.setter_id, 'assignmentId', c.id)
        from caducados c
    )
    select id from caducados
  `)

  // Saltear deja el lead para el final de la cola de HOY, no lo saca de la cola.
  // Al día siguiente vuelve a estar como cualquier otro.
  const desalteados = await cliente.execute(sql`
    update lead_assignments
       set estado = 'asignado', pospuesto_at = null
     where estado = 'saltado'
       and (pospuesto_at at time zone ${OPS_TZ})::date < (now() at time zone ${OPS_TZ})::date
    returning id
  `)

  return { vencidos: vencidos.rows.length, desalteados: desalteados.rows.length }
}

/**
 * Entrega una tanda de leads del pozo a un setter.
 *
 * El `skip locked` y el índice único hacen que dos setters pidiendo leads al
 * mismo tiempo nunca se lleven el mismo negocio: el segundo salta la fila
 * tomada en vez de esperarla o de duplicarla.
 */
export async function asignarLeads(
  setterId: string,
  cantidad: number,
  actorUserId: string | null,
  cliente: Ejecutor = db,
): Promise<number> {
  if (cantidad <= 0) return 0
  const cfg = await leerConfigSetters(cliente)
  const vence = calcularVencimiento(cfg)

  const filas = await cliente.execute(sql`
    with elegidos as (
      select c.id
        from contacts c
       where c.origen = 'scrapeado'
         and c.discarded_at is null
         and c.ig_username is not null
         and c.stage in ('nuevo', 'encolado')
         and not exists (
           select 1 from lead_assignments la
            where la.contact_id = c.id
              and la.estado not in ('vencido', 'devuelto')
         )
       -- Al azar, no por orden de lista: es lo que hace comparables las tasas
       -- de respuesta entre setters.
       order by random()
       limit ${cantidad}
       for update of c skip locked
    )
    insert into lead_assignments (contact_id, setter_id, vence_at)
    select id, ${setterId}::uuid, ${vence.toISOString()}::timestamptz from elegidos
    on conflict do nothing
    returning id
  `)

  const asignados = filas.rows.length
  if (asignados > 0) {
    await cliente.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('leads_asignados', ${actorUserId}::uuid,
              ${JSON.stringify({ setterId, cantidad: asignados })}::jsonb)
    `)
  }
  return asignados
}

/** Cuántos leads quedan sin dueño en el pozo. */
export async function contarPozo(cliente: Ejecutor = db): Promise<number> {
  const filas = await cliente.execute(sql`
    select count(*)::int as n
      from contacts c
     where c.origen = 'scrapeado'
       and c.discarded_at is null
       and c.ig_username is not null
       and c.stage in ('nuevo', 'encolado')
       and not exists (
         select 1 from lead_assignments la
          where la.contact_id = c.id and la.estado not in ('vencido', 'devuelto')
       )
  `)
  return (filas.rows[0] as { n: number } | undefined)?.n ?? 0
}

/**
 * Devuelve al pozo los leads sin contactar de un setter.
 *
 * Los que ya contactó NO se tocan: quedan con su nombre, porque la comisión se
 * liquida sobre lo que trabajó, aunque se haya ido.
 */
export async function devolverPendientes(
  setterId: string,
  motivo: string,
  actorUserId: string | null,
  cliente: Ejecutor = db,
): Promise<number> {
  const filas = await cliente.execute(sql`
    update lead_assignments
       set estado = 'devuelto', devuelto_at = now(), devuelto_motivo = ${motivo}
     where setter_id = ${setterId}::uuid
       and estado in ('asignado', 'abierto', 'saltado')
    returning id
  `)

  const devueltos = filas.rows.length
  if (devueltos > 0) {
    await cliente.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('lead_devuelto', ${actorUserId}::uuid,
              ${JSON.stringify({ setterId, cantidad: devueltos, motivo })}::jsonb)
    `)
  }
  return devueltos
}

/** Devuelve un lead puntual al pozo. */
export async function devolverLead(
  assignmentId: string,
  motivo: string,
  actorUserId: string | null,
): Promise<boolean> {
  const filas = await db.execute(sql`
    update lead_assignments
       set estado = 'devuelto', devuelto_at = now(), devuelto_motivo = ${motivo}
     where id = ${assignmentId}::uuid
       and estado in ('asignado', 'abierto', 'saltado')
    returning contact_id
  `)
  if (filas.rows.length === 0) return false

  const contactId = (filas.rows[0] as { contact_id: string }).contact_id
  await db.execute(sql`
    insert into events (type, contact_id, actor_user_id, payload_jsonb)
    values ('lead_devuelto', ${contactId}::uuid, ${actorUserId}::uuid,
            ${JSON.stringify({ motivo })}::jsonb)
  `)
  return true
}

/**
 * Pasa un lead de un setter a otro.
 *
 * Se devuelve el actual y se crea uno nuevo, en la misma transacción. No se
 * edita la asignación vieja: el historial de por quién pasó cada lead es lo
 * que después explica una tasa de respuesta rara.
 */
export async function reasignarLead(
  assignmentId: string,
  destinoSetterId: string,
  actorUserId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await leerConfigSetters()
  const vence = calcularVencimiento(cfg)

  try {
    return await db.transaction(async (tx) => {
      const previas = await tx.execute(sql`
        update lead_assignments
           set estado = 'devuelto', devuelto_at = now(),
               devuelto_motivo = 'Reasignado a otro setter.'
         where id = ${assignmentId}::uuid
           and estado in ('asignado', 'abierto', 'saltado')
        returning contact_id, setter_id
      `)

      const previa = previas.rows[0] as { contact_id: string; setter_id: string } | undefined
      if (!previa) {
        return { ok: false, error: 'Ese lead ya no está sin trabajar: no se puede reasignar.' }
      }

      await tx.execute(sql`
        insert into lead_assignments (contact_id, setter_id, vence_at)
        values (${previa.contact_id}::uuid, ${destinoSetterId}::uuid, ${vence.toISOString()}::timestamptz)
      `)

      await tx.execute(sql`
        insert into events (type, contact_id, actor_user_id, payload_jsonb)
        values ('lead_reasignado', ${previa.contact_id}::uuid, ${actorUserId}::uuid,
                ${JSON.stringify({ desde: previa.setter_id, hasta: destinoSetterId })}::jsonb)
      `)

      return { ok: true }
    })
  } catch (err) {
    console.error('Error al reasignar el lead:', err)
    return { ok: false, error: 'No se pudo reasignar. Puede que otro setter ya lo tenga.' }
  }
}
