import type { AccountStatus } from '@/db/enums'
import { cupoDeCalentamiento, diasDeCalentamiento, type OpsConfig } from '@/lib/ops-config'
import { OPS_TZ } from '@/lib/tz'

/**
 * Lógica pura de cupos, ventana horaria y calentamiento.
 *
 * Está separada del acceso a la base a propósito: es la parte que decide si un
 * número puede mandar o no, y tiene que poder testearse exhaustivamente sin
 * levantar Postgres. La transacción de reserva (reserve.ts) la usa, no la
 * reimplementa.
 */

export interface CuentaParaCupo {
  status: AccountStatus
  dailyCap: number
  minGapSeconds: number
  warmupDay: number | null
  windowStart: string
  windowEnd: string
}

/**
 * Cupo del día de una cuenta.
 *
 * Mientras está calentando, el cupo lo fija la escala de calentamiento y NO
 * `dailyCap`: un número nuevo no manda 30 porque alguien escribió 30 en la ficha.
 */
export function cupoEfectivo(cuenta: CuentaParaCupo, cfg: OpsConfig): number {
  if (cuenta.status === 'calentando') {
    return cupoDeCalentamiento(cfg, cuenta.warmupDay ?? 1)
  }
  if (cuenta.status !== 'activa') return 0
  return cuenta.dailyCap
}

/**
 * Hasta dónde puede llegar la consola por sí sola.
 *
 * Es el cupo del día menos el colchón reservado para las respuestas que escribís
 * a mano en Chatwoot. Esas se cuentan recién cuando llega el webhook, así que
 * sin colchón la consola podría aprobar un envío que termine desbordando el
 * cupo real del número.
 *
 * El colchón nunca deja el techo en cero: un cupo chico (los primeros días del
 * calentamiento) tiene que poder mandar igual.
 */
export function techoParaLaConsola(cuenta: CuentaParaCupo, cfg: OpsConfig): number {
  const cupo = cupoEfectivo(cuenta, cfg)
  if (cupo <= 0) return 0
  return Math.max(1, cupo - cfg.colchonParaRespuestas)
}

/**
 * Espera mínima entre dos envíos de la misma cuenta, en segundos.
 *
 * Durante el calentamiento no alcanza con el piso configurado: 5 mensajes con 8
 * minutos de espera entran en 40 minutos, y mandar el cupo del día 1 en 40
 * minutos es peor que no calentar. Así que la espera es la mayor entre el piso
 * y "ventana horaria dividida el cupo del día", que reparte los envíos a lo
 * largo de toda la ventana.
 */
export function esperaMinimaSeg(cuenta: CuentaParaCupo, cfg: OpsConfig): number {
  if (cuenta.status !== 'calentando') {
    return Math.max(cuenta.minGapSeconds, cfg.esperaMismaCuentaSeg)
  }

  const cupo = cupoEfectivo(cuenta, cfg)
  if (cupo <= 0) return cfg.calentamientoEsperaMinimaSeg

  const ventanaSeg = duracionVentanaSeg(cuenta.windowStart, cuenta.windowEnd)
  const repartido = Math.floor(ventanaSeg / cupo)
  return Math.max(cfg.calentamientoEsperaMinimaSeg, repartido)
}

/** Segundos que dura la ventana horaria. */
export function duracionVentanaSeg(inicio: string, fin: string): number {
  const a = minutosDeHora(inicio)
  const b = minutosDeHora(fin)
  return Math.max(b - a, 0) * 60
}

function minutosDeHora(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.slice(0, 5).split(':')
  return Number(h) * 60 + Number(m)
}

/** Partes de un instante en la zona operativa, sin depender de la TZ del proceso. */
export function partesLocales(
  at: Date,
  timeZone: string = OPS_TZ,
): { fecha: string; minutos: number; diaSemana: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]))
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  // Intl devuelve '24' para medianoche en hourCycle h23/h24 según el motor.
  const hora = Number(p.hour) % 24
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    minutos: hora * 60 + Number(p.minute),
    diaSemana: dias[p.weekday ?? 'Mon'] ?? 1,
  }
}

