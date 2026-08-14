import 'server-only'

import { eq, sql } from 'drizzle-orm'

import { db } from '@/db'
import { chatwootConfig } from '@/db/schema'
import { cifrar, descifrar, enmascarar, generarSecreto } from '@/lib/crypto'
import { OPS_CONFIG_DEFAULT } from '@/lib/ops-config'

import type { ConfigChatwoot } from './client'

/**
 * Configuración de Chatwoot.
 *
 * El token se guarda cifrado y solo se descifra del lado del servidor, en el
 * momento de usarlo. Nunca vuelve al cliente: la pantalla de configuración
 * muestra el token enmascarado, no el valor.
 */

export interface ConfigVisible {
  configurada: boolean
  baseUrl: string
  accountId: number
  /** Token enmascarado, para confirmar cuál está cargado sin revelarlo. */
  tokenEnmascarado: string
  webhookSecret: string
  active: boolean
  lastWebhookAt: Date | null
  /** Estado del webhook, para el indicador de sincronización. */
  sincronizacion: EstadoSincronizacion
}

export type EstadoSincronizacion =
  | { estado: 'sin_configurar'; motivo: string }
  | { estado: 'verde'; motivo: string }
  | { estado: 'amarillo'; motivo: string }
  | { estado: 'rojo'; motivo: string }

/** Config lista para usar contra la API. Solo del lado del servidor. */
export async function leerConfigChatwoot(): Promise<ConfigChatwoot | null> {
  const [fila] = await db.select().from(chatwootConfig).where(eq(chatwootConfig.id, 1)).limit(1)
  if (!fila || !fila.active) return null

  try {
    return {
      baseUrl: fila.baseUrl,
      accountId: fila.accountId,
      token: descifrar(fila.apiTokenEncrypted),
    }
  } catch (err) {
    // La clave cambió o el valor se corrompió: mejor no enviar que enviar mal.
    console.error('No se pudo descifrar el token de Chatwoot:', err)
    return null
  }
}

export async function leerConfigVisible(): Promise<ConfigVisible | null> {
  const [fila] = await db.select().from(chatwootConfig).where(eq(chatwootConfig.id, 1)).limit(1)
  if (!fila) return null

  let token = ''
  try {
    token = descifrar(fila.apiTokenEncrypted)
  } catch {
    token = ''
  }

  return {
    configurada: true,
    baseUrl: fila.baseUrl,
    accountId: fila.accountId,
    tokenEnmascarado: token ? enmascarar(token) : '⚠ no se pudo descifrar',
    webhookSecret: fila.webhookSecret,
    active: fila.active,
    lastWebhookAt: fila.lastWebhookAt,
    sincronizacion: await evaluarSincronizacion(fila.lastWebhookAt, fila.active),
  }
}

/**
 * Estado del webhook.
 *
 * Un webhook caído en silencio es el peor escenario del sistema: la consola
 * cree que nadie contestó y sigue mandando seguimientos a gente que ya
 * respondió. Por eso no alcanza con mirar la fecha: solo es rojo si además hubo
 * envíos recientes, que es cuando deberían estar llegando respuestas.
 */
export async function evaluarSincronizacion(
  ultimo: Date | null,
  activa: boolean,
): Promise<EstadoSincronizacion> {
  if (!activa) return { estado: 'sin_configurar', motivo: 'La sincronización está desactivada.' }

  const cfg = OPS_CONFIG_DEFAULT
  const [row] = await db.execute(sql`
    select count(*)::int as n from messages
     where direction = 'out' and undone_at is null
       and sent_at > now() - interval '24 hours'
  `).then((r) => r.rows as Array<{ n: number }>)
  const enviados24h = row?.n ?? 0

  if (ultimo === null) {
    return enviados24h > 0
      ? {
          estado: 'rojo',
          motivo: `Se mandaron ${enviados24h} mensajes en 24 h y nunca llegó un webhook. Revisá la configuración en Chatwoot.`,
        }
      : { estado: 'amarillo', motivo: 'Todavía no llegó ningún webhook de Chatwoot.' }
  }

  const minutos = Math.floor((Date.now() - ultimo.getTime()) / 60_000)
  if (minutos <= cfg.minutosSilencioParaAvisar) {
    return { estado: 'verde', motivo: `Último webhook hace ${minutos} min.` }
  }
  if (minutos < cfg.minutosSilencioParaBloquear || enviados24h === 0) {
    return { estado: 'amarillo', motivo: `Hace ${minutos} min que no llega un webhook.` }
  }
  return {
    estado: 'rojo',
    motivo: `Hace ${Math.floor(minutos / 60)} h que no llega un webhook y se mandaron ${enviados24h} mensajes. Puede que estés mandando seguimientos a gente que ya contestó.`,
  }
}

export async function guardarConfigChatwoot(params: {
  baseUrl: string
  accountId: number
  token: string
  webhookSecret?: string
  active?: boolean
}): Promise<void> {
  const secreto = params.webhookSecret && params.webhookSecret.length >= 16
    ? params.webhookSecret
    : generarSecreto()

  await db
    .insert(chatwootConfig)
    .values({
      id: 1,
      baseUrl: params.baseUrl.replace(/\/+$/, ''),
      accountId: params.accountId,
      apiTokenEncrypted: cifrar(params.token),
      webhookSecret: secreto,
      active: params.active ?? true,
    })
    .onConflictDoUpdate({
      target: chatwootConfig.id,
      set: {
        baseUrl: params.baseUrl.replace(/\/+$/, ''),
        accountId: params.accountId,
        apiTokenEncrypted: cifrar(params.token),
        active: params.active ?? true,
        updatedAt: new Date(),
      },
    })
}

/** Sella que llegó un webhook, para el indicador de sincronización. */
export async function marcarWebhookRecibido(): Promise<void> {
  await db
    .update(chatwootConfig)
    .set({ lastWebhookAt: new Date() })
    .where(eq(chatwootConfig.id, 1))
}
