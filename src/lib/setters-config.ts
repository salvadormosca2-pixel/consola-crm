import { z } from 'zod'

import {
  esPaso,
  PASOS_DE_PISTA,
  PISTA_META,
  primerPasoDe,
  siguienteDeLaPista,
  ubicacionDePaso,
  type Paso,
  type Pista,
} from './pistas'

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

  /**
   * Los días de espera de cada escalón, por número de paso.
   *
   * Es un mapa y no un campo por paso porque una pista es una escalera de
   * largo variable: con cuatro escalones en silencio, cuatro en tibio y dos en
   * reintento, un campo por cada uno son diez campos que hay que agregar al
   * esquema cada vez que se suma un toque. Lo que falte acá cae en el valor por
   * defecto que trae el modelo.
   */
  diasPorPaso: z.record(z.string(), z.number().int().min(0).max(120)).default({}),

  /**
   * El texto que sale cuando ese lead no tiene uno escrito para él, por paso.
   *
   * Es la vuelta de atrás a una decisión que en la práctica no se podía
   * sostener: con el texto obligatoriamente propio, nadie podía mandar nada
   * hasta que el admin escribiera un mensaje por cada lead, uno por uno. Con
   * cuarenta leads nuevos por día eso es el cuello de botella de toda la
   * operación, y el equipo entero mira la cola bloqueada.
   *
   * Así que hay dos niveles y el de arriba gana:
   *
   *   1. el texto escrito para **ese** lead, en `lead_textos`;
   *   2. si no tiene, el de por defecto de su paso, que está acá.
   *
   * Lo que no vuelve son las plantillas con `{{negocio}}` adentro: esto es un
   * texto plano, igual para todos, y el que quiera decir algo del negocio se
   * escribe lead por lead. Sin un texto acá y sin uno propio, el lead sigue
   * bloqueado: nunca sale un mensaje que nadie escribió.
   */
  textoPorPaso: z.record(z.string(), z.string().trim().max(2000)).default({}),

  /* ── Del modelo viejo, antes de las pistas ──────────────────────────
     Ya no encadenan nada: los días salen de `diasPorPaso`. Se dejan en el
     esquema porque están guardados en `settings` y sacarlos haría fallar el
     parseo de la configuración que ya existe. */

  /** @deprecated Lo reemplazó el paso 3 dentro de `diasPorPaso`. */
  diasParaUltimoIntento: z.number().int().min(1).max(60).default(3),

  /**
   * Días sin novedad después de que el lead contestó la entrada, antes de
   * mandarle el reenganche (paso 4). El equipo estuvo hablando en el medio: si
   * la conversación sigue viva, el seguimiento se cancela desde la bandeja.
   */
  /** @deprecated Lo reemplazó la pista de tibio. */
  diasParaRetomarConversacion: z.number().int().min(1).max(90).default(4),

  /** Días sin novedad después de un "me interesa" antes del reenganche (paso 5). */
  /** @deprecated Lo reemplazó la pista de tibio. */
  diasParaRetomarInteresado: z.number().int().min(1).max(90).default(5),

  /**
   * Días de silencio después de un reenganche antes del último de todos
   * (paso 9). Es el que cierra: después de este no le vuelve a salir nada.
   */
  /** @deprecated Lo reemplazó el último escalón de cada pista. */
  diasParaUltimoReenganche: z.number().int().min(1).max(120).default(7),

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

const DIA = 86_400_000

/* ── Los días de cada escalón ─────────────────────────────────────────── */

/**
 * Cuántos días espera un paso, según la configuración o el modelo.
 *
 * Lo guardado gana; si no hay nada guardado vale el default de la pista. Así
 * una escalera nueva funciona apenas se agrega, sin obligar a pasar por el
 * panel a cargarle números antes de que sirva.
 */
export function diasDelPaso(cfg: SettersConfig, paso: Paso): number {
  const guardado = cfg.diasPorPaso[String(paso)]
  if (typeof guardado === 'number') return guardado
  return ubicacionDePaso(paso)?.paso.diasDefault ?? 0
}