export type EstadoVentana = { abierta: true } | { abierta: false; motivo: 'ventana' | 'domingo' }

/** ¿Se puede enviar en este instante, según ventana horaria y días activos? */
export function ventanaAbierta(
  cuenta: Pick<CuentaParaCupo, 'windowStart' | 'windowEnd'>,
  cfg: OpsConfig,
  at: Date = new Date(),
  timeZone: string = OPS_TZ,
): EstadoVentana {
  const { minutos, diaSemana } = partesLocales(at, timeZone)

  if (!cfg.diasActivos.includes(diaSemana)) {
    return { abierta: false, motivo: 'domingo' }
  }
  const desde = minutosDeHora(cuenta.windowStart)
  const hasta = minutosDeHora(cuenta.windowEnd)
  if (minutos < desde || minutos >= hasta) {
    return { abierta: false, motivo: 'ventana' }
  }
  return { abierta: true }
}

/**
 * Rango UTC de la fecha operativa que contiene a `at`.
 *
 * El recuento de cupo filtra por este rango en vez de aplicar AT TIME ZONE
 * sobre la columna: así la consulta usa el índice (account_id, sent_at) en vez
 * de recorrer la tabla.
 */
export function rangoDelDiaUtc(
  at: Date = new Date(),
  timeZone: string = OPS_TZ,
): { fecha: string; desde: Date; hasta: Date } {
  const { fecha } = partesLocales(at, timeZone)
  const desde = inicioDeFechaUtc(fecha, timeZone)
  const hasta = new Date(desde.getTime() + 24 * 3600 * 1000)
  // Argentina no tiene horario de verano, pero si algún día lo tuviera el día
  // podría no durar 24 h exactas: se recalcula desde la fecha siguiente.
  const fechaSiguiente = sumarDias(fecha, 1)
  return { fecha, desde, hasta: inicioDeFechaUtc(fechaSiguiente, timeZone) ?? hasta }
}

/** Medianoche de una fecha local ('2026-08-13') expresada en UTC. */
export function inicioDeFechaUtc(fecha: string, timeZone: string = OPS_TZ): Date {
  const [y = 0, m = 1, d = 1] = fecha.split('-').map(Number)
  // Se parte de la medianoche UTC nominal y se corrige por el desfase real de
  // la zona en ese instante.
  const nominal = Date.UTC(y, m - 1, d, 0, 0, 0)
  const desfase = desfaseZonaMs(new Date(nominal), timeZone)
  const ajustado = nominal - desfase
  // Segunda pasada: el desfase puede cambiar al cruzar el ajuste.
  const desfase2 = desfaseZonaMs(new Date(ajustado), timeZone)
  return new Date(nominal - desfase2)
}

/** Milisegundos que la zona está adelantada respecto de UTC en ese instante. */
function desfaseZonaMs(at: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]))
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  )
  return comoUtc - at.getTime()
}

