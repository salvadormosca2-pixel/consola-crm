/**
 * El recorrido de un lead: qué le toca y cuándo.
 *
 * Son dos tramos y nada más, y entre los dos hay una decisión de una persona:
 *
 *   primer_contacto  el mensaje de entrada. Uno solo, sale en el acto, y es lo
 *                    único que abre un chat con un desconocido.
 *   seguimiento      la escalera de cuatro toques. **Se entra calificando**: el
 *                    lead contestó, alguien lo miró y decidió que vale la pena
 *                    seguirlo. El que no se califica no recibe nada más.
 *
 * ── Lo que había antes ─────────────────────────────────────────────────
 *
 * Había cuatro pistas y dieciocho pasos: entrada y oferta, una escalera para
 * el que se callaba, otra para el que objetaba, y dos reintentos de apertura.
 * Para repartir a un lead entre ellas había que clasificar su respuesta —si
 * contestó el primero o el segundo, si le interesa, si está tibio— y de esa
 * clasificación salía el texto que le tocaba, elegido de una plantilla.
 *
 * Nada de eso queda. **El texto de cada lead lo escribe el admin a mano**, uno
 * por uno, así que no hay nada que elegir: el único dato que el sistema
 * necesita es si el lead sigue en juego o no. Esa es la marca de calificado, y
 * reemplaza sola a las tres clasificaciones y a las dos pistas que salían de
 * ellas.
 *
 * ── Sobre los números ──────────────────────────────────────────────────
 *
 * `paso` es lo que se guarda en `lead_assignments.proximo_paso`,
 * `setter_sends.paso`, `lead_textos.paso` y `messages.sequence_step`. **No se
 * reordena nunca y no se reusa nunca**: los envíos hechos apuntan a estos
 * números, y el historial tiene que poder decir qué se mandó. Por eso la
 * escalera conserva los números que ya tenía (3, 10, 11 y 12) en vez de
 * renumerarse de 1 a 4, y los trece pasos del modelo viejo quedan reservados
 * para siempre en `PASOS_RETIRADOS`.
 */

/* ── Los pasos ────────────────────────────────────────────────────────── */

export const PASOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] as const
export type Paso = (typeof PASOS)[number]

export function esPaso(n: unknown): n is Paso {
  return typeof n === 'number' && (PASOS as readonly number[]).includes(n)
}

/**
 * Pasos que ya no arranca nadie, pero que siguen existiendo.
 *
 * Son los del modelo de pistas y plantillas: la oferta (2), los reenganches
 * sueltos (4, 5, 9), los tres que salían solos al marcar qué contestó el lead
 * (6, 7, 8), la escalera del tibio (13 a 16) y los dos reintentos de apertura
 * (17 y 18). No se borran ni se reusan porque hay envíos que los apuntan.
 */
export const PASOS_RETIRADOS = [2, 4, 5, 6, 7, 8, 9, 13, 14, 15, 16, 17, 18] as const satisfies readonly Paso[]

/**
 * Va como tupla y no como `readonly Paso[]`: con el tipo ancho,
 * `(typeof PASOS_RETIRADOS)[number]` se ensancha a *todos* los pasos, y el
 * `Record` de sus etiquetas termina pidiendo una entrada por cada número que
 * existe en vez de por estos trece.
 */
export type PasoRetirado = (typeof PASOS_RETIRADOS)[number]

export function estaRetirado(paso: Paso): boolean {
  return (PASOS_RETIRADOS as readonly number[]).includes(paso)
}

/* ── Las pistas ───────────────────────────────────────────────────────── */

export const PISTAS = ['primer_contacto', 'seguimiento'] as const
export type Pista = (typeof PISTAS)[number]

/**
 * Las dos zonas del panel.
 *
 * No es decoración: abrir un chat con un desconocido y seguir una conversación
 * que ya existe son dos cosas con consecuencias distintas. La primera gasta
 * cupo y puede costar la cuenta; la segunda no gasta nada.
 */
export const ZONAS = ['primer_contacto', 'seguimientos'] as const
export type Zona = (typeof ZONAS)[number]

