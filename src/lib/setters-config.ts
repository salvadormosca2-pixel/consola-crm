import { z } from 'zod'

/**
 * Configuración del módulo de setters.
 *
 * Vive en la tabla `settings` bajo la clave `setters`, igual que la operativa
 * general. Acá están los defaults y el esquema que los valida. Nada de esto se
 * hardcodea en la lógica: la cola, el vencimiento y las alertas leen siempre
 * de acá.
 */

export const settersConfigSchema = z.object({
  /**
   * Cuántas horas después del primer mensaje vuelve el lead a la cola con el
   * segundo. No va pegado al primero a propósito: dos mensajes seguidos desde
   * una cuenta nueva es lo que dispara las restricciones.
   */
  horasSegundoMensaje: z.number().int().min(1).max(240).default(24),

  /**
   * Cuántas horas tiene un setter para trabajar un lead antes de que vuelva
   * solo al pozo. Es lo que garantiza que ningún lead quede muerto en la
   * cuenta de alguien que se cansó o dejó de trabajar.
   */
  horasVencimiento: z.number().int().min(1).max(720).default(48),

  /** Días de silencio después de la oferta antes del último intento (paso 3). */
  diasParaUltimoIntento: z.number().int().min(1).max(60).default(3),

  /**
   * Días sin novedad después de que el lead contestó la entrada, antes de
   * mandarle el reenganche (paso 4). El equipo estuvo hablando en el medio: si
   * la conversación sigue viva, el seguimiento se cancela desde la bandeja.
   */
  diasParaRetomarConversacion: z.number().int().min(1).max(90).default(4),

  /** Días sin novedad después de un "me interesa" antes del reenganche (paso 5). */
  diasParaRetomarInteresado: z.number().int().min(1).max(90).default(5),

  /** Cupo por cuenta de Instagram que se propone al crear un setter. */
  cupoPorCuentaDefault: z.number().int().min(1).max(100).default(30),

  /** Días de atraso en los seguimientos a partir de los cuales me llega alerta. */
  diasAtrasoParaAlerta: z.number().int().min(1).max(30).default(3),

  /**
   * Tasa de respuesta por debajo de la cual una cuenta de Instagram es
   * sospechosa de estar restringida. Con reparto al azar es comparable entre
   * setters, así que un 3% contra un 15% no es casualidad.
   */
  tasaRespuestaMinima: z.number().min(0).max(1).default(0.05),

  /** Cuántos días seguidos por debajo de esa tasa antes de avisarme. */
  diasParaAlertaDeCuenta: z.number().int().min(1).max(30).default(3),

  /** Mínimo de mensajes para que la tasa de respuesta signifique algo. */
  minimoParaMedirTasa: z.number().int().min(1).max(500).default(30),

  /**
   * Reparto automático: cada mañana, a la hora fijada, el pozo se reparte solo
   * entre los setters que tengan cupo. Con esto apagado hay que apretar el
   * botón desde el panel.
   */
  repartoAutomatico: z.boolean().default(true),

  horaReparto: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('08:00'),

  /** Hora a la que sale el resumen del día y las alertas de inactividad. */
  horaResumenDiario: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('21:00'),

  /** Hora por defecto del recordatorio automático de seguimientos. */
  horaRecordatorioDefault: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('10:00'),

  /** Con cuántas horas de anticipación aviso que los leads de alguien vencen. */
  horasParaAvisarVencimiento: z.number().int().min(1).max(48).default(6),

  /* ── Seguridad del ingreso ── */

  /** Intentos fallidos seguidos que bloquean la cuenta un rato. */
  intentosParaBloquear: z.number().int().min(3).max(20).default(5),

  /** Cuántos minutos dura ese bloqueo. */
  minutosDeBloqueo: z.number().int().min(1).max(1440).default(15),

  /** Largo mínimo de la contraseña que elige el setter. */
  /**
   * Largo mínimo de la contraseña que elige el setter.
   *
   * Seis y no diez. Esto se escribe con el pulgar, parado, para entrar a una
   * app que se abre veinte veces por día: una contraseña larga no la hace más
   * segura, la hace anotada en un papel o repetida de otro lado.
   *
   * La seguridad de verdad está en otro lado y no depende de esto: las cuentas
   * las crea el admin —nadie se registra solo—, el ingreso se bloquea a los
   * cinco intentos fallidos, y la sesión dura tanto que casi nunca hay que
   * volver a tipearla.
   */
  largoMinimoPassword: z.number().int().min(4).max(64).default(6),
})

