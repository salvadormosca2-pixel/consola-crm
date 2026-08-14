import { sql } from 'drizzle-orm'

import type { Db } from '@/db'
import type { AccountStatus, Channel, MotivoRechazo, MsgSendMode } from '@/db/enums'
import { MOTIVOS_RECHAZO } from '@/db/enums'
import type { OpsConfig } from '@/lib/ops-config'

import {
  cupoEfectivo,
  esperaMinimaSeg,
  rangoDelDiaUtc,
  techoParaLaConsola,
  ventanaAbierta,
} from './quota'

/**
 * Reserva de cupo y creación del mensaje, en una sola transacción.
 *
 * El invariante que garantiza este archivo:
 *
 *   Para toda cuenta A y fecha operativa D,
 *     count(messages con account_id=A, status que consume cupo, sin deshacer,
 *           sent_at dentro de D)  <=  cupoEfectivo(A, D)
 *
 * `messaging_accounts.sent_today` NO aparece en el invariante: es una caché de
 * presentación y de ordenamiento. La autoridad es siempre `messages`, y se
 * recuenta dentro de la transacción, después de tomar el lock de la cuenta.
 */

/** Estados que consumen cupo. Lo abierto sin confirmar, lo fallido y lo saltado, no. */
export const ESTADOS_QUE_CONSUMEN = ['enviado', 'entregado', 'leido', 'respondido'] as const

export type ResultadoReserva =
  | {
      ok: true
      messageId: string
      accountId: string
      /** Cuántos lleva la cuenta hoy, contando este. */
      usadoHoy: number
      cupo: number
      /** Si la caché estaba desincronizada y se corrigió. */
      correccion: { cacheDecia: number; realEra: number } | null
    }
  | { ok: false; motivo: MotivoRechazo; detalle: string }

export interface DatosDelMensaje {
  contactId: string
  channel: Channel
  body: string
  templateId?: string | null
  templateVariant?: number | null
  sequenceStep?: number | null
  sendMode: MsgSendMode
  pilotId?: string | null
  /** 'enviado' para envío confirmado; 'abierto' para "abrí el chat" sin confirmar. */
  status?: 'enviado' | 'abierto'
  externalId?: string | null
}

interface FilaCuenta {
  id: string
  status: AccountStatus
  daily_cap: number
  min_gap_seconds: number
  warmup_day: number | null
  window_start: string
  window_end: string
  sent_today: number
  counter_date: string | null
  last_sent_at: Date | null
}

/**
 * Clave idempotente de un envío: contacto + paso + fecha operativa.
 *
 * Un reintento de red, un doble click o un reenvío de webhook generan la misma
 * clave y chocan contra el índice único, así que no crean un segundo mensaje ni
 * consumen cupo dos veces.
 */
export function claveIdempotente(contactId: string, paso: number | null, fecha: string): string {
  return `${contactId}:${paso ?? 0}:${fecha}`
}

/**
 * Reserva cupo en `accountId` y crea el mensaje. Todo o nada.
 *
 * `ahora` es inyectable para poder testear ventanas horarias y esperas sin
 * esperar en tiempo real.
 */
