'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import { db } from '@/db'
import type { ContactStage } from '@/db/enums'
import { contacts, events, messages, settings } from '@/db/schema'
import type { EstadoAccion } from '@/lib/form-state'
import { voiceSchema, VOICE_KEY, type PerfilDeVoz } from '@/lib/voice'

async function usuarioActual(): Promise<string | null> {
  const sesion = await auth()
  return sesion?.user?.id ?? null
}

/**
 * Clasificación de un contacto que respondió.
 *
 * Es la acción que más se repite en el día, así que es un solo click y no pide
 * confirmación. Todo queda en la bitácora por si hay que revisar.
 */
export async function clasificar(
  contactId: string,
  etapa: ContactStage,
): Promise<EstadoAccion> {
  try {
    const actor = await usuarioActual()
    const [antes] = await db
      .select({ stage: contacts.stage, businessName: contacts.businessName })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1)

    if (!antes) return { ok: false, error: 'Ese contacto ya no existe.' }

    await db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({
          stage: etapa,
          // Clasificar cierra la secuencia: si ya sabés en qué quedó, no hay
          // que seguir mandándole seguimientos automáticos.
          nextFollowupAt: null,
          score: puntajeDeEtapa(etapa),
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, contactId))

      await tx.insert(events).values({
        type: 'etapa_cambiada',
        contactId,
        actorUserId: actor,
        payload: { desde: antes.stage, hasta: etapa },
      })
    })
  } catch (err) {
    console.error('Error al clasificar:', err)
    return { ok: false, error: 'No se pudo clasificar.' }
  }

  revalidatePath('/contactos')
  revalidatePath('/respondieron')
  return { ok: true, error: null }
}

function puntajeDeEtapa(etapa: ContactStage): number {
  const mapa: Partial<Record<ContactStage, number>> = {
    respondido: 45,
    interesado: 70,
    reunion_agendada: 85,
    cerrado: 100,
    perdido: 0,
    no_contactar: 0,
    sin_respuesta: 5,
  }
  return mapa[etapa] ?? 20
}

/**
 * Marca a mano que un contacto contestó.
 *
 * Hace exactamente lo mismo que el webhook de Chatwoot: registra el mensaje
 * entrante, mueve a Respondió y **corta la secuencia pendiente**. Que llegue un
 * seguimiento después de que la persona ya te contestó es el peor error posible
 * de este sistema.
 */
export async function marcarQueContesto(
  contactId: string,
  queDijo?: string,
): Promise<EstadoAccion> {
  try {
    const actor = await usuarioActual()
    const ahora = new Date()

    const [contacto] = await db
      .select({
        stage: contacts.stage,
        firstRepliedAt: contacts.firstRepliedAt,
        assignedWaAccountId: contacts.assignedWaAccountId,
        preferredChannel: contacts.preferredChannel,
      })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1)

    if (!contacto) return { ok: false, error: 'Ese contacto ya no existe.' }

    await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(messages)
        .values({
          contactId,
          accountId: contacto.assignedWaAccountId,
          channel: contacto.preferredChannel ?? 'whatsapp',
          direction: 'in',
          body: queDijo?.trim() || null,
          status: 'respondido',
          sendMode: 'manual',
        })
        .returning({ id: messages.id })

      await tx
        .update(contacts)
        .set({
          // Si ya estaba clasificado más adelante, no se retrocede.
          stage: yaClasificado(contacto.stage) ? contacto.stage : 'respondido',
          receivedCount: sql`${contacts.receivedCount} + 1`,
          threadCount: sql`${contacts.threadCount} + 1`,
          lastInboundAt: ahora,
          firstRepliedAt: contacto.firstRepliedAt ?? ahora,
          // Corte absoluto de la secuencia.
          nextFollowupAt: null,
          score: sql`greatest(${contacts.score}, 45)`,
          updatedAt: ahora,
        })
        .where(eq(contacts.id, contactId))

      await tx.insert(events).values({
        type: 'respuesta_recibida',
        contactId,
        messageId: m?.id ?? null,
        actorUserId: actor,
        payload: { manual: true },
      })
    })
  } catch (err) {
    console.error('Error al marcar la respuesta:', err)
    return { ok: false, error: 'No se pudo registrar la respuesta.' }
  }

  revalidatePath('/contactos')
  revalidatePath('/respondieron')
  revalidatePath('/despachador')
  return { ok: true, error: null }
}

function yaClasificado(etapa: ContactStage): boolean {
  return ['interesado', 'reunion_agendada', 'cerrado', 'perdido', 'no_contactar'].includes(etapa)
}

/** Cambia el canal preferido de un contacto y lo deja fijado. */
export async function forzarCanal(
  contactId: string,
  canal: 'whatsapp' | 'instagram',
): Promise<EstadoAccion> {
  try {
    await db
      .update(contacts)
      .set({ preferredChannel: canal, preferredChannelLocked: true, updatedAt: new Date() })
      .where(eq(contacts.id, contactId))
  } catch (err) {
    console.error('Error al forzar el canal:', err)
    return { ok: false, error: 'No se pudo cambiar el canal.' }
  }
  revalidatePath('/contactos')
  return { ok: true, error: null }
}

/* ── Perfil de voz ────────────────────────────────────────────────────── */

export async function guardarVoz(perfil: PerfilDeVoz): Promise<EstadoAccion> {
  const parsed = voiceSchema.safeParse(perfil)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  }

  try {
    await db
      .insert(settings)
      .values({ key: VOICE_KEY, value: parsed.data })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: parsed.data, updatedAt: new Date() },
      })
  } catch (err) {
    console.error('Error al guardar la voz:', err)
    return { ok: false, error: 'No se pudo guardar.' }
  }

  revalidatePath('/mi-voz')
  revalidatePath('/plantillas')
  revalidatePath('/despachador')
  return { ok: true, error: null }
}
