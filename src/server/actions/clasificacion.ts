'use server'

import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db'
import type { EstadoAccion } from '@/lib/form-state'
import {
  DESTINOS_DE_CLASIFICACION,
  DESTINO_META,
  trasClasificar,
  type DestinoDeClasificacion,
} from '@/lib/setters-config'
import { ErrorDePermiso, exigirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'

/**
 * Decidir por dónde sigue un lead que contestó la oferta.
 *
 * Es la decisión que el sistema no puede tomar: entre "cuánto sale" y "no me
 * interesa" hay un lead ganado y uno perdido, y de un texto libre no se deduce
 * cuál es. La toma una persona mirando el hilo, y queda sellada con quién fue y
 * cuándo — sin eso no se puede medir el atraso, que es lo único que hace que la
 * cola se vacíe.
 */

const schema = z.object({
  assignmentId: z.string().uuid(),
  destino: z.enum(DESTINOS_DE_CLASIFICACION),
})

/** Qué queda anotado en `interes` según adónde va. */
const INTERES: Record<DestinoDeClasificacion, string | null> = {
  interesado: 'interesa',
  no_interesa: 'no_interesa',
  tibio: 'tibio',
  // Silencio no es una opinión del lead: es que lo que dijo no dijo nada. Se lo
  // trata como si no hubiera contestado, así que no se le inventa un interés.
  silencio: null,
}

export async function clasificarLead(datos: unknown): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const parsed = schema.safeParse(datos)
    if (!parsed.success) return { ok: false, error: 'Revisá los datos.' }
    const { assignmentId, destino } = parsed.data

    const cfg = await leerConfigSetters()
    const siguiente = trasClasificar(cfg, destino)

    /*
     * `clasificado_at is null` en el WHERE no es adorno: dos personas mirando la
     * misma cola pueden tocar el mismo lead, y la segunda pisaría la pista que
     * eligió la primera y le mandaría otro mensaje. Gana quien llega primero.
     */
    const filas = await db.execute(sql`
      update lead_assignments
         set interes = ${INTERES[destino]}::lead_interes,
             clasificado_at = now(),
             clasificado_por = ${sesion.userId}::uuid,
             proximo_paso = ${siguiente.paso},
             proximo_seguimiento_at = ${siguiente.cuando.toISOString()}::timestamptz
       where id = ${assignmentId}::uuid
         and respondio_a = 'segundo'
         and clasificado_at is null
      returning id
    `)

    if (filas.rows.length === 0) {
      return { ok: false, error: 'Ese lead ya lo clasificó alguien.' }
    }

    revalidatePath('/clasificar')
    revalidatePath('/respondieron')
    revalidatePath('/hoy')
    return { ok: true, error: null }
  } catch (err) {
    if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
    console.error('No se pudo clasificar el lead.', err)
    return { ok: false, error: 'No se pudo clasificar el lead.' }
  }
}

/** Las opciones, para que la pantalla no repita los textos del modelo. */
export async function opcionesDeClasificacion(): Promise<
  Array<{ destino: DestinoDeClasificacion; label: string; detalle: string }>
> {
  return DESTINOS_DE_CLASIFICACION.map((d) => ({
    destino: d,
    label: DESTINO_META[d].label,
    detalle: DESTINO_META[d].detalle,
  }))
}
