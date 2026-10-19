'use server'

import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db'
import type { EstadoAccion } from '@/lib/form-state'
import { PASOS_DE_PISTA } from '@/lib/pistas'
import { SETTERS_CONFIG_KEY } from '@/lib/setters-config'
import { ErrorDePermiso, exigirAdmin } from '@/server/session'
import { leerConfigSetters } from '@/server/setters/config'

/**
 * Los tiempos del recorrido: cuántos días espera cada escalón.
 *
 * Antes esto vivía junto al editor de plantillas, porque el día y el texto del
 * escalón se escribían en la misma fila. Sin plantillas quedó solo el número,
 * y el número sí es una regla general: los días son los mismos para todos los
 * leads, lo que cambia entre uno y otro es lo que se les escribe.
 */

const tiemposSchema = z.object({
  horasVencimiento: z.coerce.number().int().min(1).max(720),
  diasAtrasoParaAlerta: z.coerce.number().int().min(1).max(30),
  /**
   * Los días llegan como un mapa `{ "3": 2, "10": 4, ... }` en vez de un campo
   * por paso: la escalera puede crecer, y con un campo por escalón hay que
   * tocar el esquema cada vez que se suma un toque. Solo se aceptan números de
   * paso que hoy pertenezcan a una pista — uno retirado no tiene días que
   * configurar.
   */
  diasPorPaso: z
    .record(z.string(), z.coerce.number().int().min(0).max(120))
    .default({})
    .refine(
      (m) => Object.keys(m).every((k) => (PASOS_DE_PISTA as readonly number[]).includes(Number(k))),
      { message: 'Ese paso no existe.' },
    ),
})

/**
 * Se guarda sobre la configuración existente en vez de reemplazarla: el resto
 * de los valores (umbrales de las alertas, horarios de los avisos) sigue como
 * estaba, y los días se fusionan con los que ya había porque el panel manda
 * solo lo que se ve en pantalla.
 */
export async function guardarTiempos(datos: unknown): Promise<EstadoAccion> {
  try {
    await exigirAdmin()
    const parsed = tiemposSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los números.' }
    }

    const actual = await leerConfigSetters()
    const nueva = {
      ...actual,
      horasVencimiento: parsed.data.horasVencimiento,
      diasAtrasoParaAlerta: parsed.data.diasAtrasoParaAlerta,
      diasPorPaso: { ...actual.diasPorPaso, ...parsed.data.diasPorPaso },
    }

    await db.execute(sql`
      insert into settings (key, value_jsonb, updated_at)
      values (${SETTERS_CONFIG_KEY}, ${JSON.stringify(nueva)}::jsonb, now())
      on conflict (key) do update
        set value_jsonb = excluded.value_jsonb, updated_at = now()
    `)

    revalidatePath('/seguimientos')
    revalidatePath('/hoy')
    return { ok: true, error: null }
  } catch (err) {
    if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
    console.error('No se pudieron guardar los tiempos.', err)
    return { ok: false, error: 'No se pudieron guardar los tiempos.' }
  }
}
