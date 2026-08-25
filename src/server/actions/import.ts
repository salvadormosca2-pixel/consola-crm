'use server'

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import { db } from '@/db'
import type { ContactOrigen } from '@/db/enums'
import { contacts, events, importBatchItems, importBatches, messages } from '@/db/schema'
import type { EstadoAccion } from '@/lib/form-state'
import type { FilaPreparada } from '@/lib/import/rows'
import { canalPreferido } from '@/lib/import/rows'

/**
 * Persistencia del importador.
 *
 * El parseo, la normalización y la deduplicación pasan en el navegador (Web
 * Worker) para no congelar la pantalla con 1.000 filas. Acá llegan las filas ya
 * preparadas, de a lotes, y esto se ocupa de lo que solo puede hacer el
 * servidor: deduplicar contra la base y escribir.
 *
 * Cada lote es una transacción. Si un lote falla, se revierte entero y la
 * importación queda marcada como parcial, con el número de fila exacto.
 */

async function usuarioActual(): Promise<string | null> {
  const sesion = await auth()
  return sesion?.user?.id ?? null
}

export interface ResumenLote {
  insertados: number
  actualizados: number
  duplicados: number
  paraRevisar: number
  errores: number
}

const LOTE_VACIO: ResumenLote = {
  insertados: 0,
  actualizados: 0,
  duplicados: 0,
  paraRevisar: 0,
  errores: 0,
}

/** Abre un lote de importación y devuelve su id. */
export async function abrirImportacion(
  filename: string,
  rowCount: number,
  columnMap: Record<string, number>,
): Promise<{ ok: true; batchId: string } | { ok: false; error: string }> {
  try {
    const actor = await usuarioActual()
    const [lote] = await db
      .insert(importBatches)
      .values({ filename, rowCount, columnMap, createdBy: actor })
      .returning({ id: importBatches.id })
    if (!lote) return { ok: false, error: 'No se pudo abrir la importación.' }
    return { ok: true, batchId: lote.id }
  } catch (err) {
    console.error('Error al abrir la importación:', err)
    return { ok: false, error: 'No se pudo abrir la importación. Revisá la conexión con la base.' }
  }
}

export interface ResultadoLote {
  ok: boolean
  error?: string
  resumen: ResumenLote
}

/**
 * Escribe un lote de filas ya preparadas.
 *
 * `completarVacios` decide qué hacer con los contactos que ya existen: si es
 * true, se les completan los campos que estén vacíos con los datos nuevos; si
 * es false, no se los toca y solo se cuentan como duplicados.
 */
