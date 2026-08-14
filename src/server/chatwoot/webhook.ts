import 'server-only'

import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { contacts, events, messages, messagingAccounts } from '@/db/schema'
import { normalizarTelefonoAr } from '@/lib/phone-ar'

import { marcarWebhookRecibido } from './config'

/**
 * Webhook de Chatwoot.
 *
 * Es obligatorio aunque la bandeja esté embebida: **un iframe no le cuenta nada
 * a la aplicación que lo contiene**. Sin esto, la consola creería que nadie
 * contestó y seguiría mandando seguimientos a gente que ya respondió, que es el
 * peor error posible del sistema.
 *
 * Todo lo que entra se valida con Zod y se deduplica por `chatwoot_message_id`:
 * Chatwoot reintenta los webhooks, y un mensaje contado dos veces rompe los
 * cupos.
 */

const contactoSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().nullable().optional(),
    phone_number: z.string().nullable().optional(),
    identifier: z.string().nullable().optional(),
  })
  .passthrough()

const conversacionSchema = z
  .object({
    id: z.number().optional(),
    inbox_id: z.number().optional(),
    status: z.string().optional(),
    meta: z.object({ sender: contactoSchema.optional() }).partial().optional(),
  })
  .passthrough()

/**
 * Chatwoot manda el payload con formas distintas según el evento y la versión,
 * así que se acepta amplio y se normaliza acá adentro.
 */
export const eventoSchema = z
  .object({
    event: z.string(),
    id: z.union([z.number(), z.string()]).optional(),
    message_type: z.union([z.string(), z.number()]).optional(),
    content: z.string().nullable().optional(),
    private: z.boolean().optional(),
    inbox: z.object({ id: z.number().optional() }).partial().optional(),
    conversation: conversacionSchema.optional(),
    sender: contactoSchema.optional(),
    contact: contactoSchema.optional(),
    account: z.object({ id: z.number().optional() }).partial().optional(),
  })
  .passthrough()

export type EventoChatwoot = z.infer<typeof eventoSchema>

export type ResultadoWebhook =
  | { accion: 'entrante'; contactId: string; corto_secuencia: boolean }
  | { accion: 'saliente_a_mano'; contactId: string; cuenta: string | null }
  | { accion: 'duplicado' }
  | { accion: 'ignorado'; motivo: string }

/** 'incoming' llega como texto o como 0/1 según la versión. */
function direccion(v: unknown): 'in' | 'out' | null {
  if (v === 'incoming' || v === 0) return 'in'
  if (v === 'outgoing' || v === 1) return 'out'
  return null
}

export async function procesarEvento(evento: EventoChatwoot): Promise<ResultadoWebhook> {
  // Siempre se sella, aunque el evento no aplique: es la señal de que el
  // webhook está vivo, que es lo que mira el indicador de sincronización.
  await marcarWebhookRecibido()

  if (evento.event !== 'message_created') {
    return { accion: 'ignorado', motivo: `Evento ${evento.event}, no aplica.` }
  }

  const dir = direccion(evento.message_type)
  if (dir === null) return { accion: 'ignorado', motivo: 'Sin dirección reconocible.' }

  // Las notas privadas no son mensajes al cliente.
  if (evento.private === true) return { accion: 'ignorado', motivo: 'Nota privada.' }

  const chatwootMessageId = typeof evento.id === 'number' ? evento.id : Number(evento.id)
  if (!Number.isFinite(chatwootMessageId)) {
    return { accion: 'ignorado', motivo: 'El evento no trae id de mensaje.' }
  }

  // ── Idempotencia ────────────────────────────────────────────────────
  const [yaEsta] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.chatwootMessageId, chatwootMessageId))
    .limit(1)

  if (yaEsta) return { accion: 'duplicado' }

  // ── Encontrar el contacto ───────────────────────────────────────────
  const cw = evento.conversation?.meta?.sender ?? evento.sender ?? evento.contact
  const conversationId = evento.conversation?.id ?? null
  const inboxId = evento.inbox?.id ?? evento.conversation?.inbox_id ?? null

  const contacto = await buscarContacto(cw, conversationId)
  if (!contacto) {
    return {
      accion: 'ignorado',
      motivo: 'No se encontró a qué contacto corresponde. ¿Es alguien que no está en la base?',
    }
  }

  // La cuenta sale del inbox: es lo que asocia el mensaje al número correcto.
  const cuenta = inboxId !== null ? await buscarCuentaPorInbox(inboxId) : null

  if (dir === 'in') return registrarEntrante(contacto, evento, chatwootMessageId, cuenta, conversationId)
  return registrarSalienteAMano(contacto, evento, chatwootMessageId, cuenta, conversationId)
}

async function buscarContacto(
  cw: z.infer<typeof contactoSchema> | undefined,
  conversationId: number | null,
): Promise<{ id: string; stage: string; firstRepliedAt: Date | null; bought: string | null } | null> {
  const seleccion = {
    id: contacts.id,
    stage: contacts.stage,
    firstRepliedAt: contacts.firstRepliedAt,
    bought: contacts.bought,
  }

  // 1. Por la conversación, que es lo más preciso.
  if (conversationId !== null) {
    const [porConv] = await db
      .select(seleccion)
      .from(contacts)
      .where(eq(contacts.chatwootConversationId, conversationId))
      .limit(1)
    if (porConv) return porConv
  }

  // 2. Por el id de contacto de Chatwoot.
  if (cw?.id !== undefined) {
    const [porId] = await db
      .select(seleccion)
      .from(contacts)
      .where(eq(contacts.chatwootContactId, cw.id))
      .limit(1)
    if (porId) return porId
  }

  // 3. Por teléfono normalizado. Es el que resuelve el primer mensaje de
  //    alguien que todavía no tiene el espejo cargado.
  const crudo = cw?.identifier ?? cw?.phone_number
  if (crudo) {
    const tel = normalizarTelefonoAr(crudo)
    if (tel.ok) {
      const [porTel] = await db
        .select(seleccion)
        .from(contacts)
        .where(eq(contacts.phoneE164, tel.e164))
        .limit(1)
      if (porTel) return porTel
    }
  }

  return null
}