export async function reservarYCrearMensaje(
  db: Db,
  params: {
    accountId: string
    mensaje: DatosDelMensaje
    cfg: OpsConfig
    ahora?: Date
    /** Saltea la ventana horaria. Solo para el envío manual, que lo dispara una persona. */
    ignorarVentana?: boolean
  },
): Promise<ResultadoReserva> {
  const ahora = params.ahora ?? new Date()
  const { cfg, mensaje } = params
  const { fecha, desde, hasta } = rangoDelDiaUtc(ahora)

  return db.transaction(async (tx) => {
    // ── 1. Lock exclusivo de la cuenta ───────────────────────────────────
    // FOR UPDATE sin SKIP LOCKED: la cuenta ya está decidida (pegada al
    // contacto), así que saltearla sería perder el envío. Hay que esperar.
    const bloqueada = await tx.execute(sql`
      select id, status, daily_cap, min_gap_seconds, warmup_day,
             window_start, window_end, sent_today, counter_date, last_sent_at
        from messaging_accounts
       where id = ${params.accountId}
       for update
    `)
    const cuenta = bloqueada.rows[0] as FilaCuenta | undefined
    if (!cuenta) {
      return { ok: false as const, motivo: 'sin_cuenta', detalle: 'Esa cuenta ya no existe.' }
    }

    const paraCupo = {
      status: cuenta.status,
      dailyCap: cuenta.daily_cap,
      minGapSeconds: cuenta.min_gap_seconds,
      warmupDay: cuenta.warmup_day,
      windowStart: cuenta.window_start,
      windowEnd: cuenta.window_end,
    }

    // ── 2. La cuenta tiene que estar en condiciones ──────────────────────
    if (cuenta.status !== 'activa' && cuenta.status !== 'calentando') {
      return {
        ok: false as const,
        motivo: 'no_operativa',
        detalle: `La cuenta está en estado ${cuenta.status.replace('_', ' ')}.`,
      }
    }

    if (!params.ignorarVentana) {
      const v = ventanaAbierta(paraCupo, cfg, ahora)
      if (!v.abierta) {
        return { ok: false as const, motivo: v.motivo, detalle: MOTIVOS_RECHAZO[v.motivo] }
      }
    }

    // ── 3. Recuento desde la fuente de verdad ────────────────────────────
    // Rango UTC precalculado en vez de AT TIME ZONE sobre la columna: así usa
    // el índice messages_cupo_idx en lugar de recorrer la tabla.
    const conteo = await tx.execute(sql`
      select count(*)::int as n
        from messages
       where account_id = ${params.accountId}
         and status in ('enviado', 'entregado', 'leido', 'respondido')
         and undone_at is null
         and sent_at >= ${desde.toISOString()}
         and sent_at <  ${hasta.toISOString()}
    `)
    const real = (conteo.rows[0] as { n: number } | undefined)?.n ?? 0

    // ── 4. Corregir la caché si difiere ──────────────────────────────────
    const cacheDeHoy = cuenta.counter_date === fecha ? cuenta.sent_today : 0
    const correccion = cacheDeHoy !== real ? { cacheDecia: cacheDeHoy, realEra: real } : null
    if (correccion) {
      await tx.execute(sql`
        insert into events (type, account_id, payload_jsonb)
        values ('cupo_corregido', ${params.accountId},
                ${JSON.stringify({ fecha, cacheDecia: cacheDeHoy, realEra: real })}::jsonb)
      `)
    }

    // ── 5. ¿Hay cupo? Decide `real`, nunca la caché ──────────────────────
    //
    // El cupo del día es `cupo`, pero la consola se frena en `techo`, unos
    // mensajes antes: el resto queda reservado para las respuestas que se
    // escriben a mano en Chatwoot, que se cuentan recién cuando llega el
    // webhook. Sin ese colchón, la consola podría aprobar un envío que termine
    // desbordando el cupo real del número.
    const cupo = cupoEfectivo(paraCupo, cfg)
    const techo = techoParaLaConsola(paraCupo, cfg)
    if (real >= techo) {
      await tx.execute(sql`
        insert into events (type, account_id, payload_jsonb)
        values ('cap_alcanzado', ${params.accountId},
                ${JSON.stringify({ fecha, cupo, techo, usado: real })}::jsonb)
      `)
      // La caché se deja consistente aunque el envío no salga.
      await tx.execute(sql`
        update messaging_accounts
           set sent_today = ${real}, counter_date = ${fecha}
         where id = ${params.accountId}
      `)
      return {
        ok: false as const,
        motivo: 'cupo',
        detalle:
          techo < cupo
            ? `${MOTIVOS_RECHAZO.cupo} Lleva ${real} de ${cupo}, y los últimos ${cupo - techo} quedan para tus respuestas en Chatwoot.`
            : `${MOTIVOS_RECHAZO.cupo} Lleva ${real} de ${cupo}.`,
      }
    }

    // ── 6. Espera mínima entre envíos de la misma cuenta ─────────────────
    const espera = esperaMinimaSeg(paraCupo, cfg)
    if (cuenta.last_sent_at && espera > 0) {
      /*
       * El transcurrido se clampea a 0 porque puede dar negativo: bajo
       * concurrencia, una transacción que esperó el lock captura `ahora` ANTES
       * de entrar, y para cuando lee la fila, la transacción anterior ya escribió
       * un `last_sent_at` posterior. Sin el clamp, ese envío se rechazaba por
       * "espera" aunque la espera configurada fuera cero.
       */
      const transcurrido = Math.max(
        0,
        (ahora.getTime() - new Date(cuenta.last_sent_at).getTime()) / 1000,
      )
      if (transcurrido < espera) {
        const faltan = Math.ceil((espera - transcurrido) / 60)
        return {
          ok: false as const,
          motivo: 'espera',
          detalle: `${MOTIVOS_RECHAZO.espera} Faltan ${faltan} min.`,
        }
      }
    }

    // ── 7. Crear el mensaje ──────────────────────────────────────────────
    const estado = mensaje.status ?? 'enviado'
    const consume = estado === 'enviado'
    const clave = consume
      ? claveIdempotente(mensaje.contactId, mensaje.sequenceStep ?? null, fecha)
      : null

    let messageId: string
    try {
      const creado = await tx.execute(sql`
        insert into messages (
          contact_id, account_id, channel, direction, body,
          template_id, template_variant, sequence_step,
          status, send_mode, external_id, pilot_id, idempotency_key,
          sent_at, opened_at
        ) values (
          ${mensaje.contactId}, ${params.accountId}, ${mensaje.channel}, 'out', ${mensaje.body},
          ${mensaje.templateId ?? null}, ${mensaje.templateVariant ?? null},
          ${mensaje.sequenceStep ?? null},
          ${estado}, ${mensaje.sendMode}, ${mensaje.externalId ?? null},
          ${mensaje.pilotId ?? null}, ${clave},
          ${consume ? ahora.toISOString() : null}, ${ahora.toISOString()}
        )
        returning id
      `)
      messageId = (creado.rows[0] as { id: string }).id
    } catch (err) {
      if (esViolacionDeUnico(err)) {
        return {
          ok: false as const,
          motivo: 'duplicado',
          detalle: MOTIVOS_RECHAZO.duplicado,
        }
      }
      throw err
    }

    // ── 8. Actualizar la caché y el último envío ─────────────────────────
    // Solo si el mensaje consume cupo: un chat abierto sin confirmar no cuenta
    // ni mueve la rotación.
    if (consume) {
      await tx.execute(sql`
        update messaging_accounts
           set sent_today = ${real + 1},
               counter_date = ${fecha},
               last_sent_at = ${ahora.toISOString()},
               consecutive_failures = 0,
               updated_at = now()
         where id = ${params.accountId}
      `)
      await tx.execute(sql`
        insert into events (type, contact_id, account_id, message_id, payload_jsonb)
        values ('envio_reservado', ${mensaje.contactId}, ${params.accountId}, ${messageId},
                ${JSON.stringify({ fecha, usado: real + 1, cupo, paso: mensaje.sequenceStep })}::jsonb)
      `)
    }

    return {
      ok: true as const,
      messageId,
      accountId: params.accountId,
      usadoHoy: consume ? real + 1 : real,
      cupo,
      correccion,
    }
  })
}