export async function importarLote(
  batchId: string,
  filas: FilaPreparada[],
  completarVacios: boolean,
  origen: ContactOrigen = 'cliente',
): Promise<ResultadoLote> {
  if (filas.length === 0) return { ok: true, resumen: LOTE_VACIO }

  const resumen: ResumenLote = { ...LOTE_VACIO }

  try {
    await db.transaction(async (tx) => {
      // ── 1. Buscar cuáles ya existen, por teléfono O por Instagram ──────
      const telefonos = filas.map((f) => f.phoneE164).filter((x): x is string => x !== null)
      const usuarios = filas.map((f) => f.igUsername).filter((x): x is string => x !== null)

      const existentes =
        telefonos.length + usuarios.length > 0
          ? await tx
              .select({
                id: contacts.id,
                phoneE164: contacts.phoneE164,
                igUsername: contacts.igUsername,
                businessName: contacts.businessName,
                contactName: contacts.contactName,
                niche: contacts.niche,
                bought: contacts.bought,
                city: contacts.city,
                notes: contacts.notes,
                hasWhatsapp: contacts.hasWhatsapp,
                hasInstagram: contacts.hasInstagram,
              })
              .from(contacts)
              .where(
                or(
                  telefonos.length > 0 ? inArray(contacts.phoneE164, telefonos) : sql`false`,
                  usuarios.length > 0 ? inArray(contacts.igUsername, usuarios) : sql`false`,
                ),
              )
          : []

      const porTelefono = new Map(
        existentes.filter((e) => e.phoneE164).map((e) => [e.phoneE164!, e]),
      )
      const porInstagram = new Map(
        existentes.filter((e) => e.igUsername).map((e) => [e.igUsername!, e]),
      )

      // ── 2. Separar nuevas de existentes ────────────────────────────────
      type Existente = (typeof existentes)[number]
      const nuevas: FilaPreparada[] = []
      const yaEstaban: Array<{ fila: FilaPreparada; actual: Existente }> = []

      for (const fila of filas) {
        if (fila.descartada) continue
        const previa =
          (fila.phoneE164 ? porTelefono.get(fila.phoneE164) : undefined) ??
          (fila.igUsername ? porInstagram.get(fila.igUsername) : undefined)
        if (previa) yaEstaban.push({ fila, actual: previa })
        else nuevas.push(fila)
      }

      // ── 4. Insertar las nuevas ─────────────────────────────────────────
      for (const fila of nuevas) {
        const avisos = [...fila.avisos]

        const [creado] = await tx
          .insert(contacts)
          .values({
            businessName: fila.businessName,
            contactName: fila.contactName,
            phoneRaw: fila.phoneRaw,
            phoneE164: fila.phoneE164,
            hasWhatsapp: fila.hasWhatsapp,
            igUsername: fila.igUsername,
            hasInstagram: fila.hasInstagram,
            niche: fila.niche,
            bought: fila.bought,
            city: fila.city,
            notes: fila.notes,
            preferredChannel: canalPreferido(fila),
            origen,
            importBatchId: batchId,
            dedupeKey: fila.dedupeKey,
          })
          .returning({ id: contacts.id })

        resumen.insertados++
        if (avisos.length > 0) resumen.paraRevisar++

        await tx.insert(importBatchItems).values({
          batchId,
          rowNumber: fila.rowNumber,
          action: avisos.length > 0 ? 'revisar' : 'insertado',
          contactId: creado?.id ?? null,
          reason: avisos.length > 0 ? avisos.join(' · ') : null,
          raw: fila.raw,
        })
      }

      // ── 5. Actualizar las que ya estaban, sin pisar nada ───────────────
      for (const { fila, actual } of yaEstaban) {
        resumen.duplicados++

        if (!completarVacios) {
          await tx.insert(importBatchItems).values({
            batchId,
            rowNumber: fila.rowNumber,
            action: 'duplicado',
            contactId: actual.id,
            reason: 'Ya existía. No se tocó nada.',
            raw: fila.raw,
          })
          continue
        }

        // Solo se completan campos vacíos. Nunca se pisa un dato cargado.
        const cambios: Record<string, unknown> = {}
        if (!actual.contactName && fila.contactName) cambios.contactName = fila.contactName
        if (!actual.niche && fila.niche) cambios.niche = fila.niche
        if (!actual.bought && fila.bought) cambios.bought = fila.bought
        if (!actual.city && fila.city) cambios.city = fila.city
        if (!actual.notes && fila.notes) cambios.notes = fila.notes
        if (!actual.phoneE164 && fila.phoneE164) {
          cambios.phoneE164 = fila.phoneE164
          cambios.phoneRaw = fila.phoneRaw
          cambios.hasWhatsapp = true
        }
        if (!actual.igUsername && fila.igUsername) {
          cambios.igUsername = fila.igUsername
          cambios.hasInstagram = true
        }

        if (Object.keys(cambios).length === 0) {
          await tx.insert(importBatchItems).values({
            batchId,
            rowNumber: fila.rowNumber,
            action: 'duplicado',
            contactId: actual.id,
            reason: 'Ya existía y no traía datos nuevos.',
            raw: fila.raw,
          })
          continue
        }

        cambios.updatedAt = new Date()
        await tx.update(contacts).set(cambios).where(eq(contacts.id, actual.id))
        resumen.actualizados++

        // El estado anterior queda guardado: sin esto, deshacer una
        // actualización sería imposible y quedarían datos pisados sin vuelta atrás.
        await tx.insert(importBatchItems).values({
          batchId,
          rowNumber: fila.rowNumber,
          action: 'actualizado',
          contactId: actual.id,
          reason: `Se completaron ${Object.keys(cambios).length - 1} campos vacíos.`,
          raw: fila.raw,
          previous: actual,
        })
      }

      // ── 6. Registrar las filas que no se pudieron importar ─────────────
      for (const fila of filas.filter((f) => f.descartada)) {
        resumen.errores++
        await tx.insert(importBatchItems).values({
          batchId,
          rowNumber: fila.rowNumber,
          action: 'error',
          reason: fila.avisos.join(' · '),
          raw: fila.raw,
        })
      }

      // ── 7. Acumular los contadores del lote ────────────────────────────
      await tx
        .update(importBatches)
        .set({
          imported: sql`${importBatches.imported} + ${resumen.insertados}`,
          updatedRows: sql`${importBatches.updatedRows} + ${resumen.actualizados}`,
          duplicates: sql`${importBatches.duplicates} + ${resumen.duplicados}`,
          needsReview: sql`${importBatches.needsReview} + ${resumen.paraRevisar}`,
          errors: sql`${importBatches.errors} + ${resumen.errores}`,
        })
        .where(eq(importBatches.id, batchId))

      return
    })

    return { ok: true, resumen }
  } catch (err) {
    console.error('Error al importar el lote:', err)
    const primera = filas[0]?.rowNumber ?? 0
    const ultima = filas[filas.length - 1]?.rowNumber ?? 0
    return {
      ok: false,
      error: `Falló el lote de las filas ${primera} a ${ultima}. No se importó ninguna de ellas; las anteriores sí quedaron.`,
      resumen,
    }
  }
}

