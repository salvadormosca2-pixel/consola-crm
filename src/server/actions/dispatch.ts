'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import { db } from '@/db'
import type { Channel } from '@/db/enums'
import { etapaDePaso } from '@/db/enums'
import { contacts, events, messages, messagingAccounts } from '@/db/schema'
import type { EstadoAccion } from '@/lib/form-state'
import { OPS_CONFIG_DEFAULT } from '@/lib/ops-config'
import { linkWhatsApp } from '@/lib/templates/render'
import { ErrorChatwoot, enviarMensaje } from '@/server/chatwoot/client'
import { leerConfigChatwoot } from '@/server/chatwoot/config'
import { ErrorEvolution, enviarTexto } from '@/server/evolution/client'
import { leerConfigEvolution } from '@/server/evolution/config'
import { deshacerEnvio, reservarYCrearMensaje } from '@/server/rotation/reserve'

/**
 * Acciones del Despachador.
 *
 * El envío es semi-automático a propósito: **nada sale sin un click**. Abrir el
 * chat y confirmar que salió son dos acciones distintas, y solo la segunda
 * consume cupo. Si abro y no mando, el sistema no puede creer que mandé.
 */

async function usuarioActual(): Promise<string | null> {
  const sesion = await auth()
  return sesion?.user?.id ?? null
}

export interface ResultadoEnvio extends EstadoAccion {
  messageId?: string
  /** Para mostrar "12 de 30" después de confirmar. */
  usadoHoy?: number
  cupo?: number
}

/**
 * Marca que se abrió el chat. No consume cupo ni mueve la etapa: solo queda
 * registrado para poder ver después qué se abrió y no se mandó.
 */
export async function registrarApertura(
  contactId: string,
  accountId: string,
  channel: Channel,
  body: string,
): Promise<EstadoAccion> {
  try {
    const actor = await usuarioActual()
    await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(messages)
        .values({
          contactId,
          accountId,
          channel,
          direction: 'out',
          body,
          status: 'abierto',
          sendMode: 'manual',
          openedAt: new Date(),
        })
        .returning({ id: messages.id })

      await tx.insert(events).values({
        type: 'mensaje_abierto',
        contactId,
        accountId,
        messageId: m?.id ?? null,
        actorUserId: actor,
      })
    })
  } catch (err) {
    console.error('Error al registrar la apertura:', err)
    return { ok: false, error: 'No se pudo registrar que abriste el chat.' }
  }
  return { ok: true, error: null }
}

/**
 * Confirma que el mensaje salió.
 *
 * Acá sí se consume cupo, avanza la etapa y se programa el seguimiento, todo en
 * la misma transacción de reserva que garantiza que ninguna cuenta se pase.
 */
export async function confirmarEnviado(params: {
  contactId: string
  accountId: string
  channel: Channel
  body: string
  paso: number
  templateId: string | null
  templateVariant: number | null
}): Promise<ResultadoEnvio> {
  try {
    const actor = await usuarioActual()
    const cfg = OPS_CONFIG_DEFAULT

    const r = await reservarYCrearMensaje(db, {
      accountId: params.accountId,
      cfg,
      // Lo dispara una persona con un click, así que la ventana horaria no
      // frena: si estoy trabajando a las 21, es mi decisión.
      ignorarVentana: true,
      mensaje: {
        contactId: params.contactId,
        channel: params.channel,
        body: params.body,
        sendMode: 'manual',
        sequenceStep: params.paso,
        templateId: params.templateId,
        templateVariant: params.templateVariant,
        status: 'enviado',
      },
    })

    if (!r.ok) return { ok: false, error: r.detalle }

    // Avanzar la etapa y programar el próximo seguimiento.
    const espera = [0, 3, 4, 7][Math.min(params.paso, 3)] ?? 7
    const proximo = new Date()
    proximo.setDate(proximo.getDate() + espera)

    await db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({
          stage: etapaDePaso(params.paso),
          sentCount: sql`${contacts.sentCount} + 1`,
          sequenceStep: params.paso,
          lastOutboundAt: new Date(),
          // Al cuarto mensaje ya no hay más secuencia.
          nextFollowupAt: params.paso >= 4 ? null : proximo,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, params.contactId))

      await tx.insert(events).values({
        type: 'mensaje_enviado',
        contactId: params.contactId,
        accountId: params.accountId,
        messageId: r.messageId,
        actorUserId: actor,
        payload: { paso: params.paso, cuenta: params.accountId },
      })
    })

    revalidatePath('/despachador')
    return { ok: true, error: null, messageId: r.messageId, usadoHoy: r.usadoHoy, cupo: r.cupo }
  } catch (err) {
    console.error('Error al confirmar el envío:', err)
    return { ok: false, error: 'No se pudo registrar el envío. Nada quedó a medias.' }
  }
}

