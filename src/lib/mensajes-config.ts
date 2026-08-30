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

/* ── Las situaciones ──────────────────────────────────────────────────── */

/**
 * Cada mensaje responde a una situación distinta del lead, no a un número de
 * orden. Un lead que contestó y después se calló no necesita lo mismo que uno
 * que nunca dijo nada: son dos silencios distintos.
 *
 * **Las situaciones son las que marca el setter.** No hay ninguna que el
 * sistema deduzca por su cuenta: si en la app hay un botón que dice "le
 * interesa", acá hay un mensaje para eso, y al revés. Es lo que hace que el
 * texto que sale siempre corresponda a cómo está clasificado el lead.
 *
 * El número es el que se guarda en `templates.sequence_step` y en
 * `lead_assignments.proximo_paso`, y **no se reordena nunca**: los mensajes ya
 * escritos y los envíos ya hechos apuntan a estos números. Una situación nueva
 * se agrega al final, aunque en el recorrido del lead pase antes.
 */
export const PASOS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const
export type Paso = (typeof PASOS)[number]

/** Si un número guardado en la base es una de las cinco situaciones. */
export function esPaso(n: unknown): n is Paso {
  return typeof n === 'number' && (PASOS as readonly number[]).includes(n)
}

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
  6: {
    label: 'Le interesa',
    cuando: 'El setter marcó "contestó la oferta" y puso que le interesa. Sale en el acto.',
    objetivo:
      'Ya dijo que sí. Este mensaje tiene que llevarlo a una fecha concreta, no a seguir charlando: cada día que pasa entre el sí y la reunión es un lead que se enfría.',
    ejemplo:
      'Buenísimo! ¿Te viene bien que hablemos 15 minutos? Decime qué día y hora te queda cómodo y lo dejamos agendado.',
  },
  7: {
    label: 'No le interesa',
    cuando: 'El setter marcó "contestó la oferta" y puso que no le interesa. Sale en el acto.',
    objetivo:
      'Cerrar bien. No es para convencerlo —dijo que no y hay que respetarlo—: es para que dentro de unos meses puedas volver a escribirle sin que te tenga bloqueado.',
    ejemplo:
      'Dale, te agradezco igual la respuesta. Quedo por acá por si en algún momento te sirve. Éxitos con {{negocio}}!',
  },
  8: {
    label: 'Agendó reunión',
    cuando: 'El setter cargó la reunión. Sale en el acto.',
    objetivo:
      'Dejar por escrito lo que se habló. Una reunión que quedó solo de palabra en un chat de Instagram es una reunión a la que no se presenta nadie.',
    ejemplo:
      'Listo, quedamos entonces. Te confirmo por acá el día antes. Si te surge algo avisame y lo movemos sin problema.',
  },
  9: {
    label: 'Último reenganche',
    cuando: 'Ya recibió un reenganche y tampoco contestó. Sale a los días que configures.',
    objetivo:
      'El último de todos, y el que cierra la relación. Corto, sin reproche y sin pedir nada: lo único que busca es dejar la puerta abierta para más adelante.',
    ejemplo:
      'Te dejo tranquilo por ahora. Si en algún momento te sirve lo que hacemos, escribime y lo vemos. Éxitos!',
  },
}

/* ── Cómo se agrupan en pantalla ──────────────────────────────────────── */

/**
 * Los números están en el orden en que se fueron agregando; el recorrido del
 * lead no. "Le interesa" es el 6 y pasa antes que "Le interesó y se enfrió",
 * que es el 5.
 *
 * Por eso la pantalla no los lista por número sino por lo que le pasó al lead:
 * qué le mandamos nosotros, qué le mandamos cuando se calla, y qué le mandamos
 * cuando el setter marca lo que contestó.
 */
export interface GrupoDePasos {
  titulo: string
  detalle: string
  pasos: readonly Paso[]
}

export const GRUPOS_DE_PASOS: readonly GrupoDePasos[] = [
  {
    titulo: 'Le escribimos',
    detalle: 'Los dos que salen sí o sí, sin que el lead haya hecho nada.',
    pasos: [1, 2],
  },
  {
    titulo: 'Se calló',
    detalle: 'Vuelven solos a la cola por silencio. Cuál le toca depende de hasta dónde llegó.',
    pasos: [3, 4, 5, 9],
  },
  {
    titulo: 'El setter lo marcó',
    detalle: 'Salen en el acto, apenas el setter marca en la app qué contestó el lead.',
    pasos: [6, 7, 8],
  },
]

/** Los que son reenganche: se disparan por silencio, no por una marca. */
export const PASOS_DE_REENGANCHE: readonly Paso[] = [3, 4, 5, 9]

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
