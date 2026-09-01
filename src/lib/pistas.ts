/**
 * Las pistas: por dónde sigue un lead y qué le llega en cada paso.
 *
 * La corrección de fondo respecto del modelo viejo: **un seguimiento no es un
 * mensaje, es una escalera**. Antes cada situación tenía un solo texto, así que
 * "insistirle al que se calló" era un mensaje y se acababa. En la realidad son
 * cuatro toques con ángulos distintos —reabrir, aportar valor, exclusividad,
 * cierre— y si los tres primeros comparten un solo texto, no hay secuencia: hay
 * un mensaje repetido.
 *
 * Y no son etapas sucesivas de un camino único. Después de la oferta el lead va
 * **a una pista o a la otra**, nunca a las dos:
 *
 *   primer_contacto  la apertura. Dos pasos, ninguno espera.
 *   silencio         recibió la oferta y no dijo nada. Cuatro pasos.
 *   tibio            contestó la oferta con una duda u objeción. Cuatro pasos.
 *   sin_abrir        nunca contestó la entrada. Dos pasos, y es la única que
 *                    consume cupo: el chat jamás se abrió.
 *
 * ── Sobre los números ──────────────────────────────────────────────────
 *
 * `paso` es lo que se guarda en `templates.sequence_step`,
 * `lead_assignments.proximo_paso`, `setter_sends.paso` y
 * `messages.sequence_step`. **No se reordena nunca y no se reusa nunca**: los
 * textos escritos y los envíos hechos apuntan a estos números. Un paso nuevo se
 * agrega al final aunque en el recorrido del lead vaya primero, y uno que sale
 * del modelo queda reservado para siempre (ver `PASOS_RETIRADOS`).
 *
 * Por eso la pista no se guarda en ninguna columna: se deduce del paso, que ya
 * pertenece a una sola. Una columna aparte podría contradecir al número.
 */

/* ── Los pasos ────────────────────────────────────────────────────────── */

export const PASOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] as const
export type Paso = (typeof PASOS)[number]

export function esPaso(n: unknown): n is Paso {
  return typeof n === 'number' && (PASOS as readonly number[]).includes(n)
}

/**
 * Pasos del modelo viejo que ya no arranca nadie, pero que siguen existiendo.
 *
 * Cuando cada situación era un mensaje suelto, estos cuatro eran reenganches
 * independientes. Al pasar a escaleras quedaron absorbidos: el 3 sigue vivo
 * como primer escalón del silencio, y estos cuatro no. No se borran ni se
 * reusan porque hay envíos y textos que los apuntan, y el historial tiene que
 * poder decir qué se mandó.
 */
export const PASOS_RETIRADOS = [4, 5, 9] as const satisfies readonly Paso[]

/**
 * Va como tupla y no como `readonly Paso[]`: con el tipo ancho,
 * `(typeof PASOS_RETIRADOS)[number]` se ensancha a *todos* los pasos, y el
 * `Record` de sus etiquetas termina pidiendo una entrada por cada número que
 * existe en vez de por estos tres.
 */
export type PasoRetirado = (typeof PASOS_RETIRADOS)[number]

export function estaRetirado(paso: Paso): boolean {
  return (PASOS_RETIRADOS as readonly number[]).includes(paso)
}

/* ── Las pistas ───────────────────────────────────────────────────────── */

export const PISTAS = ['primer_contacto', 'silencio', 'tibio', 'sin_abrir'] as const
export type Pista = (typeof PISTAS)[number]

/**
 * Las tres zonas del panel.
 *
 * No es decoración: son tres cosas con consecuencias distintas. La apertura no
 * es un seguimiento, y el reintento es el único que gasta cupo y arriesga la
 * cuenta. Mostrarlas como una sola lista numerada sugiere que son etapas de un
 * mismo camino, y no lo son.
 */
export const ZONAS = ['primer_contacto', 'seguimientos', 'reintento'] as const
export type Zona = (typeof ZONAS)[number]

export const ZONA_META: Record<Zona, { titulo: string; detalle: string }> = {
  primer_contacto: {
    titulo: 'Primer contacto',
    detalle:
      'La apertura. No es un seguimiento: son dos pasos fijos, ninguno espera, y lo que conteste acá decide a qué pista va. Están listados para que se vea el recorrido entero — el texto de los dos se escribe en Mensajes, no acá.',
  },
  seguimientos: {
    titulo: 'Seguimientos',
    detalle:
      'Las dos pistas reales, después de la oferta. El lead va a una o a la otra, nunca a las dos. El chat ya está abierto, así que no gastan cupo.',
  },
  reintento: {
    titulo: 'Reintento de apertura',
    detalle:
      'El único que consume cupo diario y suma riesgo para la cuenta, porque el chat nunca se abrió. Dos intentos y se corta.',
  },
}

