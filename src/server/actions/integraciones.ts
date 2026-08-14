'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db'
import { messagingAccounts } from '@/db/schema'
import type { EstadoAccion } from '@/lib/form-state'
import { listarInboxes } from '@/server/chatwoot/client'
import { guardarConfigChatwoot, leerConfigChatwoot } from '@/server/chatwoot/config'
import { listarInstancias } from '@/server/evolution/client'
import { guardarConfigEvolution, leerConfigEvolution } from '@/server/evolution/config'

/**
 * Configuración de las integraciones.
 *
 * Probar la conexión no valida solo las credenciales: trae la lista real de
 * inboxes o instancias, que es lo que hace falta para mapear cada cuenta. Un
 * "conexión OK" que no lista nada no sirve para nada.
 */

const urlSchema = z
  .string()
  .trim()
  .min(1, 'Falta la URL.')
  .refine((v) => /^https?:\/\//.test(v), 'La URL tiene que empezar con http:// o https://')

/* ── Chatwoot ─────────────────────────────────────────────────────────── */

const chatwootSchema = z.object({
  baseUrl: urlSchema,
  accountId: z.coerce.number().int().min(1, 'El id de cuenta tiene que ser un número.'),
  token: z.string().trim().min(10, 'El token parece demasiado corto.'),
})

export type ResultadoPrueba =
  | { ok: true; items: Array<{ id: string; label: string; detalle: string; conectada: boolean }> }
  | { ok: false; error: string }

export async function probarChatwoot(formData: FormData): Promise<ResultadoPrueba> {
  const parsed = chatwootSchema.safeParse({
    baseUrl: formData.get('baseUrl'),
    accountId: formData.get('accountId'),
    token: formData.get('token'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  }

  try {
    const inboxes = await listarInboxes(parsed.data)
    if (inboxes.length === 0) {
      return {
        ok: false,
        error: 'Conectó bien, pero esa cuenta de Chatwoot no tiene ningún inbox. Creá uno por cada número.',
      }
    }
    return {
      ok: true,
      items: inboxes.map((i) => ({
        id: String(i.id),
        label: i.name,
        detalle: i.phone_number ? `${i.channel_type ?? ''} · ${i.phone_number}` : (i.channel_type ?? ''),
        conectada: true,
      })),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo conectar.' }
  }
}

export async function guardarChatwoot(formData: FormData): Promise<EstadoAccion> {
  const parsed = chatwootSchema.safeParse({
    baseUrl: formData.get('baseUrl'),
    accountId: formData.get('accountId'),
    token: formData.get('token'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  }

  // No se guarda algo que no funciona: se prueba primero.
  try {
    await listarInboxes(parsed.data)
  } catch (err) {
    return {
      ok: false,
      error: `No se guardó porque no se pudo conectar: ${err instanceof Error ? err.message : 'error desconocido'}`,
    }
  }

  try {
    await guardarConfigChatwoot(parsed.data)
  } catch (err) {
    console.error('Error al guardar Chatwoot:', err)
    return { ok: false, error: 'No se pudo guardar la configuración.' }
  }

  revalidatePath('/configuracion')
  revalidatePath('/despachador')
  return { ok: true, error: null }
}

/* ── Evolution ────────────────────────────────────────────────────────── */

const evolutionSchema = z.object({
  baseUrl: urlSchema,
  apiKey: z.string().trim().min(6, 'La API key parece demasiado corta.'),
})

export async function probarEvolution(formData: FormData): Promise<ResultadoPrueba> {
  const parsed = evolutionSchema.safeParse({
    baseUrl: formData.get('baseUrl'),
    apiKey: formData.get('apiKey'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  }

  try {
    const instancias = await listarInstancias(parsed.data)
    if (instancias.length === 0) {
      return {
        ok: false,
        error: 'Conectó bien, pero no hay ninguna instancia creada en Evolution.',
      }
    }
    return {
      ok: true,
      items: instancias.map((i) => ({
        id: i.nombre,
        label: i.nombre,
        detalle: i.conectada ? 'conectada' : `sin conectar (${i.estado})`,
        conectada: i.conectada,
      })),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo conectar.' }
  }
}

export async function guardarEvolution(formData: FormData): Promise<EstadoAccion> {
  const parsed = evolutionSchema.safeParse({
    baseUrl: formData.get('baseUrl'),
    apiKey: formData.get('apiKey'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  }

  try {
    await listarInstancias(parsed.data)
  } catch (err) {
    return {
      ok: false,
      error: `No se guardó porque no se pudo conectar: ${err instanceof Error ? err.message : 'error desconocido'}`,
    }
  }

  try {
    await guardarConfigEvolution(parsed.data)
  } catch (err) {
    console.error('Error al guardar Evolution:', err)
    return { ok: false, error: 'No se pudo guardar la configuración.' }
  }

  revalidatePath('/configuracion')
  revalidatePath('/despachador')
  return { ok: true, error: null }
}

/* ── Mapeo de cuentas ─────────────────────────────────────────────────── */

/**
 * Asocia una cuenta con su inbox de Chatwoot y/o su instancia de Evolution.
 * Sin este mapeo la cuenta no puede mandar sola: el mensaje saldría por el
 * número equivocado, que rompe la asignación pegada.
 */
export async function mapearCuenta(
  accountId: string,
  inboxId: number | null,
  instanceName: string | null,
): Promise<EstadoAccion> {
  try {
    await db
      .update(messagingAccounts)
      .set({
        chatwootInboxId: inboxId,
        instanceName: instanceName && instanceName.length > 0 ? instanceName : null,
        // Con un canal de salida asignado, la cuenta pasa a modo automático.
        mode: inboxId !== null || instanceName ? 'api' : 'manual',
        updatedAt: new Date(),
      })
      .where(eq(messagingAccounts.id, accountId))
  } catch (err) {
    const codigo = (err as { code?: string; cause?: { code?: string } }).code ??
      (err as { cause?: { code?: string } }).cause?.code
    if (codigo === '23505') {
      return { ok: false, error: 'Ese inbox ya está asignado a otra cuenta.' }
    }
    console.error('Error al mapear la cuenta:', err)
    return { ok: false, error: 'No se pudo guardar el mapeo.' }
  }

  revalidatePath('/configuracion')
  revalidatePath('/cuentas')
  revalidatePath('/despachador')
  return { ok: true, error: null }
}

/** Qué integraciones están listas, para mostrarlo en pantalla. */
export async function estadoIntegraciones(): Promise<{
  chatwoot: boolean
  evolution: boolean
}> {
  const [c, e] = await Promise.all([leerConfigChatwoot(), leerConfigEvolution()])
  return { chatwoot: c !== null, evolution: e !== null }
}
