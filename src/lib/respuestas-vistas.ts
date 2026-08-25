/**
 * Las clasificaciones de la bandeja de respuestas.
 *
 * "Respondió" no dice nada: están todos ahí porque respondieron. Lo que cambia
 * el trabajo es **a qué** contestaron y **qué dijeron**: al que contestó la
 * entrada le falta la oferta y eso lo manda el setter; al que contestó la
 * oferta hay que cerrarlo, y el que dijo que le interesa es el que se atiende
 * hoy.
 *
 * Igual que en el control de seguimientos, las mismas clasificaciones se usan
 * en la pantalla general y en la de cada setter: si el vocabulario cambia entre
 * pantallas, los números dejan de poder compararse.
 */

export const RESPUESTAS = [
  'sin_clasificar',
  'sin_oferta',
  'oferta',
  'interesados',
  'no_interesa',
] as const
export type Respuesta = (typeof RESPUESTAS)[number]

export type GrupoDeRespuesta = 'atender' | 'oferta'

export interface MetaDeRespuesta {
  label: string
  /** Cómo se lee en la pantalla de un setter: "le faltan 4 ofertas". */
  enSetter: string
  detalle: string
  grupo: GrupoDeRespuesta
  tono: 'bueno' | 'malo' | 'neutro'
  vacio: string
}

export const RESPUESTA_VISTA_META: Record<Respuesta, MetaDeRespuesta> = {
  sin_clasificar: {
    label: 'Sin clasificar',
    enSetter: 'sin clasificar',
    detalle: 'Contestaron y todavía no los clasificaste. Es lo que hay que sacar hoy.',
    grupo: 'atender',
    tono: 'malo',
    vacio: 'No queda nada sin clasificar.',
  },
  sin_oferta: {
    label: 'Les falta la oferta',
    enSetter: 'le falta ofertar a',
    detalle:
      'Contestaron la entrada y todavía no saben a qué nos dedicamos. La oferta la manda el setter desde el celular.',
    grupo: 'atender',
    tono: 'malo',
    vacio: 'Nadie está esperando la oferta.',
  },
  oferta: {
    label: 'Respondieron la oferta',
    enSetter: 'le respondieron la oferta',
    detalle: 'Ya saben qué les ofrecemos y dijeron que sí o que no.',
    grupo: 'oferta',
    tono: 'neutro',
    vacio: 'Todavía nadie respondió la oferta.',
  },
  interesados: {
    label: 'Les interesa',
    enSetter: 'tiene interesados',
    detalle: 'Vieron la oferta y dijeron que sí. Son los mejores leads que hay.',
    grupo: 'oferta',
    tono: 'bueno',
    vacio: 'Todavía no hay ninguno interesado.',
  },
  no_interesa: {
    label: 'No les interesa',
    enSetter: 'dijeron que no',
    detalle: 'Vieron la oferta y dijeron que no. Cuenta como respuesta del setter igual.',
    grupo: 'oferta',
    tono: 'neutro',
    vacio: 'Todavía nadie dijo que no.',
  },
}

export function esRespuesta(v: string | undefined): v is Respuesta {
  return v !== undefined && (RESPUESTAS as readonly string[]).includes(v)
}