export interface PasoDePista {
  /** El número que se guarda. Estable para siempre. */
  paso: Paso
  /** Qué escalón es dentro de su pista, empezando en 1. */
  orden: number
  label: string
  /** Qué tiene que lograr este paso. Es lo que guía cómo escribirlo. */
  angulo: string
  /**
   * Días de espera por defecto, contados desde el último movimiento del chat.
   * 0 = sale en el acto.
   */
  diasDefault: number
  /** Un texto que sirve tal cual, para no arrancar de una hoja en blanco. */
  ejemplo: string
  /**
   * Si este escalón gasta cupo, cuando su pista dice otra cosa.
   *
   * Existe por la oferta: vive en la pista de primer contacto, que abre chats,
   * pero ella no abre ninguno —sale adentro de una conversación que el lead
   * acaba de contestar—. Sin esta excepción, la oferta quedaba bloqueada por el
   * límite de aperturas del día: el setter conseguía que le contestaran y no
   * podía responder.
   */
  consumeCupo?: boolean
}

export interface MetaDePista {
  pista: Pista
  zona: Zona
  titulo: string
  /** Qué tuvo que pasar para que el lead caiga en esta pista. */
  cuandoEntra: string
  /** Qué pasa cuando se termina la escalera. */
  alTerminar: string
  /** Si cada paso descuenta del cupo diario de la cuenta. */
  consumeCupo: boolean
  pasos: readonly PasoDePista[]
}

