import 'server-only'

import { z } from 'zod'

/**
 * Cliente de la API de Chatwoot.
 *
 * Chatwoot es la bandeja: recibe las conversaciones de las 10 instancias de
 * Evolution y la consola manda **a través suyo**, nunca directo a Evolution.
 * Así el mensaje saliente queda en la conversación y el historial está completo
 * de los dos lados.
 *
 * Todo lo que vuelve se valida con Zod: un cambio de forma en la respuesta no
 * puede colarse como `undefined` hasta la base.
 */

export interface ConfigChatwoot {
  baseUrl: string
  accountId: number
  token: string
}

export class ErrorChatwoot extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detalle?: unknown,
  ) {
    super(message)
    this.name = 'ErrorChatwoot'
  }

  /** Si es un problema de red o del servidor, conviene reintentar o usar respaldo. */
  get esTransitorio(): boolean {
    return this.status === null || this.status >= 500 || this.status === 429
  }
}

const inboxSchema = z.object({
  id: z.number(),
  name: z.string(),
  channel_type: z.string().optional(),
  phone_number: z.string().nullable().optional(),
})

const contactoSchema = z.object({
  id: z.number(),
  name: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  identifier: z.string().nullable().optional(),
})

const conversacionSchema = z.object({
  id: z.number(),
  inbox_id: z.number().optional(),
})

const mensajeSchema = z.object({
  id: z.number(),
  content: z.string().nullable().optional(),
  conversation_id: z.number().optional(),
})

export type InboxChatwoot = z.infer<typeof inboxSchema>

/** Timeout corto: si Chatwoot no contesta, se pasa al respaldo en vez de colgar la pantalla. */
const TIMEOUT_MS = 12_000

async function pedir<T>(
  cfg: ConfigChatwoot,
  ruta: string,
  esquema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/accounts/${cfg.accountId}${ruta}`

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'api_access_token': cfg.token,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    const esTimeout = err instanceof Error && err.name === 'TimeoutError'
    throw new ErrorChatwoot(
      esTimeout
        ? `Chatwoot no respondió en ${TIMEOUT_MS / 1000} segundos.`
        : 'No se pudo conectar con Chatwoot. Revisá la URL y que el servidor esté levantado.',
      null,
      err,
    )
  }

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '')
    throw new ErrorChatwoot(
      res.status === 401 || res.status === 403
        ? 'Chatwoot rechazó el token. Revisá el token de la API en Configuración.'
        : res.status === 404
          ? `Chatwoot no encontró ${ruta}. Revisá el id de cuenta.`
          : `Chatwoot devolvió ${res.status}.`,
      res.status,
      cuerpo.slice(0, 500),
    )
  }

  const json: unknown = await res.json().catch(() => null)
  const parsed = esquema.safeParse(json)
  if (!parsed.success) {
    throw new ErrorChatwoot(
      'Chatwoot devolvió algo que no se pudo interpretar. ¿La versión del servidor es la esperada?',
      res.status,
      parsed.error.issues.slice(0, 3),
    )
  }
  return parsed.data
}

/** Lista los inboxes reales. Es lo que usa el botón de probar conexión. */
export async function listarInboxes(cfg: ConfigChatwoot): Promise<InboxChatwoot[]> {
  const r = await pedir(cfg, '/inboxes', z.object({ payload: z.array(inboxSchema) }))
  return r.payload
}

/**
 * Busca el contacto por teléfono, y si no está lo crea.
 *
 * Chatwoot identifica por `identifier`, así que se usa el E.164 del contacto:
 * es estable y evita duplicados cuando la búsqueda por texto falla.
 */
export async function asegurarContacto(
  cfg: ConfigChatwoot,
  params: { inboxId: number; nombre: string; e164: string },
): Promise<number> {
  const conMas = `+${params.e164}`

  const encontrados = await pedir(
    cfg,
    `/contacts/search?q=${encodeURIComponent(conMas)}`,
    z.object({ payload: z.array(contactoSchema) }),
  ).catch((err: unknown) => {
    if (err instanceof ErrorChatwoot && err.status === 404) return { payload: [] }
    throw err
  })

  const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
  const ya = encontrados.payload.find(
    (c) => soloDigitos(c.phone_number) === params.e164 || c.identifier === params.e164,
  )
  if (ya) return ya.id

  const creado = await pedir(
    cfg,
    '/contacts',
    z.object({ payload: z.object({ contact: contactoSchema }) }),
    {
      method: 'POST',
      body: JSON.stringify({
        inbox_id: params.inboxId,
        name: params.nombre,
        phone_number: conMas,
        identifier: params.e164,
      }),
    },
  )
  return creado.payload.contact.id
}

/** Abre una conversación en ese inbox, o devuelve la que ya exista. */
export async function asegurarConversacion(
  cfg: ConfigChatwoot,
  params: { inboxId: number; contactId: number; e164: string },
): Promise<number> {
  const abiertas = await pedir(
    cfg,
    `/contacts/${params.contactId}/conversations`,
    z.object({ payload: z.array(conversacionSchema) }),
  ).catch((err: unknown) => {
    if (err instanceof ErrorChatwoot && err.status === 404) return { payload: [] }
    throw err
  })

  const ya = abiertas.payload.find((c) => c.inbox_id === params.inboxId)
  if (ya) return ya.id

  const creada = await pedir(cfg, '/conversations', conversacionSchema, {
    method: 'POST',
    body: JSON.stringify({
      source_id: params.e164,
      inbox_id: params.inboxId,
      contact_id: params.contactId,
    }),
  })
  return creada.id
}

export interface EnvioChatwoot {
  chatwootMessageId: number
  conversationId: number
  contactId: number
}

/**
 * Manda el mensaje. Es el camino completo: asegura contacto, asegura
 * conversación en el inbox que corresponde a la cuenta asignada, y envía.
 */
export async function enviarMensaje(
  cfg: ConfigChatwoot,
  params: {
    inboxId: number
    nombre: string
    e164: string
    texto: string
    /** Si ya se conocen, se saltean las búsquedas. */
    contactoConocido?: number | null
    conversacionConocida?: number | null
  },
): Promise<EnvioChatwoot> {
  const contactId =
    params.contactoConocido ??
    (await asegurarContacto(cfg, {
      inboxId: params.inboxId,
      nombre: params.nombre,
      e164: params.e164,
    }))

  const conversationId =
    params.conversacionConocida ??
    (await asegurarConversacion(cfg, {
      inboxId: params.inboxId,
      contactId,
      e164: params.e164,
    }))

  const mensaje = await pedir(cfg, `/conversations/${conversationId}/messages`, mensajeSchema, {
    method: 'POST',
    body: JSON.stringify({ content: params.texto, message_type: 'outgoing', private: false }),
  })

  return { chatwootMessageId: mensaje.id, conversationId, contactId }
}

/** Link directo a la conversación, para el botón "Abrir en Chatwoot". */
export function linkConversacion(
  cfg: Pick<ConfigChatwoot, 'baseUrl' | 'accountId'>,
  conversationId: number,
): string {
  return `${cfg.baseUrl.replace(/\/+$/, '')}/app/accounts/${cfg.accountId}/conversations/${conversationId}`
}
