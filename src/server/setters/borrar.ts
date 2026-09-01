import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db, type Ejecutor } from '@/db'

/**
 * Borrar a un setter, de verdad.
 *
 * Dar de baja y borrar contestan dos preguntas distintas y por eso conviven:
 *
 *   · **Dar de baja** es "no trabaja más acá". La persona existió, mandó
 *     mensajes, consiguió reuniones, y alguna de esas reuniones se va a cerrar
 *     el mes que viene. Su fila se queda para siempre porque es de donde sale
 *     de quién fue cada venta.
 *   · **Borrar** es "esta alta nunca tendría que haber existido": el mail con
 *     un error de tipeo, la persona que al final no entró, los cuatro que
 *     quedaron de más en un alta por lote. No hay historial que perder porque
 *     no hay historial, y dejarlos de baja para siempre es ensuciar el padrón
 *     con gente que nunca trabajó.
 *
 * La línea entre las dos no la decide quien aprieta el botón: la decide si el
 * setter tocó algo. En cuanto mandó un mensaje, consiguió una reunión o alguien
 * le contestó, borrar deja de estar disponible y la respuesta pasa a ser la
 * baja. Sin esa regla, un click de más borra la comisión de un mes.
 */

/**
 * Qué cuenta como "ya trabajó". Se escribe una sola vez y se usa en los dos
 * lados —la ficha, para saber si mostrar el botón, y el borrado, para negarse—
 * porque si los dos criterios se separan aparece el botón que siempre falla.
 *
 * Espera la tabla `setters` aliaseada como `s`.
 */
export const HISTORIAL_DEL_SETTER = sql`(
  (select count(*)::int from setter_sends ss where ss.setter_id = s.id)
  + (select count(*)::int from meetings m where m.setter_id = s.id)
  + (select count(*)::int from lead_assignments la
      where la.setter_id = s.id and la.respondido_at is not null)
)`

export type ResultadoBorrado = { ok: true; nombre: string } | { ok: false; error: string }