export const PISTA_META: Record<Pista, MetaDePista> = {
  primer_contacto: {
    pista: 'primer_contacto',
    zona: 'primer_contacto',
    titulo: 'Entrada y oferta',
    cuandoEntra: 'Le cayó a un setter y todavía no recibió nada.',
    alTerminar: 'Según lo que conteste, sigue por silencio o por tibio.',
    consumeCupo: true,
    pasos: [
      {
        paso: 1,
        orden: 1,
        label: 'Entrada',
        angulo:
          'Pregunta suelta, sin vender nada. Lo único que busca es que conteste, y de paso saca la conversación de solicitudes y la lleva a la principal.',
        diasDefault: 0,
        ejemplo: 'Hola! Vi el perfil de {{negocio}}, quería hacerte una consulta. ¿Estás?',
      },
      {
        paso: 2,
        orden: 2,
        label: 'Oferta',
        angulo:
          'Sale en el acto, apenas contesta la entrada: si contestó está mirando el celular ahora. Esperar hasta mañana es perder la conversación que se acaba de ganar. Su respuesta decide a qué pista va.',
        diasDefault: 0,
        // El chat ya está abierto y contestando: no es una apertura, no gasta.
        consumeCupo: false,
        ejemplo:
          'Te cuento en dos líneas: hacemos {{oferta}}. Si te sirve te muestro algo parecido a lo tuyo, sin compromiso.',
      },
    ],
  },

  silencio: {
    pista: 'silencio',
    zona: 'seguimientos',
    titulo: 'Silencio después de la oferta',
    cuandoEntra: 'Recibió la oferta y no contestó nada.',
    alTerminar: 'Nurture: vuelve a entrar a los 30-60 días.',
    consumeCupo: false,
    pasos: [
      {
        paso: 3,
        orden: 1,
        label: 'Check-in',
        angulo: 'Corto y sin vender. Lo único que busca es reabrir la conversación.',
        diasDefault: 2,
        ejemplo: 'Che, te escribí por {{negocio}} y capaz se te pasó. ¿Lo viste?',
      },
      {
        paso: 10,
        orden: 2,
        label: 'Valor',
        angulo:
          'Valor puro: un caso o un número concreto. No pide nada y no repite la oferta.',
        diasDefault: 4,
        ejemplo:
          'Te dejo un dato: a un local parecido al tuyo le subimos los turnos un 30% en dos meses. Por si te sirve.',
      },
      {
        paso: 11,
        orden: 3,
        label: 'Exclusividad',
        angulo: 'Exclusividad por zona: trabajamos con uno solo por área. Da un motivo para contestar ahora.',
        diasDefault: 7,
        ejemplo:
          'Che, laburamos con un solo negocio por zona y en la tuya todavía no cerramos con nadie. ¿Te interesa que hablemos antes de definirlo?',
      },
      {
        paso: 12,
        orden: 4,
        label: 'Breakup',
        angulo:
          'El cierre. Cordial, sin reproche y sin pedir nada: lo único que busca es dejar la puerta abierta.',
        diasDefault: 11,
        ejemplo:
          'Te dejo tranquilo por ahora. Si en algún momento te sirve, escribime y lo vemos. Éxitos con {{negocio}}!',
      },
    ],
  },

  tibio: {
    pista: 'tibio',
    zona: 'seguimientos',
    titulo: 'Tibio después de la oferta',
    cuandoEntra:
      'Contestó la oferta con una duda o una objeción: "cuánto sale", "después veo", "ando a full".',
    alTerminar: 'Nurture: vuelve a entrar a los 30-60 días.',
    consumeCupo: false,
    pasos: [
      {
        paso: 13,
        orden: 1,
        label: 'Responder y proponer',
        angulo: 'Contestar la duda que puso y proponer una llamada de 10 minutos.',
        diasDefault: 1,
        ejemplo:
          'Te respondo lo que preguntaste: {{oferta}}, y arrancamos sin costo de setup. ¿Tenés 10 minutos esta semana para verlo?',
      },
      {
        paso: 14,
        orden: 2,
        label: 'Qué lo frena',
        angulo: 'Preguntar directo cuál de las dos cosas es: el precio o el momento.',
        diasDefault: 2,
        ejemplo: 'Che, para no marearte: ¿lo que te frena es el precio o es que no es el momento?',
      },
      {
        paso: 15,
        orden: 3,
        label: 'Sacar el riesgo',
        angulo: 'Según lo que haya respondido, sacarle el riesgo de encima: prueba, plazo o precio.',
        diasDefault: 4,
        ejemplo:
          'Hagamos algo: lo armamos y si en un mes no te sirve, lo damos de baja sin costo. Así no arriesgás nada.',
      },
      {
        paso: 16,
        orden: 4,
        label: 'Deadline suave',
        angulo: 'Una fecha concreta de arranque, sin apretar. Da un motivo para decidir ahora.',
        diasDefault: 6,
        ejemplo:
          'Estoy cerrando la agenda de arranques del mes que viene. ¿Te reservo un lugar o lo dejamos para más adelante?',
      },
    ],
  },

  sin_abrir: {
    pista: 'sin_abrir',
    zona: 'reintento',
    titulo: 'No contestó la entrada',
    cuandoEntra: 'Nunca contestó la entrada, así que nunca recibió la oferta.',
    alTerminar: 'Nurture. Después de dos intentos no se insiste más.',
    consumeCupo: true,
    pasos: [
      {
        paso: 17,
        orden: 1,
        label: 'Otra apertura',
        angulo:
          'Una apertura distinta, no la misma repetida. Si el primer ángulo no funcionó, repetirlo tampoco va a funcionar.',
        diasDefault: 7,
        ejemplo: 'Hola! Te escribí hace unos días por {{negocio}}. ¿Te llego bien por acá?',
      },
      {
        paso: 18,
        orden: 2,
        label: 'Última apertura',
        angulo: 'El último intento, con otro ángulo. Después de este no se insiste más.',
        diasDefault: 15,
        ejemplo:
          'Última que te escribo, prometido. Si en algún momento te sirve {{oferta}}, quedo por acá. Éxitos!',
      },
    ],
  },
}

export const PISTAS_POR_ZONA: Record<Zona, readonly Pista[]> = {
  primer_contacto: ['primer_contacto'],
  seguimientos: ['silencio', 'tibio'],
  reintento: ['sin_abrir'],
}

/* ── Los que salen apenas el setter marca ─────────────────────────────── */

/**
 * Tres textos que no pertenecen a ninguna pista: no esperan días ni encadenan
 * nada. Salen en el acto porque el lead está del otro lado, ahora.
 */
export const PASOS_DE_MARCA = [6, 7, 8] as const
export type PasoDeMarca = (typeof PASOS_DE_MARCA)[number]

