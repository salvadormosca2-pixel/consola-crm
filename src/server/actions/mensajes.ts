'use server'

import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db'
import type { EstadoAccion } from '@/lib/form-state'
import { MENSAJES_CONFIG_KEY, mensajesConfigSchema, PASO_META, PASOS } from '@/lib/mensajes-config'
import { SETTERS_CONFIG_KEY } from '@/lib/setters-config'
import { variablesDesconocidas } from '@/lib/templates/render'
import { ErrorDePermiso, exigirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'

/**
 * Los mensajes que mandan los setters.
 *
 * Se guardan en `templates`. Un mensaje por paso y por rubro: si hay uno
 * escrito para el rubro del lead gana ese, y si no se usa el general. Un mismo
 * texto para una peluquería y para una ferretería se nota, y lo que no se nota
 * es lo único que contesta la gente.
 */

function alFallar(err: unknown, generico: string): EstadoAccion {
  if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
  console.error(generico, err)
  return { ok: false, error: generico }
}

export async function guardarDatosDeMensajes(datos: unknown): Promise<EstadoAccion> {
  try {
    await exigirAdmin()
    const parsed = mensajesConfigSchema.safeParse(datos)
    if (!parsed.success) return { ok: false, error: 'Revisá los datos.' }

    await db.execute(sql`
      insert into settings (key, value_jsonb, updated_at)
      values (${MENSAJES_CONFIG_KEY}, ${JSON.stringify(parsed.data)}::jsonb, now())
      on conflict (key) do update
        set value_jsonb = excluded.value_jsonb, updated_at = now()
    `)

    revalidatePath('/mensajes')
    revalidatePath('/seguimientos')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudieron guardar los datos.')
  }
}

const tiemposSchema = z.object({
  horasSegundoMensaje: z.coerce.number().int().min(1).max(240),
  horasVencimiento: z.coerce.number().int().min(1).max(720),
  diasAtrasoParaAlerta: z.coerce.number().int().min(1).max(30),
  /* Los tres reenganches. Son los que deciden cuándo vuelve a la cola un lead
     que se calló, y cada silencio se espera distinto. */
  diasParaUltimoIntento: z.coerce.number().int().min(1).max(60),
  diasParaRetomarConversacion: z.coerce.number().int().min(1).max(90),
  diasParaRetomarInteresado: z.coerce.number().int().min(1).max(90),
  diasParaUltimoReenganche: z.coerce.number().int().min(1).max(120),
})

/**
 * Los tiempos del seguimiento.
 *
 * Se guardan sobre la configuración existente en vez de reemplazarla: el resto
 * de los valores (umbrales de las alertas, horarios de los avisos) sigue como
 * estaba.
 */
export async function guardarTiempos(datos: unknown): Promise<EstadoAccion> {
  try {
    await exigirAdmin()
    const parsed = tiemposSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los números.' }
    }

    const actual = await leerConfigSetters()

    await db.execute(sql`
      insert into settings (key, value_jsonb, updated_at)
      values (${SETTERS_CONFIG_KEY}, ${JSON.stringify({ ...actual, ...parsed.data })}::jsonb, now())
      on conflict (key) do update
        set value_jsonb = excluded.value_jsonb, updated_at = now()
    `)

    revalidatePath('/mensajes')
    revalidatePath('/seguimientos')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudieron guardar los tiempos.')
  }
}

const mensajeSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  paso: z
    .number()
    .int()
    .refine((n): n is (typeof PASOS)[number] => (PASOS as readonly number[]).includes(n), {
      message: 'Esa situación no existe.',
    }),
  /** null o vacío = el mensaje general. */
  rubro: z.string().trim().max(60).nullable().optional(),
  cuerpo: z.string().trim().min(10, 'El mensaje es demasiado corto.').max(2000),
  variantes: z.array(z.string().trim().max(2000)).max(5).default([]),
  activo: z.boolean().default(true),
})