export type SettersConfig = z.infer<typeof settersConfigSchema>

export const SETTERS_CONFIG_DEFAULT: SettersConfig = settersConfigSchema.parse({})

export const SETTERS_CONFIG_KEY = 'setters'

/** Cuándo vence un lead recién asignado. */
export function calcularVencimiento(cfg: SettersConfig, desde: Date = new Date()): Date {
  return new Date(desde.getTime() + cfg.horasVencimiento * 3_600_000)
}

/** Cuándo le toca el segundo mensaje a un lead recién contactado. */
export function calcularSegundoMensaje(cfg: SettersConfig, desde: Date = new Date()): Date {
  return new Date(desde.getTime() + cfg.horasSegundoMensaje * 3_600_000)
}

const DIA = 86_400_000

export type PasoDeSeguimiento = 1 | 2 | 3 | 4 | 5
export interface ProximoPaso {
  paso: PasoDeSeguimiento
  cuando: Date
}

/**
 * Qué mensaje le toca después del que se acaba de mandar.
 *
 * Devuelve null cuando ya no le toca nada más: después del último intento se
 * deja de insistir. Si no contestó tres mensajes, el cuarto no lo va a
 * despertar, y cada intento de más es cupo gastado y riesgo para la cuenta.
 * A partir de ahí el lead pasa a la lista de recuperación.
 *
 * Después de la oferta el silencio se lee distinto según quién lo hace: al que
 * nunca dijo nada le toca el último intento (paso 3), y al que había abierto
 * conversación y después se enfrió le toca el reenganche (paso 4). No es lo
 * mismo insistirle a un desconocido que a alguien con quien ya se habló.
 */
export function proximoSeguimiento(
  cfg: SettersConfig,
  paso: PasoDeSeguimiento,
  desde: Date = new Date(),
  yaContesto = false,
): ProximoPaso | null {
  if (paso === 1) {
    return { paso: 2, cuando: new Date(desde.getTime() + cfg.horasSegundoMensaje * 3_600_000) }
  }
  if (paso === 2) {
    return yaContesto
      ? reengancheDeConversacion(cfg, desde)
      : { paso: 3, cuando: new Date(desde.getTime() + cfg.diasParaUltimoIntento * DIA) }
  }
  return null
}

/**
 * Contestó la entrada: le toca la oferta, y le toca **ahora**.
 *
 * Es el único paso que no espera. Los demás se programan para dentro de horas
 * o días porque nacen de un silencio; este nace de que la persona está del
 * otro lado escribiendo. Hacerlo esperar hasta mañana es perder la respuesta
 * que se acaba de ganar.
 */
export function ofertaTrasLaRespuesta(desde: Date = new Date()): ProximoPaso {
  return { paso: 2, cuando: desde }
}

/** Reenganche de una conversación que se enfrió después de la entrada. */
export function reengancheDeConversacion(
  cfg: SettersConfig,
  desde: Date = new Date(),
): ProximoPaso {
  return { paso: 4, cuando: new Date(desde.getTime() + cfg.diasParaRetomarConversacion * DIA) }
}

/** Reenganche de alguien a quien le interesó la oferta y después desapareció. */
export function reengancheDeInteresado(
  cfg: SettersConfig,
  desde: Date = new Date(),
): ProximoPaso {
  return { paso: 5, cuando: new Date(desde.getTime() + cfg.diasParaRetomarInteresado * DIA) }
}