export const MARCA_META: Record<PasoDeMarca, { label: string; cuando: string; angulo: string; ejemplo: string }> = {
  6: {
    label: 'Le interesa',
    cuando: 'El setter marcó que contestó la oferta y que le interesa. Sale en el acto.',
    angulo:
      'Ya dijo que sí. Tiene que llevarlo a una fecha concreta, no a seguir charlando: cada día entre el sí y la reunión es un lead que se enfría.',
    ejemplo:
      'Buenísimo! ¿Te viene bien que hablemos 15 minutos? Decime qué día y hora te queda cómodo y lo dejamos agendado.',
  },
  7: {
    label: 'No le interesa',
    cuando: 'El setter marcó que contestó la oferta y que no le interesa. Sale en el acto.',
    angulo:
      'Cerrar bien. No es para convencerlo: es para poder volver a escribirle dentro de unos meses sin que te tenga bloqueado.',
    ejemplo:
      'Dale, te agradezco igual la respuesta. Quedo por acá por si en algún momento te sirve. Éxitos con {{negocio}}!',
  },
  8: {
    label: 'Agendó reunión',
    cuando: 'El setter cargó la reunión. Sale en el acto.',
    angulo:
      'Dejar por escrito lo que se habló. Una reunión que quedó de palabra en un chat de Instagram es una reunión a la que no se presenta nadie.',
    ejemplo:
      'Listo, quedamos entonces. Te confirmo por acá el día antes. Si te surge algo avisame y lo movemos sin problema.',
  },
}

export function esPasoDeMarca(paso: Paso): paso is PasoDeMarca {
  return (PASOS_DE_MARCA as readonly number[]).includes(paso)
}

/* ── Consultas sobre el modelo ────────────────────────────────────────── */

interface Ubicacion {
  pista: Pista
  paso: PasoDePista
}

const UBICACION = new Map<Paso, Ubicacion>()
for (const pista of PISTAS) {
  for (const paso of PISTA_META[pista].pasos) UBICACION.set(paso.paso, { pista, paso })
}

/** En qué pista está un paso, y qué escalón es. `null` si no es de ninguna. */
export function ubicacionDePaso(paso: Paso): Ubicacion | null {
  return UBICACION.get(paso) ?? null
}

export function pistaDePaso(paso: Paso): Pista | null {
  return UBICACION.get(paso)?.pista ?? null
}

/** Todos los pasos que hoy forman parte de una escalera, en orden de pista. */
export const PASOS_DE_PISTA: readonly Paso[] = PISTAS.flatMap((p) =>
  PISTA_META[p].pasos.map((x) => x.paso),
)

/** El escalón siguiente dentro de la misma pista, o null si era el último. */
export function siguienteDeLaPista(paso: Paso): PasoDePista | null {
  const u = UBICACION.get(paso)
  if (!u) return null
  const pasos = PISTA_META[u.pista].pasos
  return pasos.find((x) => x.orden === u.paso.orden + 1) ?? null
}

/** El primer escalón de una pista. Con esto se entra a una escalera. */
export function primerPasoDe(pista: Pista): PasoDePista {
  const primero = PISTA_META[pista].pasos[0]
  if (!primero) throw new Error(`La pista ${pista} no tiene pasos.`)
  return primero
}

/**
 * Si el paso gasta cupo diario de la cuenta.
 *
 * Solo la apertura y el reintento: los dos escalones que le escriben a alguien
 * que nunca contestó. Todo el resto —la oferta incluida— sale adentro de una
 * conversación que ya existe, y un mensaje ahí no es lo que hace que Instagram
 * restrinja una cuenta. Lo que la restringe es abrir chats nuevos con
 * desconocidos.
 *
 * La oferta es la excepción que hay que mirar dos veces: pertenece a la pista
 * de primer contacto, que sí abre chats, pero ella sale cuando el lead acaba de
 * contestar. Contarla dejaba al setter sin poder responderle a alguien que le
 * estaba escribiendo, que es lo peor que puede pasar en una conversación.
 *
 * Gastar cupo en los seguimientos hacía que trabajar bien a los leads que ya
 * contestaron compitiera con abrir leads nuevos, que son dos cosas que no
 * tienen por qué disputarse el mismo número.
 */
export function consumeCupo(paso: Paso): boolean {
  const u = ubicacionDePaso(paso)
  if (!u) return false
  // El escalón manda sobre su pista: la oferta vive en la pista que abre chats
  // y no abre ninguno.
  return u.paso.consumeCupo ?? PISTA_META[u.pista].consumeCupo
}

