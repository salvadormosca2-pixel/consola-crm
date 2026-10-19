/**
 * Nombres y explicaciones de las vistas de leads.
 *
 * Viven en `lib` y no en el servidor porque las usan las dos puntas: la
 * consulta que arma cada vista y el botón que la muestra. Un módulo marcado
 * `server-only` no puede entrar a un componente de cliente, y duplicar los
 * rótulos es la forma más fácil de que la pestaña diga una cosa y la consulta
 * traiga otra.
 */

/* ── Las pestañas del setter, en "Mis leads" ──────────────────────────── */

/**
 * Las pestañas son el recorrido del lead, en orden, y cada una tiene **una
 * sola acción**: la que de verdad sigue en esa etapa.
 *
 *   Por contactar  →  Contactados  →  Calificados  →  Reuniones
 *       (cola)         "calificar"      "agendó"
 *
 * Eran seis y ahora son cuatro: las dos que sobraban —"respondió el 1er
 * mensaje" y "le mandé la oferta"— eran escalones del modelo de dos mensajes.
 * Con un solo mensaje de entrada, lo único que hay que decidir sobre un lead
 * contactado es si se lo califica.
 */
export const PESTANAS = [
  'por_contactar',
  'contactados',
  'calificados',
  'reuniones',
] as const
export type Pestana = (typeof PESTANAS)[number]

export interface MetaDePestana {
  label: string
  vacio: string
  /** Qué le pasó al lead para estar acá. Se muestra como etiqueta en la fila. */
  etiqueta: string
}

export const PESTANA_META: Record<Pestana, MetaDePestana> = {
  por_contactar: {
    label: 'Por contactar',
    etiqueta: 'Sin contactar',
    vacio: 'No te queda ninguno sin contactar. Pedí más leads desde la cola del día.',
  },
  contactados: {
    label: 'Contactados',
    etiqueta: 'Le mandé el 1er mensaje',
    vacio: 'Todavía no contactaste a nadie.',
  },
  calificados: {
    label: 'Calificados',
    etiqueta: 'Calificado',
    vacio: 'Todavía no calificaste a nadie. Los que contesten y sirvan van acá.',
  },
  reuniones: {
    label: 'Reuniones',
    etiqueta: 'Reunión agendada',
    vacio: 'Todavía no agendaste ninguna reunión.',
  },
}

/* ── Las vistas obligatorias del panel ────────────────────────────────── */

export const VISTAS = [
  'calificados',
  'sin_contactar',
  'sin_calificar',
  'seguimiento_atrasado',
  'vencidos',
  'inexistentes',
] as const
export type Vista = (typeof VISTAS)[number]

export const VISTA_META: Record<Vista, { label: string; explicacion: string }> = {
  calificados: {
    label: 'Calificados',
    explicacion:
      'Contestaron y alguien decidió que valen la pena. Son los únicos que reciben seguimiento, y los mejores leads que hay: ordenados por el que hace más que espera.',
  },
  sin_contactar: {
    label: 'Sin contactar',
    explicacion:
      'Leads asignados que nadie tocó, con las horas que les quedan antes de vencer. Es donde veo si alguien no está trabajando.',
  },
  sin_calificar: {
    label: 'Contactados sin calificar',
    explicacion:
      'Recibieron el primer mensaje y nadie los calificó: o no contestaron, o lo que contestaron no alcanzó. No reciben nada más. Elegilos y devolvelos al pozo para volver a intentar más adelante.',
  },
  seguimiento_atrasado: {
    label: 'Seguimiento atrasado',
    explicacion:
      'Calificados a los que les toca un escalón que todavía no salió, con los días de atraso. Es la misma cuenta que el control de seguimientos.',
  },
  vencidos: {
    label: 'Vencidos y devueltos',
    explicacion: 'Leads que volvieron al pozo y por qué setter pasaron.',
  },
  inexistentes: {
    label: 'Sacados de circulación',
    explicacion:
      'Los que el setter sacó de la lista: el perfil no existe, o existe y no sirve como lead. El motivo va escrito en cada uno, y es lo que dice qué tan buena vino la lista scrapeada.',
  },
}
