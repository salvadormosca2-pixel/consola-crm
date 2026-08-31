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

  /**
   * Horas hábiles que puede pasar un lead esperando que alguien decida a qué
   * pista va. Pasadas estas, se marca en rojo en la cola de clasificación.
   *
   * Es el cuello de botella más caro de la operación: son leads que ya hablaron
   * y están esperando. Se cuenta en horas hábiles y no de reloj — uno que
   * contestó a las once de la noche no está atrasado a las tres de la mañana.
   */
  horasParaClasificar: z.number().int().min(1).max(72).default(4),

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

/** Los días de todos los escalones, para pintar el panel de una. */
export function diasDeTodosLosPasos(cfg: SettersConfig): Record<string, number> {
  return Object.fromEntries(PASOS_DE_PISTA.map((p) => [String(p), diasDelPaso(cfg, p)]))
}

/**
 * Cuándo sale un paso, contado **desde el último movimiento del chat**.
 *
 * No desde que entró el lead ni desde que arrancó la secuencia: desde el último
 * evento real —último envío, última respuesta del lead, o último mensaje que
 * escribió el setter a mano—. Si la oferta salió el lunes y el lead contesta el
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
 * Qué le toca después del mensaje que se acaba de mandar.
 *
 * Devuelve null cuando la escalera se terminó: de ahí en más el lead queda para
 * nurture y vuelve a entrar a los 30-60 días. Ninguna rama sigue para siempre,
 * porque cada intento de más es cupo gastado y riesgo para la cuenta.
 *
 * Las dos bifurcaciones están en el primer contacto, y las dos dependen de si
 * el lead abrió la boca:
 *
 *   · mandada **la entrada** y sin respuesta, nunca ve la oferta: se va al
 *     reintento de apertura, que es la única pista que gasta cupo porque el
 *     chat jamás se abrió. Si contesta, la oferta se la programa la acción que
 *     marca la respuesta, y sale en el acto.
 *   · mandada **la oferta** y sin respuesta, entra a silencio. Si contesta, no
 *     se decide acá: lo decide una persona en la cola de clasificación, que es
 *     la que sabe si esa respuesta fue una objeción (tibio), ruido (silencio) o
 *     un sí (interesado).
 *
 * Dentro de una pista no hay bifurcación: se baja un escalón por vez.
 */
export function proximoSeguimiento(
  cfg: SettersConfig,
  paso: PasoDeSeguimiento,
  desde: Date = new Date(),
  yaContesto = false,
): ProximoPaso | null {
  if (!esPaso(paso)) return null

  if (paso === 1) return yaContesto ? null : entrarAPista(cfg, 'sin_abrir', desde)
  if (paso === 2) return yaContesto ? null : entrarAPista(cfg, 'silencio', desde)

  const siguiente = siguienteDeLaPista(paso)
  if (!siguiente) return null
  return { paso: siguiente.paso, cuando: cuandoSale(cfg, siguiente.paso, desde) }
}

/**
 * Contestó la entrada: le toca la oferta, y le toca **ahora**.
 *
 * Si contestó, está mirando el celular en ese momento. Hacerlo esperar hasta
 * mañana es perder la conversación que se acaba de ganar.
 */
export function ofertaTrasLaRespuesta(desde: Date = new Date()): ProximoPaso {
  return { paso: 2, cuando: desde }
}

/* ── Las pistas que elige una persona ─────────────────────────────────── */

/**
 * Adónde va el lead que contestó la oferta. Lo decide alguien mirando el hilo,
 * no el sistema: la diferencia entre "cuánto sale" y "no me interesa" no se
 * puede deducir de un texto libre, y equivocarse manda el mensaje que no era.
 */
export const DESTINOS_DE_CLASIFICACION = ['interesado', 'tibio', 'silencio', 'no_interesa'] as const
export type DestinoDeClasificacion = (typeof DESTINOS_DE_CLASIFICACION)[number]

export const DESTINO_META: Record<
  DestinoDeClasificacion,
  { label: string; detalle: string; pista: Pista | null }
> = {
  interesado: {
    label: 'Interesado',
    detalle: 'Dijo que sí. Sale el mensaje que lo lleva a una fecha concreta, en el acto.',
    pista: null,
  },
  tibio: {
    label: 'Tibio',
    detalle: 'Contestó con una duda o una objeción: precio, momento, "después veo".',
    pista: 'tibio',
  },
  silencio: {
    label: 'Silencio',
    detalle: 'Lo que contestó no dice nada. Se lo trata como si no hubiera contestado.',
    pista: 'silencio',
  },
  no_interesa: {
    label: 'No le interesa',
    detalle: 'Dijo que no. Sale el cierre cordial y no se le insiste más.',
    pista: null,
  },
}

/** Qué sale después de clasificar. Las dos pistas esperan; las dos marcas no. */
export function trasClasificar(
  cfg: SettersConfig,
  destino: DestinoDeClasificacion,
  desde: Date = new Date(),
): ProximoPaso {
  const pista = DESTINO_META[destino].pista
  if (pista) return entrarAPista(cfg, pista, desde)
  return destino === 'no_interesa' ? mensajeDeRechazo(desde) : mensajeDeInteres(desde)
}

/* ── Los que salen apenas el setter marca ─────────────────────────────── */

/**
 * Tres situaciones que no nacen de un silencio sino de una marca en la app, y
 * por eso ninguna espera: el lead está del otro lado, ahora.
 */

/** Dijo que le interesa la oferta. Le toca el mensaje que lleva a la fecha. */
export function mensajeDeInteres(desde: Date = new Date()): ProximoPaso {
  return { paso: 6, cuando: desde }
}

/** Dijo que no. Le toca el cierre cordial, que deja la puerta abierta. */
export function mensajeDeRechazo(desde: Date = new Date()): ProximoPaso {
  return { paso: 7, cuando: desde }
}

/** Quedó agendada la reunión. Le toca la confirmación por escrito. */
export function mensajeDeReunion(desde: Date = new Date()): ProximoPaso {
  return { paso: 8, cuando: desde }
}

/** Cuántos escalones tiene cada pista. Para el panel y para los tests. */
export function largoDePista(pista: Pista): number {
  return PISTA_META[pista].pasos.length
}
