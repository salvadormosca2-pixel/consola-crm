import 'server-only'

import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { db, type Db } from '@/db'
import { contacts, importBatchItems, importBatches, messages } from '@/db/schema'
import type { Mapeo } from '@/lib/import/columns'

/**
 * Si una fila **todavía** necesita que la mire una persona.
 *
 * Se pregunta ahora, contra el contacto, en vez de creerle a la etiqueta que
 * quedó guardada el día de la importación. Es lo que hace que la pestaña se
 * vacíe sola: un lead que ya está trabajable deja de pedir atención sin que
 * nadie toque un botón.
 *
 * Hacía falta por dos motivos. El primero: la regla vieja mandaba a revisar
 * cualquier fila con un aviso, y una lista scrapeada entera se llevaba el aviso
 * del teléfono roto aunque el `@usuario` estuviera impecable. Arreglada la
 * regla, esas filas seguían ahí —la etiqueta ya estaba escrita en la base— y la
 * pantalla seguía mostrando el problema de ayer. El segundo: si alguien
 * completa a mano el dato que faltaba, la fila tiene que desaparecer de la cola
 * por el solo hecho de estar resuelta.
 *
 * Las filas sin contacto (`contact_id` nulo) son las que no se pudieron
 * importar: esas quedan siempre, porque no hay nada que haya podido arreglarse.
 */
const SIGUE_PARA_REVISAR = sql`(
  ${importBatchItems.contactId} is null
  or exists (
    select 1 from contacts c
     where c.id = ${importBatchItems.contactId}
       and c.discarded_at is null
       and case when c.origen = 'scrapeado'
                then c.ig_username is null
                else c.phone_e164 is null
           end
  )
)`

export interface LoteResumen {
  id: string
  filename: string
  rowCount: number
  imported: number
  updatedRows: number
  duplicates: number
  needsReview: number
  errors: number
  undoneAt: Date | null
  createdAt: Date
  /** Se puede deshacer solo si todavía no se le mandó nada a esos contactos. */
  sePuedeDeshacer: boolean
  conMensajes: number
  /**
   * Contactos del lote que **no le van a aparecer a ningún setter**: entraron
   * como cliente propio, y el pozo solo mira los leads scrapeados. Es el error
   * que no daba ningún error — la lista entraba a la base y no se podía
   * trabajar— así que el historial lo dice en voz alta.
   */
  sinSetter: number
}

export async function listarImportaciones(limite = 20): Promise<LoteResumen[]> {
  const lotes = await db
    .select()
    .from(importBatches)
    .orderBy(desc(importBatches.createdAt))
    .limit(limite)

  if (lotes.length === 0) return []

  // Cuántos contactos de cada lote ya recibieron algún mensaje.
  const conMensajes = await db
    .select({
      batchId: contacts.importBatchId,
      n: sql<number>`count(distinct ${contacts.id})::int`,
    })
    .from(contacts)
    .innerJoin(messages, eq(messages.contactId, contacts.id))
    .where(inArray(contacts.importBatchId, lotes.map((l) => l.id)))
    .groupBy(contacts.importBatchId)

  const porLote = new Map(conMensajes.map((c) => [c.batchId, c.n]))

  /*
   * Los que todavía piden revisión, contados ahora. El contador guardado en el
   * lote dice cuántos lo pedían el día de la importación, que no es lo mismo.
   */
  const pendientes = await db
    .select({ batchId: importBatchItems.batchId, n: sql<number>`count(*)::int` })
    .from(importBatchItems)
    .where(
      and(
        inArray(importBatchItems.action, ['revisar', 'error']),
        inArray(importBatchItems.batchId, lotes.map((l) => l.id)),
        SIGUE_PARA_REVISAR,
      ),
    )
    .groupBy(importBatchItems.batchId)

  const revisarPorLote = new Map(pendientes.map((p) => [p.batchId, p.n]))

  const inertes = await db
    .select({ batchId: contacts.importBatchId, n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(
      and(
        inArray(contacts.importBatchId, lotes.map((l) => l.id)),
        eq(contacts.origen, 'cliente'),
        sql`${contacts.discardedAt} is null`,
      ),
    )
    .groupBy(contacts.importBatchId)

  const sinSetterPorLote = new Map(inertes.map((i) => [i.batchId, i.n]))

  return lotes.map((l) => {
    const n = porLote.get(l.id) ?? 0
    return {
      id: l.id,
      filename: l.filename,
      rowCount: l.rowCount,
      imported: l.imported,
      updatedRows: l.updatedRows,
      duplicates: l.duplicates,
      needsReview: revisarPorLote.get(l.id) ?? 0,
      errors: l.errors,
      undoneAt: l.undoneAt,
      createdAt: l.createdAt,
      conMensajes: n,
      sinSetter: sinSetterPorLote.get(l.id) ?? 0,
      sePuedeDeshacer: l.undoneAt === null && n === 0,
    }
  })
}

export interface FilaParaRevisar {
  id: string
  batchId: string
  filename: string
  rowNumber: number
  action: 'revisar' | 'error'
  reason: string | null
  raw: Record<string, string>
  contactId: string | null
  businessName: string | null
}

/**
 * Las filas que necesitan que las mire una persona: teléfono inválido, cuenta
 * que no existe, o filas que no se pudieron importar. Ninguna se pierde en
 * silencio.
 */
export async function listarParaRevisar(limite = 500): Promise<FilaParaRevisar[]> {
  const filas = await db
    .select({
      id: importBatchItems.id,
      batchId: importBatchItems.batchId,
      filename: importBatches.filename,
      rowNumber: importBatchItems.rowNumber,
      action: importBatchItems.action,
      reason: importBatchItems.reason,
      raw: importBatchItems.raw,
      contactId: importBatchItems.contactId,
      businessName: contacts.businessName,
    })
    .from(importBatchItems)
    .innerJoin(importBatches, eq(importBatchItems.batchId, importBatches.id))
    .leftJoin(contacts, eq(importBatchItems.contactId, contacts.id))
    .where(
      and(
        inArray(importBatchItems.action, ['revisar', 'error']),
        sql`${importBatches.undoneAt} is null`,
        SIGUE_PARA_REVISAR,
      ),
    )
    .orderBy(desc(importBatchItems.createdAt), importBatchItems.rowNumber)
    .limit(limite)

  return filas.map((f) => ({
    id: f.id,
    batchId: f.batchId,
    filename: f.filename,
    rowNumber: f.rowNumber,
    action: f.action as 'revisar' | 'error',
    reason: f.reason,
    raw: (f.raw ?? {}) as Record<string, string>,
    contactId: f.contactId,
    businessName: f.businessName,
  }))
}

export async function contarParaRevisar(cliente: Db = db): Promise<number> {
  const [row] = await cliente
    .select({ n: sql<number>`count(*)::int` })
    .from(importBatchItems)
    .innerJoin(importBatches, eq(importBatchItems.batchId, importBatches.id))
    .where(
      and(
        inArray(importBatchItems.action, ['revisar', 'error']),
        sql`${importBatches.undoneAt} is null`,
        SIGUE_PARA_REVISAR,
      ),
    )
  return row?.n ?? 0
}

/** El mapeo de columnas de la última importación, para proponerlo de nuevo. */
export async function ultimoMapeo(): Promise<Mapeo | null> {
  const [ultimo] = await db
    .select({ columnMap: importBatches.columnMap })
    .from(importBatches)
    .orderBy(desc(importBatches.createdAt))
    .limit(1)

  const m = ultimo?.columnMap as Mapeo | undefined
  return m && Object.keys(m).length > 0 ? m : null
}