export const ZONA_META: Record<Zona, { titulo: string; detalle: string }> = {
  primer_contacto: {
    titulo: 'Primer contacto',
    detalle:
      'La apertura. Un solo mensaje, sale en el acto y es lo único que gasta cupo: abrir chats nuevos con desconocidos es lo que hace que Instagram restrinja una cuenta.',
  },
  seguimientos: {
    titulo: 'Seguimiento',
    detalle:
      'La escalera del lead calificado. El chat ya está abierto, así que no gasta cupo. Cada escalón espera sus días desde el último movimiento de la conversación.',
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
    titulo: 'Primer mensaje',
    cuandoEntra: 'Le cayó a un setter y todavía no recibió nada.',
    alTerminar: 'Si contesta y se lo califica, entra al seguimiento. Si no, vence y vuelve al pozo.',
    consumeCupo: true,
    pasos: [
      {
        paso: 1,
        orden: 1,
        label: 'Primer mensaje',
        angulo:
          'El de entrada, escrito para ese negocio en particular. Lo único que busca es que conteste.',
        diasDefault: 0,
      },
    ],
  },

  seguimiento: {
    pista: 'seguimiento',
    zona: 'seguimientos',
    titulo: 'Seguimiento',
    cuandoEntra: 'Contestó y se lo calificó: es un lead que vale la pena seguir.',
    alTerminar: 'Se terminó la escalera. De ahí en más queda para retomarlo más adelante.',
    consumeCupo: false,
    pasos: [
      {
        paso: 3,
        orden: 1,
        label: 'Primer seguimiento',
        angulo: 'Retomar la conversación donde quedó, con lo que haya dicho.',
        diasDefault: 2,
      },
      {
        paso: 10,
        orden: 2,
        label: 'Segundo seguimiento',
        angulo: 'Aportar algo concreto: un caso, un número, una idea para ese negocio.',
        diasDefault: 4,
      },
      {
        paso: 11,
        orden: 3,
        label: 'Tercer seguimiento',
        angulo: 'Dar un motivo para contestar ahora y no la semana que viene.',
        diasDefault: 7,
      },
      {
        paso: 12,
        orden: 4,
        label: 'Último seguimiento',
        angulo:
          'El cierre. Cordial, sin reproche y sin pedir nada: lo único que busca es dejar la puerta abierta.',
        diasDefault: 11,
      },
    ],
  },
}

