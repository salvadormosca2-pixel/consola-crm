import { timingSafeEqual } from 'node:crypto'

import { correrTareas } from '@/server/setters/tareas'

/**
 * Las tareas del reloj.
 *
 * Pensada para que la llame un programador externo cada 10–15 minutos:
 *
 *   curl -H "Authorization: Bearer $TAREAS_SECRET" https://.../api/tareas
 *
 * No necesita sesión —un cron no puede loguearse—, así que se autentica con su
 * propio secreto, igual que los webhooks. **Sin `TAREAS_SECRET` en el entorno
 * la ruta no atiende a nadie**: dejarla abierta permitiría a cualquiera
 * disparar notificaciones al equipo.
 *
 * El vencimiento de leads no depende de esto: se resuelve al leer la cola, así
 * que el sistema funciona igual en una máquina sin programador. Lo que se
 * pierde sin esto son los avisos que llegan solos.
 */
export const dynamic = 'force-dynamic'

function coincide(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido)
  const b = Buffer.from(esperado)
  // Comparación de tiempo constante: con `===` la respuesta tarda distinto
  // según cuántos caracteres coinciden, y eso se puede medir.
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request): Promise<Response> {
  /*
   * Dos secretos válidos, no uno.
   *
   * `TAREAS_SECRET` es el propio, para un programador externo. `CRON_SECRET`
   * es el que manda Vercel en sus tareas programadas —lo pone él en la
   * cabecera y no se puede cambiar— así que aceptar los dos evita tener que
   * duplicar el mismo valor en dos variables y acordarse de mantenerlas
   * iguales.
   *
   * Si no hay ninguno configurado, la ruta no atiende a nadie: dejarla abierta
   * permitiría a cualquiera disparar notificaciones al equipo.
   */
  const validos = [process.env.TAREAS_SECRET, process.env.CRON_SECRET].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )

  if (validos.length === 0) {
    return Response.json(
      { error: 'Falta TAREAS_SECRET (o CRON_SECRET) en el entorno. La ruta está apagada.' },
      { status: 503 },
    )
  }

  const url = new URL(request.url)
  const recibido =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    url.searchParams.get('secreto') ??
    ''

  if (!validos.some((v) => coincide(recibido, v))) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 })
  }

  try {
    const resumen = await correrTareas()
    return Response.json({ ok: true, ...resumen })
  } catch (err) {
    console.error('Error al correr las tareas del reloj:', err)
    return Response.json({ ok: false, error: 'Falló alguna tarea.' }, { status: 500 })
  }
}

export const POST = GET