export async function borrarSetter(
  setterId: string,
  actorUserId: string | null,
  cliente: Db = db,
): Promise<ResultadoBorrado> {
  const filas = await cliente.execute(sql`
    select s.user_id, u.name, u.email, u.role,
           ${HISTORIAL_DEL_SETTER} as historial,
           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id
               and la.estado in ('asignado', 'abierto', 'saltado')) as pendientes
      from setters s
      join users u on u.id = s.user_id
     where s.id = ${setterId}::uuid
     limit 1
  `)

  const f = filas.rows[0] as
    | {
        user_id: string
        name: string
        email: string
        role: string
        historial: number
        pendientes: number
      }
    | undefined

  if (!f) return { ok: false, error: 'Ese setter ya no existe.' }

  // La ficha de un admin se abre por la misma pantalla. Borrar desde acá al que
  // reparte los leads sería un click de distancia del que borra un alta mal
  // cargada, y no son la misma decisión.
  if (f.role !== 'setter') {
    return { ok: false, error: 'Esa cuenta no es la de un setter: desde acá no se borra.' }
  }

  if (f.historial > 0) {
    return {
      ok: false,
      error: `${f.name} ya trabajó leads: borrarlo sería perder de quién fue cada mensaje y cada reunión. Dale de baja y su historial queda.`,
    }
  }

  await cliente.transaction(async (tx) => {
    // El evento va ANTES del borrado: después no queda de dónde sacar el nombre
    // ni el mail, y una cuenta que desaparece sin dejar rastro en la bitácora es
    // justo lo que no se quiere en un padrón de accesos.
    await tx.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('setter_eliminado', ${actorUserId}::uuid,
              ${JSON.stringify({
                setterId,
                nombre: f.name,
                email: f.email,
                liberados: f.pendientes,
              })}::jsonb)
    `)

    // Se borra el usuario, no la fila de `setters`: la ficha cuelga del usuario
    // con `on delete cascade`, y borrar solo la ficha dejaría el acceso vivo sin
    // aparecer en ninguna lista, que es la forma clásica de dejar a alguien
    // adentro sin querer. Con el usuario se van sus cuentas de Instagram y las
    // asignaciones que todavía no tocó, así que esos leads vuelven al pozo solos.
    await tx.execute(sql`
      delete from users where id = ${f.user_id}::uuid and role = 'setter'
    `)
  })

  return { ok: true, nombre: f.name }
}

/* ── Vaciar el equipo entero ──────────────────────────────────────────── */

export interface ResumenDelVaciado {
  /** Cuentas de setter que se borran. Los admins no se tocan nunca. */
  setters: number
  /** Leads que vuelven al pozo como si nadie los hubiera tocado. */
  alPozo: number
  /**
   * Leads que contestaron o que tienen una reunión. No vuelven al pozo —no son
   * leads fríos— pero pierden la asignación, que se va con el setter. Su ficha,
   * sus mensajes y sus reuniones quedan.
   */
  conRespuesta: number
  /** Envíos registrados que se borran con ellos. */
  envios: number
}

const CONTACTO_QUE_VUELVE = sql`
  c.origen = 'scrapeado'
  and c.discarded_at is null
  and exists (select 1 from lead_assignments la where la.contact_id = c.id)
  and not exists (
    select 1 from lead_assignments la
     where la.contact_id = c.id and la.respondido_at is not null
  )
  and not exists (select 1 from meetings m where m.contact_id = c.id)
`

/** Lo que va a pasar, antes de que pase. Es lo que se muestra en pantalla. */
export async function contarParaVaciar(cliente: Ejecutor = db): Promise<ResumenDelVaciado> {
  const filas = await cliente.execute(sql`
    select
      (select count(*)::int from users where role = 'setter') as setters,
      (select count(*)::int from contacts c where ${CONTACTO_QUE_VUELVE}) as al_pozo,
      (select count(*)::int from contacts c
        where exists (select 1 from lead_assignments la where la.contact_id = c.id)
          and not (${CONTACTO_QUE_VUELVE})) as con_respuesta,
      (select count(*)::int from setter_sends where undone_at is null) as envios
  `)
  const f = filas.rows[0] as
    | { setters: number; al_pozo: number; con_respuesta: number; envios: number }
    | undefined

  return {
    setters: f?.setters ?? 0,
    alPozo: f?.al_pozo ?? 0,
    conRespuesta: f?.con_respuesta ?? 0,
    envios: f?.envios ?? 0,
  }
}

/**
 * Borrar el equipo entero y devolver los leads al pozo.
 *
 * Es para arrancar de cero: se probó con un equipo de prueba, o se subió mal la
 * lista, y lo que viene ahora es gente nueva. Borra **todas** las cuentas de
 * setter —los admins no, nunca— con sus fichas, sus cuentas de Instagram, sus
 * asignaciones y sus envíos.
 *
 * Los leads no se borran: se limpian. El que nadie contestó y no tiene reunión
 * vuelve a estar como recién importado —sin dueño, sin contador de envíos, en
 * estado nuevo— y por lo tanto vuelve al pozo para el próximo reparto. El que
 * contestó o consiguió una reunión NO vuelve: no es un lead frío, y ponerlo de
 * nuevo en la ruleta sería mandarle un primer mensaje a alguien con quien ya
 * hay una conversación abierta. Ese conserva su ficha, sus mensajes y sus
 * reuniones; lo único que pierde es la asignación, que se va con el setter.
 */
export async function vaciarElEquipo(
  actorUserId: string | null,
  cliente: Db = db,
): Promise<ResumenDelVaciado> {
  const resumen = await contarParaVaciar(cliente)

  await cliente.transaction(async (tx) => {
    // Primero los contactos: se eligen por sus asignaciones, y en dos líneas
    // más las asignaciones no van a existir.
    await tx.execute(sql`
      update contacts c
         set stage = 'nuevo'::contact_stage,
             setter_id = null,
             sent_count = 0,
             sequence_step = 0,
             last_outbound_at = null,
             next_followup_at = null,
             updated_at = now()
       where ${CONTACTO_QUE_VUELVE}
    `)

    // `setter_sends` referencia a `setter_accounts` con `on delete restrict`, a
    // propósito: sin esto, borrar una cuenta de Instagram se llevaría puesto el
    // recuento del cupo. Acá se va todo junto, así que se borra a mano y en
    // orden en vez de esperar una cascada que la base va a frenar.
    await tx.execute(sql`delete from setter_sends`)

    // El resto —fichas, cuentas de Instagram, asignaciones, recordatorios,
    // avisos recibidos, suscripciones push— cuelga del usuario y cae solo.
    await tx.execute(sql`delete from users where role = 'setter'`)

    await tx.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('equipo_vaciado', ${actorUserId}::uuid, ${JSON.stringify(resumen)}::jsonb)
    `)
  })

  return resumen
}
