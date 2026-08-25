import 'server-only'

import { inArray, sql } from 'drizzle-orm'
import webpush from 'web-push'

import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'

/**
 * Notificaciones push de la PWA.
 *
 * Es lo que hace que el setter se entere de sus seguimientos sin que yo tenga
 * que escribirle por WhatsApp, y lo que me avisa a mí en el momento cuando
 * alguien contesta.
 *
 * Requiere un par de claves VAPID en el entorno. Si no están, el push queda
 * apagado y **no se ofrece en pantalla**: un botón de "activar notificaciones"
 * que no puede funcionar es peor que no tenerlo. El cartel al abrir la app
 * cubre el caso igual.
 *
 *   npm run push:claves    genera el par y dice qué pegar en .env.local
 */

let configurado: boolean | null = null

export function pushConfigurado(): boolean {
  if (configurado !== null) return configurado

  const publica = process.env.VAPID_PUBLIC_KEY
  const privada = process.env.VAPID_PRIVATE_KEY
  if (!publica || !privada) {
    configurado = false
    return false
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost',
      publica,
      privada,
    )
    configurado = true
  } catch (err) {
    console.error('Las claves VAPID no son válidas, el push queda apagado:', err)
    configurado = false
  }
  return configurado
}

/** La clave pública, que el navegador necesita para suscribirse. */
export function clavePublica(): string | null {
  return pushConfigurado() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null
}

export interface Aviso {
  titulo: string
  cuerpo: string
  /** A dónde lleva el toque en la notificación. */
  enlace: string
  /**
   * Agrupa notificaciones: una etiqueta repetida reemplaza a la anterior en
   * lugar de apilarse. Tres avisos de seguimientos son uno solo.
   */
  etiqueta?: string
}

/**
 * Manda el aviso a todos los dispositivos de esas personas.
 *
 * Nunca tira: una notificación que no sale no puede voltear la acción que la
 * disparó. Marcar un lead como respondido tiene que funcionar aunque el
 * servidor de push esté caído.
 */
export async function enviarPush(userIds: string[], aviso: Aviso): Promise<number> {
  if (userIds.length === 0 || !pushConfigurado()) return 0

  const suscripciones = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds))

  const carga = JSON.stringify(aviso)
  let enviados = 0

  await Promise.all(
    suscripciones.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          carga,
        )
        enviados++
        await db.execute(sql`
          update push_subscriptions set last_ok_at = now(), fallos = 0 where id = ${s.id}::uuid
        `)
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        /*
         * 404 y 410 significan que la suscripción ya no existe: el celular se
         * formateó, se desinstaló la app o se limpiaron los datos. Se borra en
         * el momento en vez de acumular endpoints muertos.
         */
        if (status === 404 || status === 410) {
          await db.execute(sql`delete from push_subscriptions where id = ${s.id}::uuid`)
        } else {
          await db.execute(sql`
            update push_subscriptions set fallos = fallos + 1 where id = ${s.id}::uuid
          `)
          await db.execute(sql`delete from push_subscriptions where id = ${s.id}::uuid and fallos >= 3`)
        }
      }
    }),
  )

  return enviados
}

/** Guarda la suscripción de un dispositivo. Un endpoint es un dispositivo. */
export async function guardarSuscripcion(params: {
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
}): Promise<void> {
  await db.execute(sql`
    insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_ok_at)
    values (${params.userId}::uuid, ${params.endpoint}, ${params.p256dh}, ${params.auth},
            ${params.userAgent}, now())
    on conflict (endpoint) do update
      set user_id = excluded.user_id,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          fallos = 0
  `)
}

export async function borrarSuscripcion(endpoint: string): Promise<void> {
  await db.execute(sql`delete from push_subscriptions where endpoint = ${endpoint}`)
}
