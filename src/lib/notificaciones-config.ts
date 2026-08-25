import { z } from 'zod'

import { NOTIFICACION_TIPOS, type NotificacionTipo } from '@/db/enums'

/**
 * Qué avisos quiero recibir y por dónde.
 *
 * Dos canales, y son distintos a propósito:
 *
 *   · **campana** — queda en la lista del panel. No interrumpe, se lee cuando
 *     uno mira. Es lo que se apaga cuando algo hace ruido de más.
 *   · **push** — suena en el celular. Es para lo que no puede esperar a que
 *     alguien mire la pantalla: una respuesta o una reunión recién agendada.
 *
 * Falta el tercero que pide la spec, el correo: mandar mails necesita un
 * proveedor de envío (Resend, SES, un SMTP) que todavía no está elegido ni
 * configurado. Ponerlo en la pantalla sin eso sería un interruptor que no hace
 * nada; cuando se decida el proveedor, se suma acá como un canal más.
 */

const canalesSchema = z.object({
  campana: z.boolean().default(true),
  push: z.boolean().default(false),
})

export type CanalesDeAviso = z.infer<typeof canalesSchema>

/**
 * Por defecto: todo en la campana, y push solo para lo que pide una reacción
 * en el momento. Un push por cada lead que vence enseña a ignorar los push.
 */
const DEFAULTS: Record<NotificacionTipo, CanalesDeAviso> = {
  respondio: { campana: true, push: true },
  reunion_agendada: { campana: true, push: true },
  setter_inactivo: { campana: true, push: false },
  leads_por_vencer: { campana: true, push: false },
  seguimientos_atrasados: { campana: true, push: false },
  cuenta_baja_respuesta: { campana: true, push: true },
  mensaje_sin_leer: { campana: true, push: false },
  respuesta_de_setter: { campana: true, push: false },
  recordatorio: { campana: false, push: false },
}

export type NotificacionesConfig = Record<NotificacionTipo, CanalesDeAviso>

export const NOTIFICACIONES_CONFIG_DEFAULT: NotificacionesConfig = DEFAULTS

/**
 * Se valida como diccionario suelto y se completa después, en vez de exigir un
 * objeto con las nueve claves: así, agregar un tipo de aviso nuevo no invalida
 * la configuración guardada de golpe — el tipo nuevo simplemente arranca con su
 * valor por defecto.
 */
export const notificacionesConfigSchema = z
  .record(z.string(), canalesSchema)
  .transform((guardado): NotificacionesConfig => {
    const salida = {} as NotificacionesConfig
    for (const tipo of NOTIFICACION_TIPOS) {
      salida[tipo] = guardado[tipo] ?? DEFAULTS[tipo]
    }
    return salida
  })

export const NOTIFICACIONES_CONFIG_KEY = 'notificaciones'

/**
 * Los avisos que salen del recordatorio a un setter no son para el panel: el
 * destinatario es el setter y ya le llega por su propia vía.
 */
export const TIPOS_CONFIGURABLES: readonly NotificacionTipo[] = NOTIFICACION_TIPOS.filter(
  (t) => t !== 'recordatorio',
)