export type ResultadoApi =
  | { via: 'chatwoot'; ok: true; usadoHoy: number; cupo: number; conversationId: number }
  | { via: 'evolution'; ok: true; usadoHoy: number; cupo: number }
  | { via: 'respaldo'; ok: true; link: string; motivo: string; usadoHoy: number; cupo: number }
  | { via: 'error'; ok: false; error: string }

/**
 * Envío automático por la API de Chatwoot. **Un click y sale**: no hay que
 * abrir WhatsApp ni cambiar de cuenta, el servidor manda desde el número que le
 * corresponde a ese contacto.
 *
 * El orden importa y es conservador a propósito:
 *
 *   1. Se reserva el cupo y se crea el mensaje en una transacción.
 *   2. Recién ahí se llama a Chatwoot.
 *   3. Si Chatwoot falla, se deshace el mensaje y el cupo se libera.
 *
 * Reservar primero significa que ante una caída se envía de menos, nunca de
 * más. Al revés —mandar y después registrar— una caída dejaría mensajes sin
 * contar y el número se pasaría del cupo sin que nadie se entere, que es
 * exactamente lo que quema una cuenta.
 */
export async function enviarPorApi(params: {
  contactId: string
  accountId: string
  body: string
  paso: number
  templateId: string | null
  templateVariant: number | null
}): Promise<ResultadoApi> {
  const actor = await usuarioActual()
  const cfg = OPS_CONFIG_DEFAULT

  const [contacto] = await db
    .select({
      businessName: contacts.businessName,
      contactName: contacts.contactName,
      phoneE164: contacts.phoneE164,
      chatwootContactId: contacts.chatwootContactId,
      chatwootConversationId: contacts.chatwootConversationId,
    })
    .from(contacts)
    .where(eq(contacts.id, params.contactId))
    .limit(1)

  if (!contacto?.phoneE164) {
    return { via: 'error', ok: false, error: 'Ese contacto no tiene un teléfono válido.' }
  }

  const [cuenta] = await db
    .select({
      code: messagingAccounts.code,
      inboxId: messagingAccounts.chatwootInboxId,
      instanceName: messagingAccounts.instanceName,
      mode: messagingAccounts.mode,
    })
    .from(messagingAccounts)
    .where(eq(messagingAccounts.id, params.accountId))
    .limit(1)

  if (!cuenta) return { via: 'error', ok: false, error: 'Esa cuenta ya no existe.' }

  const chatwoot = await leerConfigChatwoot()
  const evolution = await leerConfigEvolution()

  /*
   * Cascada de envío, en orden de preferencia:
   *
   *   1. Chatwoot — el mensaje queda en la conversación y las respuestas
   *      entran solas por el webhook.
   *   2. Evolution directo — manda igual, pero las respuestas hay que
   *      marcarlas a mano hasta que el webhook esté configurado.
   *   3. Link — sale abriendo el chat, con un click más.
   *
   * Siempre se reserva el cupo ANTES de llamar a la API, y si la API falla se
   * deshace. Ante una caída se envía de menos, nunca de más: al revés, una
   * caída dejaría mensajes sin contar y el número se pasaría del cupo sin que
   * nadie se entere, que es exactamente lo que quema una cuenta.
   */
  const puedeChatwoot = chatwoot !== null && cuenta.inboxId !== null
  const puedeEvolution = evolution !== null && cuenta.instanceName !== null

  if (!puedeChatwoot && !puedeEvolution) {
    return respaldo(
      params,
      contacto.phoneE164,
      actor,
      cfg,
      chatwoot === null && evolution === null
        ? 'Todavía no configuraste Chatwoot ni Evolution.'
        : chatwoot !== null
          ? `La cuenta ${cuenta.code} no tiene inbox de Chatwoot asignado.`
          : `La cuenta ${cuenta.code} no tiene instancia de Evolution asignada.`,
    )
  }

  const via = puedeChatwoot ? 'chatwoot' : 'evolution'

  // ── 1. Reservar cupo y crear el mensaje ─────────────────────────────
  const reserva = await reservarYCrearMensaje(db, {
    accountId: params.accountId,
    cfg,
    ignorarVentana: true,
    mensaje: {
      contactId: params.contactId,
      channel: 'whatsapp',
      body: params.body,
      sendMode: via,
      sequenceStep: params.paso,
      templateId: params.templateId,
      templateVariant: params.templateVariant,
      status: 'enviado',
    },
  })

  if (!reserva.ok) return { via: 'error', ok: false, error: reserva.detalle }

  // ── 2. Enviar de verdad ─────────────────────────────────────────────
  try {
    if (puedeChatwoot) {
      const envio = await enviarMensaje(chatwoot!, {
        inboxId: cuenta.inboxId!,
        nombre: contacto.businessName,
        e164: contacto.phoneE164,
        texto: params.body,
        contactoConocido: contacto.chatwootContactId,
        conversacionConocida: contacto.chatwootConversationId,
      })

      await db.transaction(async (tx) => {
        await tx
          .update(messages)
          .set({ chatwootMessageId: envio.chatwootMessageId, syncStatus: 'ok' })
          .where(eq(messages.id, reserva.messageId))

        await tx
          .update(contacts)
          .set({
            chatwootContactId: envio.contactId,
            chatwootConversationId: envio.conversationId,
          })
          .where(eq(contacts.id, params.contactId))
      })

      await avanzarEtapa(params.contactId, params.paso, params.accountId, reserva.messageId, actor)
      revalidatePath('/despachador')
      return {
        via: 'chatwoot',
        ok: true,
        usadoHoy: reserva.usadoHoy,
        cupo: reserva.cupo,
        conversationId: envio.conversationId,
      }
    }

    // Evolution directo.
    const envio = await enviarTexto(evolution!, {
      instancia: cuenta.instanceName!,
      e164: contacto.phoneE164,
      texto: params.body,
    })

    await db
      .update(messages)
      .set({
        externalId: envio.externalId,
        // Sin Chatwoot, el mensaje no queda espejado en la bandeja.
        syncStatus: 'sin_sincronizar',
      })
      .where(eq(messages.id, reserva.messageId))

    await avanzarEtapa(params.contactId, params.paso, params.accountId, reserva.messageId, actor)
    revalidatePath('/despachador')
    return {
      via: 'evolution',
      ok: true,
      usadoHoy: reserva.usadoHoy,
      cupo: reserva.cupo,
    }
  } catch (err) {
    // ── 3. Falló: se deshace el mensaje y el cupo se libera ────────────
    await deshacerEnvio(db, reserva.messageId, actor).catch(() => {})

    const detalle =
      err instanceof ErrorChatwoot || err instanceof ErrorEvolution
        ? err.message
        : 'El servidor de mensajería no respondió como se esperaba.'

    await db.insert(events).values({
      type: 'chatwoot_caido',
      contactId: params.contactId,
      accountId: params.accountId,
      actorUserId: actor,
      payload: { via, detalle },
    })

    // Tres fallos seguidos bloquean la cuenta sola.
    await db
      .update(messagingAccounts)
      .set({ consecutiveFailures: sql`${messagingAccounts.consecutiveFailures} + 1` })
      .where(eq(messagingAccounts.id, params.accountId))

    return respaldo(params, contacto.phoneE164, actor, cfg, detalle)
  }
}

