import { z } from 'zod'

/**
 * Los datos que se repiten en todos los mensajes, y las variables.
 *
 * Qué situaciones existen y cómo se encadenan **no está acá**: está en
 * `pistas.ts`, que es el modelo. Este archivo se quedó con lo que es de los
 * textos y de nadie más — cómo te presentás, y qué se puede interpolar.
 *
 * Los tipos de paso se reexportan desde acá porque media docena de pantallas ya
 * los importaban de este módulo y el número de paso sigue siendo lo que
 * identifica un texto.
 */

export {
  esPaso,
  PASO_META,
  PASOS,
  type MetaDePaso,
  type Paso,
} from './pistas'

export const MENSAJES_CONFIG_KEY = 'mensajes'

export const mensajesConfigSchema = z.object({
  /** Con qué nombre se presentan. Alimenta {{mi_nombre}}. */
  miNombre: z.string().trim().max(60).default(''),
  /** Cómo se llama lo que ofrecemos. Alimenta {{oferta}}. */
  oferta: z.string().trim().max(120).default(''),
})

export type MensajesConfig = z.infer<typeof mensajesConfigSchema>

export const MENSAJES_CONFIG_VACIA: MensajesConfig = mensajesConfigSchema.parse({})

/* ── Variables ────────────────────────────────────────────────────────── */

export const VARIABLES_DISPONIBLES = [
  { clave: 'negocio', ejemplo: 'Peluquería Belén', origen: 'Nombre del negocio del lead' },
  { clave: 'rubro', ejemplo: 'peluquería', origen: 'Rubro del lead' },
  { clave: 'ciudad', ejemplo: 'Catamarca', origen: 'Ciudad del lead' },
  { clave: 'nombre', ejemplo: 'Belén', origen: 'Nombre de la persona, si lo tenés' },
  { clave: 'mi_nombre', ejemplo: 'Salvador', origen: 'Lo que cargues acá arriba' },
  { clave: 'oferta', ejemplo: 'webs, automatizaciones y CRM', origen: 'Lo que cargues acá arriba' },
] as const

/**
 * Si a una variable le falta el dato, el mensaje NO se manda: el lead queda con
 * el motivo a la vista y el setter lo saltea. Es preferible saltear a mandar
 * "Hola {{negocio}}", que se nota a un kilómetro.
 *
 * Por eso conviene usar pocas variables y de las que casi siempre tenés.
 */
export const VARIABLES_SEGURAS = ['negocio', 'mi_nombre', 'oferta'] as const
