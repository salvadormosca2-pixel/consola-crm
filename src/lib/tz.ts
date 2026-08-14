/**
 * Todo se guarda en UTC. La operación (cupos, reinicio de contadores, ventanas
 * horarias) se razona en la zona de Catamarca. Estas funciones son el único
 * lugar donde se hace la conversión.
 */

export const OPS_TZ = process.env.OPS_TIMEZONE ?? 'America/Argentina/Catamarca'

/** Fecha operativa ('2026-08-13') del instante dado, en la zona de operación. */
export function opsDate(at: Date = new Date(), timeZone: string = OPS_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Hora del día 'HH:mm' en la zona de operación. */
export function opsTime(at: Date = new Date(), timeZone: string = OPS_TZ): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
}

/** '13/08 14:32' — formato compacto para columnas de tabla. */
export function formatCorto(at: Date | string | null | undefined): string {
  if (!at) return '—'
  const d = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: OPS_TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(', ', ' ')
}

/** '13/08/2026 14:32' — formato completo para la ficha y la línea de tiempo. */
export function formatLargo(at: Date | string | null | undefined): string {
  if (!at) return '—'
  const d = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: OPS_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(', ', ' ')
}

/** 'hace 3 h', 'hace 2 d'. Devuelve '—' si no hay fecha. */
export function haceCuanto(at: Date | string | null | undefined): string {
  if (!at) return '—'
  const d = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(d.getTime())) return '—'

  const seg = Math.round((Date.now() - d.getTime()) / 1000)
  const futuro = seg < 0
  const abs = Math.abs(seg)
  const prefijo = futuro ? 'en ' : 'hace '

  if (abs < 60) return futuro ? 'en instantes' : 'recién'
  if (abs < 3600) return `${prefijo}${Math.floor(abs / 60)} min`
  if (abs < 86_400) return `${prefijo}${Math.floor(abs / 3600)} h`
  if (abs < 2_592_000) return `${prefijo}${Math.floor(abs / 86_400)} d`
  return formatCorto(d)
}
