import 'server-only'

import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { settings } from '@/db/schema'
import { cifrar, descifrar, enmascarar } from '@/lib/crypto'

import type { ConfigEvolution } from './client'

/**
 * Configuración de Evolution API.
 *
 * La API key se guarda cifrada, igual que el token de Chatwoot. Vive en
 * `settings` y no en una tabla propia porque es una sola fila de dos campos.
 */

export const EVOLUTION_KEY = 'evolution'

interface Guardado {
  baseUrl: string
  apiKeyEncrypted: string
  active: boolean
}

export async function leerConfigEvolution(): Promise<ConfigEvolution | null> {
  const [fila] = await db.select().from(settings).where(eq(settings.key, EVOLUTION_KEY)).limit(1)
  if (!fila) return null

  const g = fila.value as Partial<Guardado>
  if (!g.baseUrl || !g.apiKeyEncrypted || g.active === false) return null

  try {
    return { baseUrl: g.baseUrl, apiKey: descifrar(g.apiKeyEncrypted) }
  } catch (err) {
    console.error('No se pudo descifrar la API key de Evolution:', err)
    return null
  }
}

export interface ConfigEvolutionVisible {
  baseUrl: string
  apiKeyEnmascarada: string
  active: boolean
}

export async function leerConfigEvolutionVisible(): Promise<ConfigEvolutionVisible | null> {
  const [fila] = await db.select().from(settings).where(eq(settings.key, EVOLUTION_KEY)).limit(1)
  if (!fila) return null

  const g = fila.value as Partial<Guardado>
  if (!g.baseUrl) return null

  let key = ''
  try {
    key = g.apiKeyEncrypted ? descifrar(g.apiKeyEncrypted) : ''
  } catch {
    key = ''
  }

  return {
    baseUrl: g.baseUrl,
    apiKeyEnmascarada: key ? enmascarar(key) : '⚠ no se pudo descifrar',
    active: g.active !== false,
  }
}

export async function guardarConfigEvolution(params: {
  baseUrl: string
  apiKey: string
  active?: boolean
}): Promise<void> {
  const valor: Guardado = {
    baseUrl: params.baseUrl.replace(/\/+$/, ''),
    apiKeyEncrypted: cifrar(params.apiKey),
    active: params.active ?? true,
  }

  await db
    .insert(settings)
    .values({ key: EVOLUTION_KEY, value: valor })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: valor, updatedAt: new Date() },
    })
}
