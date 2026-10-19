/**
 * Las clasificaciones del control de seguimientos.
 *
 * Son el recorrido del trabajo contado en números: cuántos faltan por
 * contactar, cuántos se contactaron, cuántos quedaron calificados, cuántos
 * seguimientos se hicieron, cuántos faltan y cuántos se atrasaron.
 *
 * Las mismas seis se usan en la pantalla general y en la ficha de cada setter,
 * a propósito: si el vocabulario cambia entre pantallas, los números dejan de
 * poder compararse.
 *
 * Vive en `lib` porque las usan las dos puntas: la consulta del servidor y los
 * botones que las abren.
 */

export const CLASIFICACIONES = [
  'por_contactar',
  'contactados',
  'calificados',
  'seguimiento_hecho',
  'falta_seguimiento',
  'atrasados',
] as const
export type Clasificacion = (typeof CLASIFICACIONES)[number]

export type GrupoDeClasificacion = 'trabajo' | 'resultado'

export interface MetaDeClasificacion {
  /** Cómo se llama en la pantalla general. */
  label: string
  /** Cómo se lee en la ficha de un setter: "contactó a 30". */
  enSetter: string
  detalle: string
  grupo: GrupoDeClasificacion
  /** Un número alto acá es bueno, malo, o simplemente un dato. */
  tono: 'bueno' | 'malo' | 'neutro'
  vacio: string
}

export const CLASIFICACION_META: Record<Clasificacion, MetaDeClasificacion> = {
  por_contactar: {
    label: 'Faltan por contactar',
    enSetter: 'le faltan',
    detalle: 'Leads asignados que todavía no recibieron el primer mensaje.',
    grupo: 'trabajo',
    tono: 'malo',
    vacio: 'No queda ninguno sin contactar.',
  },
  contactados: {
    label: 'Contactados',
    enSetter: 'contactó a',
    detalle: 'Ya recibieron el primer mensaje.',
    grupo: 'trabajo',
    tono: 'neutro',
    vacio: 'Todavía no se contactó a nadie.',
  },
  calificados: {
    label: 'Calificados',
    enSetter: 'calificó a',
    detalle:
      'Contestaron y se decidió seguirlos. Son los únicos que reciben seguimiento, y el número que de verdad mide el trabajo de un setter.',
    grupo: 'resultado',
    tono: 'bueno',
    vacio: 'Todavía no hay ninguno calificado.',
  },
  seguimiento_hecho: {
    label: 'Seguimiento hecho',
    enSetter: 'hizo seguimiento a',
    detalle: 'Recibieron al menos un mensaje después del primero.',
    grupo: 'trabajo',
    tono: 'bueno',
    vacio: 'Todavía no se hizo ningún seguimiento.',
  },
  falta_seguimiento: {
    label: 'Falta hacer seguimiento',
    enSetter: 'le falta seguir a',
    detalle: 'Les toca un mensaje que todavía no salió.',
    grupo: 'trabajo',
    tono: 'malo',
    vacio: 'No falta ningún seguimiento.',
  },
  atrasados: {
    label: 'Seguimientos no hechos',
    enSetter: 'tiene atrasados',
    detalle: 'Les tocaba un día anterior y siguen sin salir. Son los que se pierden.',
    grupo: 'trabajo',
    tono: 'malo',
    vacio: 'No hay ninguno atrasado.',
  },
}

export function esClasificacion(v: string | undefined): v is Clasificacion {
  return v !== undefined && (CLASIFICACIONES as readonly string[]).includes(v)
}