export const PISTAS_POR_ZONA: Record<Zona, readonly Pista[]> = {
  primer_contacto: ['primer_contacto'],
  seguimientos: ['seguimiento'],
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
 * Solo el primer mensaje: es el único que le escribe a alguien que nunca
 * contestó. Los seguimientos salen adentro de una conversación que ya existe, y
 * un mensaje ahí no es lo que hace que Instagram restrinja una cuenta. Lo que
 * la restringe es abrir chats nuevos con desconocidos.
 *
 * Gastar cupo en los seguimientos hacía que trabajar bien a los leads que ya
 * contestaron compitiera con abrir leads nuevos, que son dos cosas que no
 * tienen por qué disputarse el mismo número.
 */
export function consumeCupo(paso: Paso): boolean {
  return esApertura(paso)
}

/**
 * Si el paso **abre el chat**: le escribe por primera vez a alguien que nunca
 * contestó nada.
 *
 * Es el mismo hecho que `consumeCupo` visto desde el otro lado, y por eso hay
 * una sola implementación: lo único que gasta cupo es abrir chats nuevos. Los
 * dos nombres existen porque el hecho se usa para dos cosas distintas —el
 * límite de la cuenta, y **en qué sección de su pantalla trabaja el setter**—,
 * y en cada lugar se lee mejor con su propio nombre.
 */
export function esApertura(paso: Paso): boolean {
  const u = ubicacionDePaso(paso)
  if (!u) return false
  return PISTA_META[u.pista].consumeCupo
}

/** Los pasos que descuentan del cupo, para poder filtrarlos en SQL. */
export const PASOS_QUE_CONSUMEN_CUPO: readonly Paso[] = PASOS_DE_PISTA.filter(consumeCupo)

/* ── Las dos secciones de la pantalla del setter ──────────────────────── */

/**
 * En qué está trabajando el setter cuando abre la app.
 *
 * Son **dos trabajos distintos** y la línea que los separa es si del otro lado
 * ya te contestaron alguna vez. Es la misma del cupo, y no es casualidad.
 *
 *   apertura     le escribís por primera vez. Gasta cupo y arriesga la cuenta.
 *   seguimiento  el chat ya existe. No gasta nada.
 */
export const SECCIONES = ['apertura', 'seguimiento'] as const
export type Seccion = (typeof SECCIONES)[number]

export const SECCION_META: Record<
  Seccion,
  { titulo: string; corto: string; detalle: string }
> = {
  apertura: {
    titulo: 'Lista para contactar hoy',
    corto: 'Contactar hoy',
    detalle:
      'El primer mensaje a alguien que nunca te contestó. Es lo único que gasta cupo: abrir chats nuevos con desconocidos es lo que hace que Instagram restrinja una cuenta.',
  },
  seguimiento: {
    titulo: 'Seguimiento',
    corto: 'Seguimiento',
    detalle:
      'Conversaciones que ya están abiertas, de leads calificados. No gastan cupo ni arriesgan la cuenta: seguir un chat empezado no es lo que Instagram castiga.',
  },
}

/** En qué sección de la pantalla del setter cae este mensaje. */
export function seccionDePaso(paso: Paso): Seccion {
  return esApertura(paso) ? 'apertura' : 'seguimiento'
}

/* ── Etiquetas para todo paso guardado, incluidos los retirados ───────── */

export interface MetaDePaso {
  label: string
  /** Cuándo le llega este mensaje al lead. */
  cuando: string
  /** Qué tiene que lograr. Es lo que guía cómo escribirlo. */
  objetivo: string
}

/**
 * Etiqueta de cualquier paso que exista en la base, esté vivo o retirado.
 *
 * El historial, la bitácora y la cola del setter muestran pasos viejos; si esto
 * no cubriera los retirados, una pantalla de actividad reventaría al toparse
 * con un envío de hace dos meses.
 */
const META_RETIRADOS: Record<PasoRetirado, MetaDePaso> = {
  2: {
    label: 'Oferta (retirado)',
    cuando: 'Del modelo viejo: salía apenas el lead contestaba la entrada.',
    objetivo: 'Contar qué le ofrecíamos.',
  },
  4: {
    label: 'Contestó y se enfrió (retirado)',
    cuando: 'Del modelo viejo.',
    objetivo: 'Retomar una conversación que ya existía.',
  },
  5: {
    label: 'Le interesó y se enfrió (retirado)',
    cuando: 'Del modelo viejo.',
    objetivo: 'Volver a poner en tema a alguien que ya había dicho que sí.',
  },
  6: {
    label: 'Le interesa (retirado)',
    cuando: 'Del modelo viejo: salía solo al marcar que le interesaba la oferta.',
    objetivo: 'Llevarlo a una fecha concreta.',
  },
  7: {
    label: 'No le interesa (retirado)',
    cuando: 'Del modelo viejo: salía solo al marcar que no le interesaba.',
    objetivo: 'Cerrar cordialmente y dejar la puerta abierta.',
  },
  8: {
    label: 'Agendó reunión (retirado)',
    cuando: 'Del modelo viejo: salía solo al cargar la reunión.',
    objetivo: 'Dejar por escrito lo que se habló.',
  },
  9: {
    label: 'Último reenganche (retirado)',
    cuando: 'Del modelo viejo.',
    objetivo: 'Cerrar la relación dejando la puerta abierta.',
  },
  13: {
    label: 'Tibio · 1. Responder y proponer (retirado)',
    cuando: 'De la escalera del tibio. Hoy ese lead se califica y entra al seguimiento.',
    objetivo: 'Contestar la duda y proponer una llamada.',
  },
  14: {
    label: 'Tibio · 2. Qué lo frena (retirado)',
    cuando: 'De la escalera del tibio. Hoy ese lead se califica y entra al seguimiento.',
    objetivo: 'Preguntar si es el precio o el momento.',
  },
  15: {
    label: 'Tibio · 3. Sacar el riesgo (retirado)',
    cuando: 'De la escalera del tibio. Hoy ese lead se califica y entra al seguimiento.',
    objetivo: 'Sacarle el riesgo de encima.',
  },
  16: {
    label: 'Tibio · 4. Deadline suave (retirado)',
    cuando: 'De la escalera del tibio. Hoy ese lead se califica y entra al seguimiento.',
    objetivo: 'Dar una fecha concreta de arranque.',
  },
  17: {
    label: 'Reintento de apertura (retirado)',
    cuando: 'Del modelo viejo: se le insistía al que nunca contestó la entrada.',
    objetivo: 'Abrir con otro ángulo.',
  },
  18: {
    label: 'Última apertura (retirado)',
    cuando: 'Del modelo viejo: el último intento con el que nunca contestó.',
    objetivo: 'Último intento antes de dejarlo.',
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
      }
    }
  }

  for (const p of PASOS_RETIRADOS) salida[p] = META_RETIRADOS[p]

  return salida
})()
