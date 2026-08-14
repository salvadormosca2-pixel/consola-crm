import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'

import { db } from '@/db'
import { chatwootConfig } from '@/db/schema'
import { comparaSeguro } from '@/lib/crypto'
import { eventoSchema, procesarEvento } from '@/server/chatwoot/webhook'

/**
 * Entrada del webhook de Chatwoot.
 *
 * Chatwoot no firma sus webhooks, así que la autenticación es un secreto en la
 * query string, comparado en tiempo constante. La URL completa (con el secreto)
 * se muestra en Configuración para copiar y pegar.
 *
 * Nunca devuelve 500 por un payload raro: si Chatwoot recibe un error,
 * reintenta, y un reintento sobre un evento que igual no se puede procesar solo
 * genera ruido. Los errores de verdad sí devuelven 500 para que reintente.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const secreto = req.nextUrl.searchParams.get('secreto') ?? ''

  const [config] = await db.select().from(chatwootConfig).where(eq(chatwootConfig.id, 1)).limit(1)
  if (!config) {
    return Response.json({ error: 'Chatwoot no está configurado en la consola.' }, { status: 503 })
  }

  if (!comparaSeguro(secreto, config.webhookSecret)) {
    return Response.json({ error: 'Secreto inválido.' }, { status: 401 })
  }

  let crudo: unknown
  try {
    crudo = await req.json()
  } catch {
    return Response.json({ error: 'El cuerpo no es JSON.' }, { status: 400 })
  }

  const parsed = eventoSchema.safeParse(crudo)
  if (!parsed.success) {
    // 200 a propósito: reintentar no va a arreglar un payload que no entendemos.
    console.warn('Webhook de Chatwoot con forma inesperada:', parsed.error.issues.slice(0, 3))
    return Response.json({ ok: false, motivo: 'forma inesperada' })
  }

  try {
    const r = await procesarEvento(parsed.data)
    return Response.json({ ok: true, ...r })
  } catch (err) {
    // Acá sí conviene el 500: es un problema nuestro y el reintento puede salvar
    // un mensaje que si no se pierde.
    console.error('Error al procesar el webhook de Chatwoot:', err)
    return Response.json({ error: 'No se pudo procesar el evento.' }, { status: 500 })
  }
}

/** Chatwoot pega un GET al guardar el webhook para verificar que existe. */
export function GET(): Response {
  return Response.json({ ok: true, servicio: 'webhook de Chatwoot' })
}
