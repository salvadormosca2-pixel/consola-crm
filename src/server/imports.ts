import 'server-only'

import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { db } from '@/db'
import { contacts, importBatchItems, importBatches, messages } from '@/db/schema'
import type { Mapeo } from '@/lib/import/columns'

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

  return lotes.map((l) => {
    const n = porLote.get(l.id) ?? 0
    return {
      id: l.id,
      filename: l.filename,
      rowCount: l.rowCount,
      imported: l.imported,
      updatedRows: l.updatedRows,
      duplicates: l.duplicates,
      needsReview: l.needsReview,
      errors: l.errors,
      undoneAt: l.undoneAt,
      createdAt: l.createdAt,
      conMensajes: n,
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

export async function contarParaRevisar(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(importBatchItems)
    .innerJoin(importBatches, eq(importBatchItems.batchId, importBatches.id))
    .where(
      and(
        inArray(importBatchItems.action, ['revisar', 'error']),
        sql`${importBatches.undoneAt} is null`,
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
