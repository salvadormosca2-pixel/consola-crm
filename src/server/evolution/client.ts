import 'server-only'

import { z } from 'zod'

/**
 * Cliente de Evolution API.
 *
 * El camino recomendado es Chatwoot (que por debajo usa Evolution), porque así
 * las respuestas entran solas a la bandeja. Pero si todavía no tenés Chatwoot
 * montado, esto permite mandar directo y empezar a trabajar hoy.
 *
 * Con Evolution directo hay una limitación que conviene saber: **las respuestas
 * no entran solas** hasta que configures el webhook. Hasta entonces hay que
 * marcarlas a mano desde la bandeja.
 */

export interface ConfigEvolution {
  baseUrl: string
  apiKey: string
}

export class ErrorEvolution extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'ErrorEvolution'
  }
}

const TIMEOUT_MS = 15_000

async function pedir<T>(
  cfg: ConfigEvolution,
  ruta: string,
  esquema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}${ruta}`

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { apikey: cfg.apiKey, 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    const esTimeout = err instanceof Error && err.name === 'TimeoutError'
    throw new ErrorEvolution(
      esTimeout
        ? `Evolution no respondió en ${TIMEOUT_MS / 1000} segundos.`
        : 'No se pudo conectar con Evolution. Revisá la URL y que el servidor esté levantado.',
      null,
    )
  }

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '')
    throw new ErrorEvolution(
      res.status === 401 || res.status === 403
        ? 'Evolution rechazó la API key.'
        : res.status === 404
          ? 'Evolution no encontró esa instancia. Revisá el nombre.'
          : `Evolution devolvió ${res.status}. ${cuerpo.slice(0, 200)}`,
      res.status,
    )
  }

  const json: unknown = await res.json().catch(() => null)
  const parsed = esquema.safeParse(json)
  if (!parsed.success) {
    throw new ErrorEvolution('Evolution devolvió algo que no se pudo interpretar.', res.status)
  }
  return parsed.data
}

const instanciaSchema = z.object({
  // Evolution cambió la forma de esta respuesta entre versiones, así que se
  // acepta cualquiera de las dos y se normaliza acá.
  instance: z
    .object({ instanceName: z.string().optional(), state: z.string().optional() })
    .optional(),
  instanceName: z.string().optional(),
  name: z.string().optional(),
  connectionStatus: z.string().optional(),
  state: z.string().optional(),
})

export interface InstanciaEvolution {
  nombre: string
  conectada: boolean
  estado: string
}

/** Lista las instancias reales. Es lo que usa el botón de probar conexión. */
export async function listarInstancias(cfg: ConfigEvolution): Promise<InstanciaEvolution[]> {
  const filas = await pedir(cfg, '/instance/fetchInstances', z.array(instanciaSchema))

  return filas.map((f) => {
    const nombre = f.instance?.instanceName ?? f.instanceName ?? f.name ?? '(sin nombre)'
    const estado = f.connectionStatus ?? f.state ?? f.instance?.state ?? 'desconocido'
    return { nombre, conectada: estado === 'open' || estado === 'connected', estado }
  })
}

const envioSchema = z.object({
  key: z.object({ id: z.string() }).optional(),
  messageId: z.string().optional(),
  status: z.string().optional(),
})

/**
 * Manda un mensaje de texto por una instancia.
 *
 * `delay` le dice a Evolution que simule tipeo antes de mandar: un mensaje que
 * aparece instantáneo se ve más automático que uno que tarda unos segundos.
 */
export async function enviarTexto(
  cfg: ConfigEvolution,
  params: { instancia: string; e164: string; texto: string; delayMs?: number },
): Promise<{ externalId: string | null }> {
  const r = await pedir(cfg, `/message/sendText/${encodeURIComponent(params.instancia)}`, envioSchema, {
    method: 'POST',
    body: JSON.stringify({
      number: params.e164,
      text: params.texto,
      delay: params.delayMs ?? 1200,
      linkPreview: false,
    }),
  })

  return { externalId: r.key?.id ?? r.messageId ?? null }
}

const estadoSchema = z.object({
  instance: z.object({ state: z.string().optional() }).optional(),
  state: z.string().optional(),
})

/** Estado de conexión de una instancia, para el semáforo de salud. */
export async function estadoInstancia(
  cfg: ConfigEvolution,
  instancia: string,
): Promise<{ conectada: boolean; estado: string }> {
  const r = await pedir(
    cfg,
    `/instance/connectionState/${encodeURIComponent(instancia)}`,
    estadoSchema,
  )
  const estado = r.instance?.state ?? r.state ?? 'desconocido'
  return { conectada: estado === 'open' || estado === 'connected', estado }
}