/** Cierra la importación y deja el evento en la bitácora. */
export async function cerrarImportacion(batchId: string): Promise<EstadoAccion> {
  try {
    const actor = await usuarioActual()
    const [lote] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1)
    if (!lote) return { ok: false, error: 'Esa importación ya no existe.' }

    await db.insert(events).values({
      type: 'contacto_importado',
      actorUserId: actor,
      payload: {
        batchId,
        filename: lote.filename,
        importados: lote.imported,
        actualizados: lote.updatedRows,
        duplicados: lote.duplicates,
        revisar: lote.needsReview,
        errores: lote.errors,
      },
    })
  } catch (err) {
    console.error('Error al cerrar la importación:', err)
    return { ok: false, error: 'No se pudo cerrar la importación.' }
  }

  revalidatePath('/importar')
  revalidatePath('/contactos')
  return { ok: true, error: null }
}

/**
 * Deshace una importación completa.
 *
 * Borra los contactos que creó y revierte los campos que completó, usando el
 * estado anterior guardado en `import_batch_items`. Solo se puede si todavía no
 * se le mandó nada a esos contactos: una vez que el cliente recibió un mensaje,
 * borrarlo del sistema sería perder el registro de que le escribimos.
 */
export async function deshacerImportacion(batchId: string): Promise<EstadoAccion> {
  try {
    const actor = await usuarioActual()

    const [conMensajes] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(contacts, eq(messages.contactId, contacts.id))
      .where(eq(contacts.importBatchId, batchId))

    if ((conMensajes?.n ?? 0) > 0) {
      return {
        ok: false,
        error: `No se puede deshacer: ya se le mandaron mensajes a ${conMensajes!.n} de estos contactos.`,
      }
    }

    await db.transaction(async (tx) => {
      // Revertir las actualizaciones, campo por campo, al estado anterior.
      const actualizados = await tx
        .select({ contactId: importBatchItems.contactId, previous: importBatchItems.previous })
        .from(importBatchItems)
        .where(and(eq(importBatchItems.batchId, batchId), eq(importBatchItems.action, 'actualizado')))

      for (const item of actualizados) {
        if (!item.contactId || !item.previous) continue
        const p = item.previous as Record<string, unknown>
        await tx
          .update(contacts)
          .set({
            contactName: (p.contactName as string | null) ?? null,
            niche: (p.niche as string | null) ?? null,
            bought: (p.bought as string | null) ?? null,
            city: (p.city as string | null) ?? null,
            notes: (p.notes as string | null) ?? null,
            phoneE164: (p.phoneE164 as string | null) ?? null,
            hasWhatsapp: Boolean(p.hasWhatsapp),
            igUsername: (p.igUsername as string | null) ?? null,
            hasInstagram: Boolean(p.hasInstagram),
            assignedWaAccountId: (p.assignedWaAccountId as string | null) ?? null,
            assignedIgAccountId: (p.assignedIgAccountId as string | null) ?? null,
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, item.contactId))
      }

      // Borrar los contactos que creó este lote.
      await tx.delete(contacts).where(eq(contacts.importBatchId, batchId))

      await tx.update(importBatches).set({ undoneAt: new Date() }).where(eq(importBatches.id, batchId))

      await tx.insert(events).values({
        type: 'importacion_deshecha',
        actorUserId: actor,
        payload: { batchId, revertidos: actualizados.length },
      })
    })
  } catch (err) {
    console.error('Error al deshacer la importación:', err)
    return { ok: false, error: 'No se pudo deshacer la importación.' }
  }

  revalidatePath('/importar')
  revalidatePath('/contactos')
  return { ok: true, error: null }
}

/** Marca una fila de Revisar como resuelta, sacándola de la lista. */
export async function resolverRevision(itemId: string): Promise<EstadoAccion> {
  try {
    await db
      .update(importBatchItems)
      .set({ action: 'insertado', reason: null })
      .where(and(eq(importBatchItems.id, itemId), eq(importBatchItems.action, 'revisar')))
  } catch (err) {
    console.error('Error al resolver la revisión:', err)
    return { ok: false, error: 'No se pudo marcar como resuelta.' }
  }
  revalidatePath('/importar')
  return { ok: true, error: null }
}

/** Contactos sin cuenta asignada que quedaron esperando. */
export async function contarSinAsignar(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(
      and(
        isNull(contacts.assignedWaAccountId),
        isNull(contacts.assignedIgAccountId),
        isNull(contacts.discardedAt),
      ),
    )
  return row?.n ?? 0
}
