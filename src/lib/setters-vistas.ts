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
 *   Por contactar  →  Contactados  →  Respondió 1er mensaje
 *        (cola)        "contestó"      "enviar la oferta"
 *                                            ↓
 *   Reuniones  ←  Respondió la oferta  ←  Le mandé la oferta
 *                    "agendó"              "contestó"
 *
 * Antes cada fila mostraba todos los botones a la vez y no se entendía cuál
 * tocar. Ahora el botón dice exactamente qué hacer, y al tocarlo el lead se
 * mueve a la pestaña siguiente.
 */
export const PESTANAS = [
  'por_contactar',
  'contactados',
  'respondio_primero',
  'oferta_enviada',
  'respondio_oferta',
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
  respondio_primero: {
    label: 'Respondió 1er mensaje',
    etiqueta: 'Contestó · falta la oferta',
    vacio: 'Todavía nadie contestó el primer mensaje.',
  },
  oferta_enviada: {
    label: 'Le mandé la oferta',
    etiqueta: 'Le mandé la oferta',
    vacio: 'Todavía no mandaste ninguna oferta.',
  },
  respondio_oferta: {
    label: 'Respondió la oferta',
    etiqueta: 'Contestó la oferta',
    vacio: 'Todavía nadie contestó la oferta.',
  },
  reuniones: {
    label: 'Reuniones',
    etiqueta: 'Reunión agendada',
    vacio: 'Todavía no agendaste ninguna reunión.',
  },
}

/* ── Las vistas obligatorias del panel ────────────────────────────────── */

export const VISTAS = [
  'respondieron',
  'oferta',
  'sin_contactar',
  'sin_respuesta',
  'esperando_segundo',
  'vencidos',
  'inexistentes',
] as const
export type Vista = (typeof VISTAS)[number]

export const VISTA_META: Record<Vista, { label: string; explicacion: string }> = {
  respondieron: {
    label: 'Respondieron 1er mensaje',
    explicacion:
      'Abrieron conversación y todavía no saben a qué nos dedicamos. Acá entramos nosotros a contarles. Ordenados por el que hace más que espera: es mi cola de trabajo.',
  },
  oferta: {
    label: 'Respondieron 2do mensaje',
    explicacion:
      'Ya recibieron el segundo mensaje, así que saben qué les ofrecemos y dijeron que sí o que no. Los que dijeron que sí son los mejores leads que hay.',
  },
  sin_contactar: {
    label: 'Sin contactar',
    explicacion:
      'Leads asignados que nadie tocó, con las horas que les quedan antes de vencer. Es donde veo si alguien no está trabajando.',
  },
  sin_respuesta: {
    label: 'Nunca contestaron',
    explicacion:
      'Recibieron los dos mensajes y nunca dijeron nada. No son un "no": se les pasó. Elegilos y devolvelos al pozo para volver a intentar más adelante.',
  },
  esperando_segundo: {
    label: 'Seguimiento atrasado',
    explicacion:
      'Les toca un mensaje que todavía no salió: la oferta o alguno de los reenganches, con los días de atraso. Es la misma cuenta que el control de seguimientos.',
  },
  vencidos: {
    label: 'Vencidos y devueltos',
    explicacion: 'Leads que volvieron al pozo y por qué setter pasaron.',
  },
  inexistentes: {
    label: 'Cuentas inexistentes',
    explicacion: 'Perfiles que no existen. Sirve para limpiar la lista scrapeada.',
  },
}
