import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db } from '@/db'

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