/**
 * El texto por defecto de un paso, o null si no hay ninguno escrito.
 *
 * Null y cadena vacía son lo mismo acá: un texto en blanco no se manda.
 */
export function textoPorDefecto(cfg: SettersConfig, paso: Paso): string | null {
  const guardado = cfg.textoPorPaso[String(paso)]
  const limpio = typeof guardado === 'string' ? guardado.trim() : ''
  return limpio.length > 0 ? limpio : null
}

/** Los días de todos los escalones, para pintar el panel de una. */
export function diasDeTodosLosPasos(cfg: SettersConfig): Record<string, number> {
  return Object.fromEntries(PASOS_DE_PISTA.map((p) => [String(p), diasDelPaso(cfg, p)]))
}

/**
 * Cuándo sale un paso, contado **desde el último movimiento del chat**.
 *
 * No desde que entró el lead ni desde que arrancó la secuencia: desde el último
 * evento real —último envío, última respuesta del lead, o último mensaje que
 * escribió el setter a mano—. Si el primer mensaje salió el lunes y el lead contesta el
 * viernes, el escalón siguiente cuenta desde el viernes.
 *
 * Contarlo desde el arranque haría que un lead que contestó tarde reciba el
 * seguimiento encima de su propia respuesta.
 */
export function cuandoSale(cfg: SettersConfig, paso: Paso, ultimoMovimiento: Date): Date {
  return new Date(ultimoMovimiento.getTime() + diasDelPaso(cfg, paso) * DIA)
}

/* ── Por dónde sigue el lead ──────────────────────────────────────────── */

export type PasoDeSeguimiento = Paso
export interface ProximoPaso {
  paso: Paso
  cuando: Date
}

/** Entrar al primer escalón de una pista, contando desde el último movimiento. */
export function entrarAPista(
  cfg: SettersConfig,
  pista: Pista,
  desde: Date = new Date(),
): ProximoPaso {
  const paso = primerPasoDe(pista)
  return { paso: paso.paso, cuando: cuandoSale(cfg, paso.paso, desde) }
}

/**
 * Calificar un lead: entra a la escalera de seguimiento.
 *
 * Es la única puerta de entrada al seguimiento, y la abre una persona. El
 * sistema no la puede abrir solo: que un lead haya contestado no dice si vale
 * la pena seguirlo, y mandarle cuatro mensajes a alguien que contestó "no,
 * gracias" es la forma más rápida de que te bloqueen.
 *
 * El primer escalón espera sus días desde la respuesta, igual que todos los
 * demás: calificar no manda nada en el acto.
 */
export function alCalificar(cfg: SettersConfig, desde: Date = new Date()): ProximoPaso {
  return entrarAPista(cfg, 'seguimiento', desde)
}

/**
 * Qué le toca después del mensaje que se acaba de mandar.
 *
 * Devuelve null en los dos extremos del recorrido:
 *
 *   · mandado **el primer mensaje**, no se encadena nada. Lo que sigue no
 *     depende del reloj sino de que alguien lo califique; si nadie lo hace, el
 *     lead vence y vuelve al pozo. Antes acá se programaba solo un reintento de
 *     apertura: dos mensajes a alguien que nunca abrió la boca, gastando cupo
 *     que le hacía falta a los leads nuevos.
 *   · terminada **la escalera**, tampoco: cuatro toques y se corta. Ninguna
 *     rama sigue para siempre.
 *
 * Dentro de la escalera no hay bifurcación: se baja un escalón por vez.
 */
export function proximoSeguimiento(
  cfg: SettersConfig,
  paso: PasoDeSeguimiento,
  desde: Date = new Date(),
): ProximoPaso | null {
  if (!esPaso(paso)) return null

  const siguiente = siguienteDeLaPista(paso)
  if (!siguiente) return null
  return { paso: siguiente.paso, cuando: cuandoSale(cfg, siguiente.paso, desde) }
}

/** Cuántos escalones tiene cada pista. Para el panel y para los tests. */
export function largoDePista(pista: Pista): number {
  return PISTA_META[pista].pasos.length
}
