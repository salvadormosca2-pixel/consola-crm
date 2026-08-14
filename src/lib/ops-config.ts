import { z } from 'zod'

/**
 * Configuración operativa. Todos estos valores son editables desde
 * Configuración y viven en la tabla `settings`; acá están los defaults y el
 * esquema que los valida.
 *
 * Nada de esto se hardcodea en la lógica: la rotación, el calentamiento y el
 * piloto leen siempre de acá.
 */

/**
 * Escala de calentamiento. El índice es el día de USO del número, no del
 * almanaque: si un número no mandó el martes, el miércoles sigue en el mismo día.
 */
export const ESCALA_CALENTAMIENTO_DEFAULT = [5, 8, 12, 16, 21, 26, 30] as const

export const opsConfigSchema = z.object({
  /** Cupo de cada día del calentamiento, en orden. */
  escalaCalentamiento: z
    .array(z.number().int().min(1).max(500))
    .min(1)
    .default([...ESCALA_CALENTAMIENTO_DEFAULT]),

  /**
   * Espera mínima entre envíos de un número que está calentando. Es un piso: la
   * espera real es max(este valor, ventana ÷ cupo del día), para que los mensajes
   * queden repartidos en toda la ventana y no juntos en la primera hora.
   */
  calentamientoEsperaMinimaSeg: z.number().int().min(0).default(480),

  /** Tasa de respuesta por debajo de la cual el número repite el día. */
  calentamientoRespuestaMinima: z.number().min(0).max(1).default(0.1),

  /** Cuántas veces puede repetir un día antes de pasar a pausada. */
  calentamientoRepeticionesMaximas: z.number().int().min(1).default(3),

  /** Demora aleatoria entre envíos consecutivos del sistema, en segundos. */
  demoraAleatoriaSeg: z.tuple([z.number().int().min(0), z.number().int().min(0)]).default([90, 300]),

  /** Espera mínima entre dos envíos de la misma cuenta ya activa. */
  esperaMismaCuentaSeg: z.number().int().min(0).default(240),

  /** Ventana horaria de envío, hora de la zona operativa. */
  ventanaInicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  ventanaFin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('20:00'),

  /**
   * Días de la semana en los que se envía (0 = domingo … 6 = sábado).
   * Por defecto, todos menos domingo.
   */
  diasActivos: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),

  /** Fallos seguidos que bloquean una cuenta. */
  fallosParaBloquear: z.number().int().min(1).default(3),

  /* ── Chatwoot ── */

  /**
   * Colchón de mensajes que la consola deja libre en cada cuenta.
   *
   * Con Chatwoot hay dos emisores: la consola (bajo transacción, no puede
   * pasarse) y vos escribiendo a mano en Chatwoot (que se cuenta recién cuando
   * llega el webhook). En esa ventana la consola cuenta de menos y podría
   * aprobar un envío que termine desbordando el cupo del número.
   *
   * Frenando la consola unos mensajes antes del tope, las respuestas a mano
   * tienen lugar sin desbordar. En 0 se comporta como antes.
   */
  colchonParaRespuestas: z.number().int().min(0).max(100).default(3),

  /**
   * Minutos de silencio del webhook que bloquean los seguimientos.
   *
   * Un webhook caído en silencio hace que la consola crea que nadie contestó y
   * siga mandando seguimientos a gente que ya respondió — el peor error posible
   * del sistema. Las aperturas siguen habilitadas: a un contacto que nunca
   * recibió nada no se le puede estar pisando una respuesta.
   */
  minutosSilencioParaBloquear: z.number().int().min(1).default(60),

  /** Minutos sin webhook a partir de los cuales el indicador deja de estar verde. */
  minutosSilencioParaAvisar: z.number().int().min(1).default(15),

  /* ── Piloto ── */
  pilotoTamanoTanda: z.number().int().min(1).max(500).default(30),
  /** Horas que tienen que pasar desde el último envío antes de poder aprobar. */
  pilotoEsperaHoras: z.number().int().min(0).default(24),
  /** Verde: tasa de respuesta ≥ este valor y sin fallos. */
  pilotoUmbralVerde: z.number().min(0).max(1).default(0.15),
  /** Rojo: por debajo de este valor el escalado queda bloqueado. */
  pilotoUmbralRojo: z.number().min(0).max(1).default(0.08),
  /** Días seguidos bajo el umbral rojo que disparan el aviso de re-piloto. */
  pilotoDiasParaDegradar: z.number().int().min(1).default(3),
})

export type OpsConfig = z.infer<typeof opsConfigSchema>

export const OPS_CONFIG_DEFAULT: OpsConfig = opsConfigSchema.parse({})

/** Clave con la que se guarda en la tabla `settings`. */
export const OPS_CONFIG_KEY = 'ops'

/** Cupo del día N del calentamiento (N empieza en 1). */
export function cupoDeCalentamiento(cfg: OpsConfig, dia: number): number {
  const i = Math.min(Math.max(dia, 1), cfg.escalaCalentamiento.length) - 1
  return cfg.escalaCalentamiento[i] ?? cfg.escalaCalentamiento[0] ?? 5
}

/** Cuántos días dura el calentamiento con la escala configurada. */
export function diasDeCalentamiento(cfg: OpsConfig): number {
  return cfg.escalaCalentamiento.length
}