/**
 * Respaldo por link: si Chatwoot no está o se cayó, el mensaje sale igual
 * abriendo el chat, y queda marcado como `sin_sincronizar` para reconciliarlo
 * después. Nunca se pierde un envío por una caída de Chatwoot.
 */
async function respaldo(
  params: { contactId: string; accountId: string; body: string; paso: number },
  e164: string,
  actor: string | null,
  cfg: typeof OPS_CONFIG_DEFAULT,
  motivo: string,
): Promise<ResultadoApi> {
  const reserva = await reservarYCrearMensaje(db, {
    accountId: params.accountId,
    cfg,
    ignorarVentana: true,
    mensaje: {
      contactId: params.contactId,
      channel: 'whatsapp',
      body: params.body,
      sendMode: 'manual',
      sequenceStep: params.paso,
      status: 'enviado',
    },
  })

  if (!reserva.ok) return { via: 'error', ok: false, error: reserva.detalle }

  await db
    .update(messages)
    .set({ syncStatus: 'sin_sincronizar' })
    .where(eq(messages.id, reserva.messageId))

  await db.insert(events).values({
    type: 'envio_sin_sincronizar',
    contactId: params.contactId,
    accountId: params.accountId,
    messageId: reserva.messageId,
    actorUserId: actor,
    payload: { motivo },
  })

  await avanzarEtapa(params.contactId, params.paso, params.accountId, reserva.messageId, actor)

  revalidatePath('/despachador')
  return {
    via: 'respaldo',
    ok: true,
    link: linkWhatsApp(e164, params.body),
    motivo,
    usadoHoy: reserva.usadoHoy,
    cupo: reserva.cupo,
  }
}