/**
 * Deshacer un envío.
 *
 * Sella `undone_at` en vez de borrar: el recuento de cupo excluye los deshechos,
 * así que el cupo se libera solo en el próximo envío. No hay decremento manual
 * que pueda quedar desincronizado.
 */
export async function deshacerEnvio(
  db: Db,
  messageId: string,
  actorUserId: string | null,
  ahora: Date = new Date(),
): Promise<{ ok: boolean; error?: string }> {
  return db.transaction(async (tx) => {
    const r = await tx.execute(sql`
      select id, account_id, contact_id, status, undone_at, sent_at
        from messages where id = ${messageId} for update
    `)
    const msg = r.rows[0] as
      | { id: string; account_id: string | null; contact_id: string; status: string; undone_at: Date | null }
      | undefined

    if (!msg) return { ok: false, error: 'Ese mensaje ya no existe.' }
    if (msg.undone_at) return { ok: false, error: 'Ese envío ya estaba deshecho.' }

    await tx.execute(sql`
      update messages set undone_at = ${ahora.toISOString()} where id = ${messageId}
    `)

    // Recalcular la caché de la cuenta desde la fuente de verdad.
    if (msg.account_id) {
      const { fecha, desde, hasta } = rangoDelDiaUtc(ahora)
      const c = await tx.execute(sql`
        select count(*)::int as n from messages
         where account_id = ${msg.account_id}
           and status in ('enviado', 'entregado', 'leido', 'respondido')
           and undone_at is null
           and sent_at >= ${desde.toISOString()} and sent_at < ${hasta.toISOString()}
      `)
      const real = (c.rows[0] as { n: number } | undefined)?.n ?? 0
      await tx.execute(sql`
        update messaging_accounts
           set sent_today = ${real}, counter_date = ${fecha}, updated_at = now()
         where id = ${msg.account_id}
      `)
    }

    await tx.execute(sql`
      insert into events (type, contact_id, account_id, message_id, actor_user_id)
      values ('envio_deshecho', ${msg.contact_id}, ${msg.account_id}, ${messageId}, ${actorUserId})
    `)

    return { ok: true }
  })
}

/** Drizzle envuelve los errores de pg: el código real viaja en `cause`. */
function esViolacionDeUnico(err: unknown): boolean {
  let actual = err as { code?: string; cause?: unknown } | undefined
  for (let i = 0; i < 5 && actual; i++) {
    if (actual.code === '23505') return true
    actual = actual.cause as { code?: string; cause?: unknown } | undefined
  }
  return false
}
