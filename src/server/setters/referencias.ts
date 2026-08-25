import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import { CATEGORIAS, categoriaDe, type Categoria } from '@/lib/referencias'

/**
 * Las referencias que consulta el setter y que carga el admin.
 *
 * La consulta es una sola y trae todo: son decenas de filas de texto corto, no
 * miles. Traerlas enteras y filtrar en el celular hace que buscar sea
 * instantáneo y que la pantalla siga andando sin señal, que es exactamente
 * cuando se necesita —en medio de una conversación, con el chat abierto al
 * lado.
 */

export interface Referencia {
  id: string
  categoria: Categoria
  pregunta: string
  respuesta: string
  /** Aclaración interna del admin. Se muestra al setter, nunca se copia. */
  nota: string | null
  orden: number
  activa: boolean
  actualizado: Date
}

export interface GrupoDeReferencias {
  categoria: Categoria
  referencias: Referencia[]
}

interface Fila {
  id: string
  categoria: string
  pregunta: string
  respuesta: string
  nota: string | null
  orden: number
  activa: boolean
  updated_at: Date
}

function aReferencia(f: Fila): Referencia {
  return {
    id: f.id,
    categoria: categoriaDe(f.categoria),
    pregunta: f.pregunta,
    respuesta: f.respuesta,
    nota: f.nota,
    orden: f.orden,
    activa: f.activa,
    actualizado: new Date(f.updated_at),
  }
}

/**
 * Todas las referencias.
 *
 * `soloActivas` es lo que separa las dos puntas: el setter ve lo que está
 * publicado, el admin ve también los borradores que apagó.
 */
export async function listarReferencias(soloActivas = false): Promise<Referencia[]> {
  const filas = await db.execute(sql`
    select id, categoria, pregunta, respuesta, nota, orden, activa, updated_at
      from referencias
     ${soloActivas ? sql`where activa` : sql``}
     order by orden asc, created_at asc
  `)
  return (filas.rows as unknown as Fila[]).map(aReferencia)
}

/**
 * Lo mismo, agrupado por categoría y en el orden fijo de `CATEGORIAS`.
 *
 * Las categorías vacías no vienen: una pantalla con cinco títulos y nada abajo
 * no le dice nada a nadie.
 */
export async function referenciasPorCategoria(
  soloActivas = false,
): Promise<GrupoDeReferencias[]> {
  const todas = await listarReferencias(soloActivas)
  return CATEGORIAS.map((categoria) => ({
    categoria,
    referencias: todas.filter((r) => r.categoria === categoria),
  })).filter((g) => g.referencias.length > 0)
}

/** Cuántas hay publicadas. Es lo que decide si la pestaña tiene sentido. */
export async function contarReferenciasActivas(): Promise<number> {
  const filas = await db.execute(sql`
    select count(*)::int as n from referencias where activa
  `)
  return (filas.rows[0] as { n: number } | undefined)?.n ?? 0
}