/** Avanza la etapa y programa el próximo seguimiento. */
async function avanzarEtapa(
  contactId: string,
  paso: number,
  accountId: string,
  messageId: string,
  actor: string | null,
): Promise<void> {
  const espera = [0, 3, 4, 7][Math.min(paso, 3)] ?? 7
  const proximo = new Date()
  proximo.setDate(proximo.getDate() + espera)

  await db.transaction(async (tx) => {
    await tx
      .update(contacts)
      .set({
        stage: etapaDePaso(paso),
        sentCount: sql`${contacts.sentCount} + 1`,
        sequenceStep: paso,
        lastOutboundAt: new Date(),
        nextFollowupAt: paso >= 4 ? null : proximo,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId))

    await tx.insert(events).values({
      type: 'mensaje_enviado',
      contactId,
      accountId,
      messageId,
      actorUserId: actor,
      payload: { paso },
    })
  })
}

/** Saltea un contacto por hoy: vuelve a aparecer mañana. */
export async function saltear(contactId: string): Promise<EstadoAccion> {
  try {
    const manana = new Date()
    manana.setDate(manana.getDate() + 1)
    manana.setHours(9, 0, 0, 0)

    await db
      .update(contacts)
      .set({ nextFollowupAt: manana, updatedAt: new Date() })
      .where(eq(contacts.id, contactId))
  } catch (err) {
    console.error('Error al saltear:', err)
    return { ok: false, error: 'No se pudo saltear.' }
  }
  revalidatePath('/despachador')
  return { ok: true, error: null }
}

/** Saca al contacto de la cola para siempre. */
export async function noContactar(contactId: string): Promise<EstadoAccion> {
  try {
    const actor = await usuarioActual()
    await db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({ stage: 'no_contactar', nextFollowupAt: null, updatedAt: new Date() })
        .where(eq(contacts.id, contactId))
      await tx.insert(events).values({
        type: 'etapa_cambiada',
        contactId,
        actorUserId: actor,
        payload: { hasta: 'no_contactar', desde: 'despachador' },
      })
    })
  } catch (err) {
    console.error('Error al marcar no contactar:', err)
    return { ok: false, error: 'No se pudo marcar.' }
  }
  revalidatePath('/despachador')
  return { ok: true, error: null }
}

/**
 * Deshace el último envío: libera el cupo, revierte la etapa y el contador.
 * Es la red de seguridad del atajo de teclado.
 */
export async function deshacerUltimo(
  messageId: string,
  contactId: string,
  pasoAnterior: number,
): Promise<EstadoAccion> {
  try {
    const actor = await usuarioActual()
    const r = await deshacerEnvio(db, messageId, actor)
    if (!r.ok) return { ok: false, error: r.error ?? 'No se pudo deshacer.' }

    await db
      .update(contacts)
      .set({
        stage: pasoAnterior === 0 ? 'nuevo' : etapaDePaso(pasoAnterior),
        sentCount: sql`greatest(${contacts.sentCount} - 1, 0)`,
        sequenceStep: pasoAnterior,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId))
  } catch (err) {
    console.error('Error al deshacer:', err)
    return { ok: false, error: 'No se pudo deshacer.' }
  }
  revalidatePath('/despachador')
  return { ok: true, error: null }
}
