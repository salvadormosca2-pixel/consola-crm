'use server'

import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db'
import type { EstadoAccion } from '@/lib/form-state'
import { CATEGORIAS } from '@/lib/referencias'
import { ErrorDePermiso, exigirAdmin } from '@/server/session'

/**
 * Las referencias: qué contestar cuando el cliente pregunta.
 *
 * Las carga el admin, una por una, y las lee el setter en el celular. Igual que
 * con los mensajes, acá no se genera ni se sugiere texto: si una pregunta no
 * tiene respuesta escrita, no aparece, y el setter sabe que tiene que
 * consultar en vez de improvisar.
 */

function alFallar(err: unknown, generico: string): EstadoAccion {
  if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
  console.error(generico, err)
  return { ok: false, error: generico }
}

function refrescar(): void {
  revalidatePath('/configuracion/referencias')
  revalidatePath('/referencias')
}

const referenciaSchema = z.object({
  id: z.string().uuid().optional(),
  categoria: z.enum(CATEGORIAS),
  pregunta: z.string().trim().min(3, 'Escribí la pregunta.').max(200),
  respuesta: z.string().trim().min(1, 'Escribí la respuesta.').max(2000),
  nota: z.string().trim().max(300).optional(),
  activa: z.boolean().default(true),
})

/**
 * Crea o edita una referencia.
 *
 * El `orden` de una nueva la deja al final de su categoría: el admin las va
 * agregando a medida que aparecen las preguntas, y la que acaba de escribir es
 * la última que le importa ver arriba.
 */
export async function guardarReferencia(datos: unknown): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    const parsed = referenciaSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
    }
    const d = parsed.data
    const nota = d.nota && d.nota.length > 0 ? d.nota : null

    if (d.id) {
      const filas = await db.execute(sql`
        update referencias
           set categoria = ${d.categoria}, pregunta = ${d.pregunta},
               respuesta = ${d.respuesta}, nota = ${nota}, activa = ${d.activa},
               actualizado_por = ${sesion.userId}::uuid, updated_at = now()
         where id = ${d.id}::uuid
        returning id
      `)
      if (filas.rows.length === 0) return { ok: false, error: 'Esa referencia ya no existe.' }
    } else {
      await db.execute(sql`
        insert into referencias (categoria, pregunta, respuesta, nota, activa, orden,
                                 actualizado_por)
        values (${d.categoria}, ${d.pregunta}, ${d.respuesta}, ${nota}, ${d.activa},
                (select coalesce(max(orden), 0) + 1 from referencias
                  where categoria = ${d.categoria}),
                ${sesion.userId}::uuid)
      `)
    }

    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    /*
     * El índice único es el que corta las preguntas repetidas. Si saltó, no es
     * un error del sistema: es que esa pregunta ya está cargada, y hay que
     * decirlo con esas palabras.
     */
    if (err instanceof Error && err.message.includes('referencias_pregunta_uq')) {
      return { ok: false, error: 'Esa pregunta ya está cargada en esa categoría.' }
    }
    return alFallar(err, 'No se pudo guardar la referencia.')
  }
}

/** La saca de la vista del setter sin borrarla. */
export async function activarReferencia(id: string, activa: boolean): Promise<EstadoAccion> {
  try {
    const sesion = await exigirAdmin()
    await db.execute(sql`
      update referencias
         set activa = ${activa}, actualizado_por = ${sesion.userId}::uuid, updated_at = now()
       where id = ${id}::uuid
    `)
    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo cambiar el estado.')
  }
}

export async function borrarReferencia(id: string): Promise<EstadoAccion> {
  try {
    await exigirAdmin()
    await db.execute(sql`delete from referencias where id = ${id}::uuid`)
    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo borrar la referencia.')
  }
}

/**
 * Sube o baja una referencia dentro de su categoría.
 *
 * Importa más de lo que parece: el setter lee de arriba hacia abajo con el
 * cliente esperando, así que la pregunta que más hacen tiene que estar primera.
 * El intercambio va en una transacción para que dos clicks seguidos no dejen
 * dos filas con el mismo orden.
 */
export async function moverReferencia(id: string, hacia: 'arriba' | 'abajo'): Promise<EstadoAccion> {
  try {
    await exigirAdmin()

    await db.transaction(async (tx) => {
      const filas = await tx.execute(sql`
        select id, categoria, orden from referencias where id = ${id}::uuid for update
      `)
      const actual = filas.rows[0] as
        | { id: string; categoria: string; orden: number }
        | undefined
      if (!actual) return

      const vecinas = await tx.execute(sql`
        select id, orden from referencias
         where categoria = ${actual.categoria}
           and ${hacia === 'arriba' ? sql`orden < ${actual.orden}` : sql`orden > ${actual.orden}`}
         order by orden ${hacia === 'arriba' ? sql`desc` : sql`asc`}
         limit 1
        for update
      `)
      const vecina = vecinas.rows[0] as { id: string; orden: number } | undefined
      if (!vecina) return

      await tx.execute(sql`
        update referencias set orden = ${vecina.orden} where id = ${actual.id}::uuid
      `)
      await tx.execute(sql`
        update referencias set orden = ${actual.orden} where id = ${vecina.id}::uuid
      `)
    })

    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo mover.')
  }
}
