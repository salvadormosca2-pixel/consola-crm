import { z } from 'zod'

/**
 * Alta de setters en lote: pegar la lista y darlos de alta a todos de una.
 *
 * El alta de a uno pide nombre, email y cuentas de Instagram, y está bien para
 * el que entra solo. Cuando entra un equipo entero lo que hay es una lista de
 * mails en un WhatsApp, sin nombres y sin cuentas: pedir los tres campos por
 * cada uno son cuarenta y ocho campos tipeados a mano, y ahí es donde se cuela
 * el mail con una letra de menos que después nadie entiende por qué no entra.
 *
 * Por eso esto acepta el texto tal como viene y hace lo que puede con él: el
 * email es lo único que no se puede adivinar, y el nombre —que es solo lo que
 * se ve en el panel y en el saludo de la tarjeta— se propone a partir del mail
 * y se corrige en pantalla antes de crear nada.
 *
 * Es lógica pura y sin base a propósito: es la parte que decide qué se va a
 * insertar, y tiene que poder probarse línea por línea.
 */

/** Cuántos entran en una tanda. Más que esto es una importación, no un alta. */
export const MAXIMO_POR_LOTE = 50

export interface FilaDeLote {
  /** Número de línea del texto pegado, para poder señalar cuál está mal. */
  linea: number
  /** Lo que se escribió en esa línea, sin tocar. */
  original: string
  email: string
  /** Propuesto a partir del email, o el que venía escrito en la línea. */
  nombre: string
  /** Si tiene algo, esta línea no se da de alta. */
  error: string | null
}

const emailSchema = z.string().email()

function capitalizar(palabra: string): string {
  return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase()
}

/**
 * Un nombre presentable a partir del email.
 *
 * No pretende acertar: `agustinzampieri21@…` no tiene forma de partirse en dos
 * palabras sin adivinar, y adivinar mal es peor que no partir. Lo que hace es
 * dejar algo legible en el panel y en el "Hola ___" de la tarjeta, listo para
 * que lo corrija quien está mirando la lista, que es el único que sabe cómo se
 * llama cada uno.
 *
 * Sí aprovecha lo que el propio mail separa: los puntos y guiones bajos, y el
 * salto de minúscula a mayúscula de los que escriben `SantyVergara113`.
 */
export function nombreDesdeEmail(email: string): string {
  const local = email.split('@')[0] ?? ''

  const palabras = local
    // Los números son del mail, no de la persona: `abriilsegura08` no se llama 08.
    .replace(/\d+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s._\-+]+/)
    .filter((p) => p.length > 0)
    .map(capitalizar)

  const nombre = palabras.join(' ')
  return nombre.length >= 2 ? nombre : local
}

/**
 * Parte el texto pegado en filas.
 *
 * Una línea, una persona. De la línea se toma como email el primer pedazo que
 * tenga arroba, y lo que sobra —si dice algo— es el nombre. Con eso entran sin
 * retocar nada las tres formas en las que la lista llega en la práctica:
 *
 *     benja@ejemplo.com
 *     benja@ejemplo.com, Benja Leiva
 *     Benja Leiva <benja@ejemplo.com>
 *
 * Las líneas vacías se ignoran. Las que están mal no se descartan en silencio:
 * vuelven con su número de línea y su motivo, porque un mail que desaparece sin
 * aviso es alguien que se queda afuera y nadie se entera hasta que reclama.
 */
export function parsearLote(texto: string): FilaDeLote[] {
  const filas: FilaDeLote[] = []
  const vistos = new Set<string>()

  texto.split(/\r?\n/).forEach((cruda, i) => {
    const original = cruda.trim()
    if (original.length === 0) return

    const fila = (email: string, nombre: string, error: string | null): void => {
      filas.push({ linea: i + 1, original, email, nombre, error })
    }

    const token = original.split(/[\s,;<>()]+/).find((p) => p.includes('@'))
    if (!token) {
      fila('', '', 'No encuentro ningún email en esta línea.')
      return
    }

    const email = token.toLowerCase().replace(/^mailto:/, '')
    if (!emailSchema.safeParse(email).success) {
      fila(email, '', 'Ese email no tiene formato válido.')
      return
    }

    // El nombre es lo que quede de la línea sacándole el mail y la puntuación
    // que lo rodeaba. Si eso no tiene ni una letra, no era un nombre.
    const resto = original
      .replace(token, ' ')
      .replace(/[<>,;:()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const nombre = resto.length >= 2 && /\p{L}/u.test(resto) ? resto : nombreDesdeEmail(email)

    if (vistos.has(email)) {
      fila(email, nombre, 'Este email ya estaba más arriba en la lista.')
      return
    }
    vistos.add(email)

    fila(email, nombre, null)
  })

  return filas
}

/** Las que se van a dar de alta: las que no traen error. */
export function filasValidas(filas: FilaDeLote[]): FilaDeLote[] {
  return filas.filter((f) => f.error === null)
}
