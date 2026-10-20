'use server'

import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db'
import type { EstadoAccion } from '@/lib/form-state'
import { PASOS, PASOS_DE_PISTA } from '@/lib/pistas'
import { SETTERS_CONFIG_KEY } from '@/lib/setters-config'
import { ErrorDePermiso, exigirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'

/**
 * Escribir el mensaje de un lead.
 *
 * Uno por lead y por paso, a mano, sin plantilla ni variables. Es la decisión
 * de fondo del sistema nuevo: lo que separa un mensaje que funciona de uno que
 * quema la cuenta es que esté escrito para ese negocio, y eso no lo puede
 * hacer una plantilla con `{{negocio}}` adentro.
 *
 * Se puede reescribir todas las veces que haga falta **mientras no haya
 * salido**: una vez mandado, lo que vale es lo que quedó en `messages`, que es
 * el historial real de la conversación.
 */

const schema = z.object({
  assignmentId: z.string().uuid(),
  paso: z.number().int().refine((n) => (PASOS as readonly number[]).includes(n), 'Ese paso no existe.'),
  body: z.string().trim().min(1, 'Escribí el mensaje.').max(2000),
})

export async function guardarTexto(datos: unknown): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const parsed = schema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
    }
    const { assignmentId, paso, body } = parsed.data

    /*
     * Si ese mensaje ya salió no se toca. El setter copió y pegó lo que había
     * en el momento de mandarlo, y dejar que el texto cambie después haría que
     * la pantalla muestre una conversación que nunca ocurrió.
     */
    const salidos = await db.execute(sql`
      select 1 from setter_sends
       where assignment_id = ${assignmentId}::uuid and paso = ${paso} and undone_at is null
       limit 1
    `)
    if (salidos.rows.length > 0) {
      return { ok: false, error: 'Ese mensaje ya salió: no se puede cambiar lo que se mandó.' }
    }

    const leads = await db.execute(sql`
      select contact_id from lead_assignments where id = ${assignmentId}::uuid limit 1
    `)
    const contactId = (leads.rows[0] as { contact_id: string } | undefined)?.contact_id
    if (!contactId) return { ok: false, error: 'Ese lead ya no existe.' }

    await db.execute(sql`
      insert into lead_textos (assignment_id, paso, body, escrito_por)
      values (${assignmentId}::uuid, ${paso}, ${body}, ${sesion.userId}::uuid)
      on conflict (assignment_id, paso) do update
        set body = excluded.body,
            escrito_por = excluded.escrito_por,
            updated_at = now()
    `)

    await db.execute(sql`
      insert into events (type, contact_id, actor_user_id, payload_jsonb)
      values ('texto_escrito', ${contactId}::uuid, ${sesion.userId}::uuid,
              ${JSON.stringify({ paso })}::jsonb)
    `)

    revalidatePath('/textos')
    revalidatePath('/hoy')
    return { ok: true, error: null }
  } catch (err) {
    if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
    console.error('No se pudo guardar el texto del lead.', err)
    return { ok: false, error: 'No se pudo guardar el texto.' }
  }
}

/* ── El texto general de un paso ─────────────────────────────────────────── */

const generalSchema = z.object({
  paso: z
    .number()
    .int()
    .refine((n) => (PASOS_DE_PISTA as readonly number[]).includes(n), 'Ese paso no existe.'),
  /** Vacío borra el general: a partir de ahí el paso vuelve a exigir uno propio. */
  body: z.string().trim().max(2000),
})

/**
 * El mensaje que sale cuando el lead no tiene uno escrito para él.
 *
 * Es el que destraba la cola. Con el texto obligatoriamente propio, cuarenta
 * leads nuevos son cuarenta mensajes que alguien tiene que escribir antes de
 * que el equipo pueda mandar el primero, y mientras eso no pasa la app del
 * setter está bloqueada entera.
 *
 * Guardarlo vacío lo borra, y ese paso vuelve a pedir un texto propio lead por
 * lead. Es a propósito: es la forma de volver al modo anterior sin tocar nada.
 */
export async function guardarTextoGeneral(datos: unknown): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const parsed = generalSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
    }
    const { paso, body } = parsed.data

    const actual = await leerConfigSetters()
    const textoPorPaso = { ...actual.textoPorPaso }
    if (body.length > 0) textoPorPaso[String(paso)] = body
    else delete textoPorPaso[String(paso)]

    await db.execute(sql`
      insert into settings (key, value_jsonb, updated_at)
      values (${SETTERS_CONFIG_KEY}, ${JSON.stringify({ ...actual, textoPorPaso })}::jsonb, now())
      on conflict (key) do update
        set value_jsonb = excluded.value_jsonb, updated_at = now()
    `)

    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('texto_escrito', ${sesion.userId}::uuid,
              ${JSON.stringify({ paso, general: true, borrado: body.length === 0 })}::jsonb)
    `)

    revalidatePath('/textos')
    revalidatePath('/seguimientos')
    revalidatePath('/hoy')
    return { ok: true, error: null }
  } catch (err) {
    if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
    console.error('No se pudo guardar el texto general.', err)
    return { ok: false, error: 'No se pudo guardar el texto general.' }
  }
}
