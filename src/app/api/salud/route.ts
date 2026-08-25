import { sql } from 'drizzle-orm'

import { db } from '@/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Chequeo de salud, para Coolify.
 *
 * Coolify pega acá antes de mandar tráfico a un contenedor nuevo. Si responde
 * 200, hace el cambio; si no, deja andando el anterior y el despliegue no
 * tumba el sistema.
 *
 * **Consulta la base a propósito.** Un endpoint que devuelve `ok` sin tocar
 * nada solo prueba que el proceso arrancó, y un contenedor que levanta pero no
 * llega a Postgres está tan caído como uno que no levantó: la app entera vive
 * de la base. Es una consulta de un renglón, no pesa.
 *
 * No pide sesión —el chequeo no tiene cookie— pero tampoco cuenta nada:
 * responde si anda o si no, sin versiones ni rutas ni datos.
 */
export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`)
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.error('Chequeo de salud: la base no responde.', err)
    return Response.json(
      { ok: false },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