async function buscarCuentaPorInbox(inboxId: number): Promise<{ id: string; code: string } | null> {
  const [c] = await db
    .select({ id: messagingAccounts.id, code: messagingAccounts.code })
    .from(messagingAccounts)
    .where(eq(messagingAccounts.chatwootInboxId, inboxId))
    .limit(1)
  return c ?? null
}

/**
 * Mensaje entrante: el cliente contestó.
 *
 * Corta la secuencia en el acto. Es la regla más importante de todo el sistema.
 */
async function registrarEntrante(
  contacto: { id: string; stage: string; firstRepliedAt: Date | null; bought: string | null },
  evento: EventoChatwoot,
  chatwootMessageId: number,
  cuenta: { id: string; code: string } | null,
  conversationId: number | null,
): Promise<ResultadoWebhook> {
  const ahora = new Date()
  const esPrimera = contacto.firstRepliedAt === null

  await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(messages)
      .values({
        contactId: contacto.id,
        accountId: cuenta?.id ?? null,
        channel: 'whatsapp',
        direction: 'in',
        body: evento.content ?? null,
        status: 'respondido',
        sendMode: 'chatwoot',
        chatwootMessageId,
        syncStatus: 'ok',
      })
      .returning({ id: messages.id })

    await tx
      .update(contacts)
      .set({
        // Si ya lo clasifiqué más adelante, no se retrocede.
        stage: yaClasificado(contacto.stage) ? undefined : 'respondido',
        receivedCount: sql`${contacts.receivedCount} + 1`,
        threadCount: sql`${contacts.threadCount} + 1`,
        lastInboundAt: ahora,
        firstRepliedAt: contacto.firstRepliedAt ?? ahora,
        // Corte absoluto de la secuencia pendiente.
        nextFollowupAt: null,
        score: sql`least(${contacts.score} + ${esPrimera ? 30 : 5}, 100)`,
        ...(conversationId !== null ? { chatwootConversationId: conversationId } : {}),
        updatedAt: ahora,
      })
      .where(eq(contacts.id, contacto.id))

    await tx.insert(events).values({
      type: 'respuesta_recibida',
      contactId: contacto.id,
      accountId: cuenta?.id ?? null,
      messageId: m?.id ?? null,
      payload: { via: 'chatwoot', chatwootMessageId, primera: esPrimera },
    })
  })

  return { accion: 'entrante', contactId: contacto.id, corto_secuencia: true }
}

function yaClasificado(etapa: string): boolean {
  return ['interesado', 'reunion_agendada', 'cerrado', 'perdido', 'no_contactar'].includes(etapa)
}

/**
 * Saliente escrito a mano dentro de Chatwoot.
 *
 * **Consume cupo.** Si no se contara, se podrían mandar 30 desde el Despachador
 * más 12 respuestas desde la bandeja y ese número habría mandado 42 sin que
 * nadie se entere. Es exactamente lo que quema una cuenta.
 */
async function registrarSalienteAMano(
  contacto: { id: string },
  evento: EventoChatwoot,
  chatwootMessageId: number,
  cuenta: { id: string; code: string } | null,
  conversationId: number | null,
): Promise<ResultadoWebhook> {
  const ahora = new Date()

  await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(messages)
      .values({
        contactId: contacto.id,
        accountId: cuenta?.id ?? null,
        channel: 'whatsapp',
        direction: 'out',
        body: evento.content ?? null,
        // 'enviado' es lo que hace que consuma cupo en el recuento.
        status: 'enviado',
        sendMode: 'chatwoot_agente',
        chatwootMessageId,
        syncStatus: 'ok',
        sentAt: ahora,
      })
      .returning({ id: messages.id })

    await tx
      .update(contacts)
      .set({
        lastOutboundAt: ahora,
        ...(conversationId !== null ? { chatwootConversationId: conversationId } : {}),
        updatedAt: ahora,
      })
      .where(eq(contacts.id, contacto.id))

    if (cuenta) {
      // La caché se corrige sola en el próximo envío, pero se deja al día para
      // que el medidor no muestre de menos mientras tanto.
      await tx.execute(sql`
        update messaging_accounts
           set sent_today = (
                 select count(*) from messages
                  where account_id = ${cuenta.id}
                    and status in ('enviado','entregado','leido','respondido')
                    and undone_at is null
                    and (sent_at at time zone 'America/Argentina/Catamarca')::date
                        = (now() at time zone 'America/Argentina/Catamarca')::date),
               counter_date = (now() at time zone 'America/Argentina/Catamarca')::date,
               last_sent_at = now()
         where id = ${cuenta.id}
      `)
    }

    await tx.insert(events).values({
      type: 'chatwoot_saliente_a_mano',
      contactId: contacto.id,
      accountId: cuenta?.id ?? null,
      messageId: m?.id ?? null,
      payload: { chatwootMessageId, cuenta: cuenta?.code ?? null },
    })
  })

  return { accion: 'saliente_a_mano', contactId: contacto.id, cuenta: cuenta?.code ?? null }
}