/** Los pasos que descuentan del cupo, para poder filtrarlos en SQL. */
export const PASOS_QUE_CONSUMEN_CUPO: readonly Paso[] = PASOS_DE_PISTA.filter(consumeCupo)

/* ── Qué se escribe en cada pantalla ──────────────────────────────────── */

/**
 * Los pasos cuyo texto se escribe en **Mensajes**: los que no dependen de
 * ningún día.
 *
 * Son la apertura —entrada y oferta, que salen en el acto— y los tres que salen
 * apenas el setter marca qué contestó el lead. Todo lo demás es un escalón de
 * una pista, y su texto se escribe en Seguimientos pegado a su día, porque a
 * los dos días y a los once no se escribe igual.
 */
export const PASOS_DE_MENSAJES: readonly Paso[] = [
  ...PISTA_META.primer_contacto.pasos.map((p) => p.paso),
  ...PASOS_DE_MARCA,
]

export interface GrupoDeMensajes {
  titulo: string
  detalle: string
  pasos: readonly Paso[]
}

export const GRUPOS_DE_MENSAJES: readonly GrupoDeMensajes[] = [
  {
    titulo: 'Primer contacto',
    detalle:
      'La apertura. Los dos salen en el acto: la entrada cuando el setter toma el lead, y la oferta apenas contesta.',
    pasos: PISTA_META.primer_contacto.pasos.map((p) => p.paso),
  },
  {
    titulo: 'El setter lo marcó',
    detalle: 'Salen ya, apenas marca en la app qué contestó el lead. No esperan nada.',
    pasos: PASOS_DE_MARCA,
  },
]

/** Si el texto de este paso se escribe en Mensajes y no en Seguimientos. */
export function seEscribeEnMensajes(paso: Paso): boolean {
  return PASOS_DE_MENSAJES.includes(paso)
}

/* ── Etiquetas para todo paso guardado, incluidos los retirados ───────── */

export interface MetaDePaso {
  label: string
  /** Cuándo le llega este mensaje al lead. */
  cuando: string
  /** Qué tiene que lograr. Es lo que guía cómo escribirlo. */
  objetivo: string
  ejemplo: string
}

/**
 * Etiqueta de cualquier paso que exista en la base, esté vivo o retirado.
 *
 * El historial, la bitácora y la cola del setter muestran pasos viejos; si esto
 * no cubriera los retirados, una pantalla de actividad reventaría al toparse
 * con un envío de hace dos meses.
 */
const META_RETIRADOS: Record<PasoRetirado, MetaDePaso> = {
  4: {
    label: 'Contestó y se enfrió (retirado)',
    cuando: 'Del modelo viejo. Hoy ese lead va a la pista de tibio.',
    objetivo: 'Retomar una conversación que ya existía.',
    ejemplo: '',
  },
  5: {
    label: 'Le interesó y se enfrió (retirado)',
    cuando: 'Del modelo viejo. Hoy ese lead va a la pista de tibio.',
    objetivo: 'Volver a poner en tema a alguien que ya había dicho que sí.',
    ejemplo: '',
  },
  9: {
    label: 'Último reenganche (retirado)',
    cuando: 'Del modelo viejo. Hoy cierra el último escalón de cada pista.',
    objetivo: 'Cerrar la relación dejando la puerta abierta.',
    ejemplo: '',
  },
}

export const PASO_META: Record<Paso, MetaDePaso> = (() => {
  const salida = {} as Record<Paso, MetaDePaso>

  for (const pista of PISTAS) {
    const meta = PISTA_META[pista]
    for (const p of meta.pasos) {
      salida[p.paso] = {
        label: meta.zona === 'primer_contacto' ? p.label : `${meta.titulo} · ${p.orden}. ${p.label}`,
        cuando:
          p.diasDefault === 0
            ? `${meta.cuandoEntra} Sale en el acto.`
            : `${meta.cuandoEntra} Sale a los ${p.diasDefault} días del último movimiento.`,
        objetivo: p.angulo,
        ejemplo: p.ejemplo,
      }
    }
  }

  for (const p of PASOS_DE_MARCA) {
    salida[p] = {
      label: MARCA_META[p].label,
      cuando: MARCA_META[p].cuando,
      objetivo: MARCA_META[p].angulo,
      ejemplo: MARCA_META[p].ejemplo,
    }
  }

  for (const p of PASOS_RETIRADOS) salida[p] = META_RETIRADOS[p]

  return salida
})()