export async function guardarMensaje(datos: unknown): Promise<EstadoAccion> {
  try {
    await exigirAdmin()
    const parsed = mensajeSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá el mensaje.' }
    }
    const d = parsed.data

    /*
     * Una variable inventada haría que el mensaje no salga nunca, y el setter
     * vería "no se puede armar el mensaje" sin saber por qué. Se frena acá,
     * donde se puede explicar.
     */
    const textos = [d.cuerpo, ...d.variantes.filter((v) => v.trim().length > 0)]
    for (const texto of textos) {
      const malas = variablesDesconocidas(texto)
      if (malas.length > 0) {
        return {
          ok: false,
          error: `No existe la variable ${malas.map((v) => `{{${v}}}`).join(', ')}. Mirá la lista de abajo.`,
        }
      }
    }

    const rubro = d.rubro?.trim() ? d.rubro.trim().toLowerCase() : null
    const variantes = d.variantes.filter((v) => v.trim().length > 0)
    const nombre = `${PASO_META[d.paso].label} · ${rubro ?? 'general'}`

    if (d.id) {
      await db.execute(sql`
        update templates
           set body = ${d.cuerpo}, variants = ${JSON.stringify(variantes)}::jsonb,
               niche = ${rubro}, active = ${d.activo}, name = ${nombre}, updated_at = now()
         where id = ${d.id}::uuid
      `)
    } else {
      /*
       * Quitar un mensaje de rubro lo desactiva, no lo borra: los envíos que ya
       * salieron apuntan acá. Pero entonces el que se desactivó sigue ocupando
       * el lugar, y escribir uno nuevo para ese mismo rubro chocaba con un
       * "editá ese" que mandaba a editar algo que la pantalla ya no muestra —
       * un callejón sin salida del que no se podía volver.
       *
       * Si el que está ocupando el lugar está desactivado, se reusa: es el
       * mismo mensaje volviendo, y así los envíos viejos no pierden a qué
       * apuntaban.
       */
      const repetido = await db.execute(sql`
        select id, active from templates
         where channel in ('instagram', 'ambos')
           and coalesce(sequence_step, 1) = ${d.paso}
           and coalesce(niche, '') = coalesce(${rubro}, '')
         order by active desc, updated_at desc
         limit 1
      `)
      const previo = repetido.rows[0] as { id: string; active: boolean } | undefined

      if (previo?.active) {
        return {
          ok: false,
          error: rubro
            ? `Ya hay un mensaje para el rubro "${rubro}" en ese paso. Editá ese.`
            : 'Ya hay un mensaje general en ese paso. Editá ese.',
        }
      }

      if (previo) {
        await db.execute(sql`
          update templates
             set body = ${d.cuerpo}, variants = ${JSON.stringify(variantes)}::jsonb,
                 niche = ${rubro}, active = true, name = ${nombre},
                 is_opening = ${d.paso === 1}, updated_at = now()
           where id = ${previo.id}::uuid
        `)
        revalidatePath('/mensajes')
        revalidatePath('/seguimientos')
        revalidatePath('/hoy')
        return { ok: true, error: null }
      }

      await db.execute(sql`
        insert into templates (name, channel, sequence_step, niche, body, variants, active,
                               is_opening, pilot_status)
        values (${nombre}, 'instagram', ${d.paso}, ${rubro}, ${d.cuerpo},
                ${JSON.stringify(variantes)}::jsonb, ${d.activo},
                ${d.paso === 1}, 'aprobada')
      `)
    }

    revalidatePath('/mensajes')
    revalidatePath('/seguimientos')
    revalidatePath('/hoy')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo guardar el mensaje.')
  }
}

export async function borrarMensaje(id: string): Promise<EstadoAccion> {
  try {
    await exigirAdmin()
    /*
     * Se desactiva en lugar de borrarse: los mensajes ya mandados apuntan acá
     * y borrarlo dejaría envíos sin saber qué texto salió.
     */
    await db.execute(sql`update templates set active = false, updated_at = now() where id = ${id}::uuid`)
    revalidatePath('/mensajes')
    revalidatePath('/seguimientos')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo desactivar el mensaje.')
  }
}