function sumarDias(fecha: string, n: number): string {
  const [y = 0, m = 1, d = 1] = fecha.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(
    t.getUTCDate(),
  ).padStart(2, '0')}`
}

/* ── Calentamiento ─────────────────────────────────────────────────────── */

export interface EstadoCalentamiento {
  warmupDay: number | null
  warmupLastAdvancedOn: string | null
  warmupRepeats: number
}

export type DecisionCalentamiento =
  | { accion: 'sin_cambio' }
  | { accion: 'avanza'; a: number }
  | { accion: 'repite'; dia: number; repeticiones: number; motivo: string }
  | { accion: 'pausa'; motivo: string }
  | { accion: 'termina' }
  | { accion: 'termina_con_baja_respuesta'; tasa: number }

/**
 * Decide qué le pasa al calentamiento de un número al cerrar un día de uso.
 *
 * Se llama una vez por día operativo, y solo si el número mandó algo: el
 * calentamiento cuenta días de uso, no del almanaque.
 */
export function decidirCalentamiento(
  estado: EstadoCalentamiento,
  senales: {
    /** Fecha operativa que se está cerrando. */
    fecha: string
    /** Mensajes enviados por este número en esa fecha. */
    enviados: number
    /** Respuestas recibidas sobre los mensajes de este número (acumulado del calentamiento). */
    tasaRespuesta: number
    /** Hubo fallo de entrega o desconexión de la instancia ese día. */
    huboProblema: boolean
  },
  cfg: OpsConfig,
): DecisionCalentamiento {
  const dia = estado.warmupDay ?? 1

  // El día solo se cierra si el número mandó. Sin envíos, no avanza.
  if (senales.enviados <= 0) return { accion: 'sin_cambio' }

  // Ya se cerró este día operativo: no se avanza dos veces el mismo día.
  if (estado.warmupLastAdvancedOn === senales.fecha) return { accion: 'sin_cambio' }

  const bajaRespuesta = senales.tasaRespuesta < cfg.calentamientoRespuestaMinima
  if (senales.huboProblema || bajaRespuesta) {
    const repeticiones = estado.warmupRepeats + 1
    if (repeticiones >= cfg.calentamientoRepeticionesMaximas) {
      return {
        accion: 'pausa',
        motivo: senales.huboProblema
          ? 'Repitió el día de calentamiento tres veces por fallos de entrega.'
          : `Repitió el día de calentamiento tres veces con menos del ${Math.round(
              cfg.calentamientoRespuestaMinima * 100,
            )}% de respuestas.`,
      }
    }
    return {
      accion: 'repite',
      dia,
      repeticiones,
      motivo: senales.huboProblema
        ? 'Hubo un fallo de entrega o una desconexión.'
        : `La tasa de respuesta quedó en ${Math.round(senales.tasaRespuesta * 100)}%.`,
    }
  }

  const ultimo = diasDeCalentamiento(cfg)
  if (dia >= ultimo) {
    // Terminó los días, pero solo pasa a activa si el número está sano.
    return senales.tasaRespuesta < cfg.calentamientoRespuestaMinima
      ? { accion: 'termina_con_baja_respuesta', tasa: senales.tasaRespuesta }
      : { accion: 'termina' }
  }

  return { accion: 'avanza', a: dia + 1 }
}

/* ── Checklist de preparación ──────────────────────────────────────────── */

/**
 * Lo que el software no puede verificar y tengo que confirmar yo antes de que
 * un número entre al reparto. Mandar poco no es calentar: lo que calienta un
 * número es el tráfico bidireccional y un perfil que parece un negocio real.
 */
export const CHECKLIST_PREPARACION = [
  { key: 'perfil', label: 'WhatsApp Business instalado, con foto, nombre del negocio y descripción' },
  { key: 'antiguedad', label: 'El número tiene al menos 3 días de vida' },
  { key: 'conversaciones', label: 'Ya tuvo conversaciones reales de ida y vuelta, no solo salientes' },
  { key: 'celular', label: 'El celular con ese número está encendido y accesible' },
  { key: 'instancia', label: 'La instancia de Evolution está conectada y estable, sin re-escaneos de QR en 24 h' },
] as const

export type ClavePreparacion = (typeof CHECKLIST_PREPARACION)[number]['key']

export function preparacionCompleta(checklist: unknown): boolean {
  if (typeof checklist !== 'object' || checklist === null) return false
  const c = checklist as Record<string, unknown>
  return CHECKLIST_PREPARACION.every((item) => c[item.key] === true)
}

export function faltantesDePreparacion(checklist: unknown): string[] {
  const c = (typeof checklist === 'object' && checklist !== null ? checklist : {}) as Record<
    string,
    unknown
  >
  return CHECKLIST_PREPARACION.filter((i) => c[i.key] !== true).map((i) => i.label)
}

/* ── Demora aleatoria ──────────────────────────────────────────────────── */

/**
 * Demora entre envíos consecutivos del sistema. Aleatoria a propósito: un ritmo
 * constante es exactamente lo que detecta una automatización.
 */
export function demoraAleatoriaSeg(cfg: OpsConfig, azar: () => number = Math.random): number {
  const [min, max] = cfg.demoraAleatoriaSeg
  if (max <= min) return min
  // Math.min: con un generador que devuelva exactamente 1 el cálculo se pasaría
  // del máximo en 1 segundo.
  return Math.min(max, min + Math.floor(azar() * (max - min + 1)))
}
