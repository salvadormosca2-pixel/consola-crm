import { z } from 'zod'

/**
 * Los datos que se repiten en todos los mensajes.
 *
 * Son dos y viven acá porque no pertenecen a ninguna plantilla en particular:
 * cambiar cómo te llamás no tiene que obligarte a editar diez textos.
 */

export const MENSAJES_CONFIG_KEY = 'mensajes'

export const mensajesConfigSchema = z.object({
  /** Con qué nombre se presentan. Alimenta {{mi_nombre}}. */
  miNombre: z.string().trim().max(60).default(''),
  /** Cómo se llama lo que ofrecemos. Alimenta {{oferta}}. */
  oferta: z.string().trim().max(120).default(''),
})

export type MensajesConfig = z.infer<typeof mensajesConfigSchema>

export const MENSAJES_CONFIG_VACIA: MensajesConfig = mensajesConfigSchema.parse({})

/* ── Las cinco situaciones ────────────────────────────────────────────── */

/**
 * Cada mensaje responde a una situación distinta del lead, no a un número de
 * orden. Un lead que contestó y después se calló no necesita lo mismo que uno
 * que nunca dijo nada: son dos silencios distintos.
 *
 * El número es el que se guarda en `templates.sequence_step` y en
 * `lead_assignments.proximo_paso`.
 */
export const PASOS = [1, 2, 3, 4, 5] as const
export type Paso = (typeof PASOS)[number]

export interface MetaDePaso {
  label: string
  /** Cuándo le llega este mensaje al lead. */
  cuando: string
  /** Qué tiene que lograr. Es lo que guía cómo escribirlo. */
  objetivo: string
  /** Un texto que sirve tal cual, para arrancar sin partir de una hoja vacía. */
  ejemplo: string
}

export const PASO_META: Record<Paso, MetaDePaso> = {
  1: {
    label: 'Entrada',
    cuando: 'Es el primero que recibe. Sale cuando el setter lo toma de su cola.',
    objetivo:
      'Que conteste. No ofrece nada: si arranca vendiendo, no contesta nadie. Escribilo como escribiría un cliente de ese rubro.',
    ejemplo: 'Hola! Vi el perfil de {{negocio}}, quería hacerte una consulta. ¿Estás?',
  },
  2: {
    label: 'La oferta',
    cuando: 'Si no contestó el de entrada, sale unas horas después.',
    objetivo:
      'Contarle a qué te dedicás y qué le proponés. Su respuesta a este es un sí o un no.',
    ejemplo:
      'Te cuento en dos líneas: hacemos {{oferta}}. Si te sirve te muestro algo parecido a lo tuyo, sin compromiso.',
  },
  3: {
    label: 'Nunca contestó',
    cuando: 'Recibió los dos y sigue callado. Sale a los días que configures.',
    objetivo:
      'Último intento con este lead. Corto y sin reproche: capaz nunca vio el mensaje.',
    ejemplo:
      'Che, te escribí por {{negocio}} y capaz se te pasó. Si no te interesa no hay drama, avisame y no te escribo más.',
  },
  4: {
    label: 'Contestó y se enfrió',
    cuando: 'Contestó el de entrada, se empezó a hablar, y después desapareció.',
    objetivo:
      'Retomar una conversación que ya existía. Es el reenganche que más vale: ya te contestó una vez.',
    ejemplo:
      'Hola! Quedamos por la mitad la otra vez. ¿Seguís interesado o lo dejamos para más adelante?',
  },
  5: {
    label: 'Le interesó y se enfrió',
    cuando: 'Dijo que le interesaba la oferta y después dejó de contestar.',
    objetivo:
      'El más valioso de todos: ya sabe qué le ofrecés y dijo que sí. Solo hay que volver a ponerlo en tema.',
    ejemplo:
      'Hola! Habíamos quedado en avanzar con {{oferta}}. ¿Te viene bien esta semana o lo vemos más adelante?',
  },
}

/** Los tres que son reenganche: se disparan por silencio, no por secuencia. */
export const PASOS_DE_REENGANCHE: readonly Paso[] = [3, 4, 5]

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
