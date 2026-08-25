/**
 * Referencias: qué contestar cuando el cliente pregunta.
 *
 * No son mensajes que se mandan solos. Son la chuleta que el setter abre en
 * medio de una conversación, cuando le preguntan algo que no estaba en el
 * guion: cuánto sale, quiénes son, con quién trabajaron. Busca, lee, copia y
 * sigue.
 *
 * Las respuestas las escribe el admin, una por una. El sistema no sugiere ni
 * completa nada: la idea es que el equipo entero conteste igual que él.
 *
 * Vive en `lib` porque lo necesitan las dos puntas —la consulta del servidor y
 * las pantallas de cliente— y duplicar los rótulos es la forma más fácil de que
 * una diga una cosa y la otra traiga otra.
 */

export const CATEGORIAS = [
  'nosotros',
  'como_funciona',
  'precio',
  'objeciones',
  'otras',
] as const
export type Categoria = (typeof CATEGORIAS)[number]

export interface MetaDeCategoria {
  label: string
  /** Qué clase de pregunta va acá. Es lo que guía al admin al cargar. */
  cuando: string
}

export const CATEGORIA_META: Record<Categoria, MetaDeCategoria> = {
  nosotros: {
    label: 'Sobre nosotros',
    cuando: 'Quiénes somos, a qué nos dedicamos, dónde estamos, hace cuánto.',
  },
  como_funciona: {
    label: 'Cómo funciona',
    cuando: 'Qué incluye, cómo es el proceso, cuánto tarda, qué necesitamos de ellos.',
  },
  precio: {
    label: 'Precio y pago',
    cuando: 'Cuánto sale, cómo se paga, si hay planes. Lo que más preguntan.',
  },
  objeciones: {
    label: 'Objeciones',
    cuando: '"Es caro", "lo tengo que pensar", "ya trabajo con alguien", "no me interesa".',
  },
  otras: {
    label: 'Otras',
    cuando: 'Todo lo que se pregunta seguido y no entra en las de arriba.',
  },
}

export function esCategoria(v: string): v is Categoria {
  return (CATEGORIAS as readonly string[]).includes(v)
}

/** Categoría válida, o la de descarte. Para leer lo que ya está en la base. */
export function categoriaDe(v: string): Categoria {
  return esCategoria(v) ? v : 'otras'
}
