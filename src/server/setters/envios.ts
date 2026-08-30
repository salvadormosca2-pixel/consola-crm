import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db } from '@/db'
import type { SetterSendTipo } from '@/db/enums'
import { proximoSeguimiento, type PasoDeSeguimiento } from '@/lib/setters-config'
import { leerConfigSetters } from '@/server/setters/config'
import { opsDate } from '@/lib/tz'

/**
 * Registrar que un mensaje salió.
 *
 * Es el corazón del módulo y todo pasa en una sola transacción, en este orden:
 *
 *   1. Se traba la cuenta de Instagram (`for update`). Dos marcas simultáneas
 *      desde el mismo celular quedan en fila en vez de contar mal.
 *   2. Se **recuenta** el cupo del día desde `setter_sends`. Nunca se confía en
 *      el contador guardado.
 *   3. Si la cuenta llegó a su cupo, se rechaza. Acá no hay excepción posible:
 *      pasarse de 30 en una cuenta scrapeando en frío es perderla.
 *   4. Se registra el envío, se avanza el lead y se programa el segundo
 *      mensaje.
 *
 * El índice único `(assignment_id, tipo)` hace que reintentar sea gratis: la
 * marca que el celular guardó sin señal y sincronizó dos veces entra una sola.
 */

export type ResultadoEnvio =
  | {
      ok: true
      /** El envío ya estaba registrado: la marca llegó dos veces. */
      duplicado: boolean
      usadoHoy: number
      cupo: number
      restante: number
      sendId: string | null
      /** Cuándo le toca el segundo mensaje, si acaba de mandarse el primero. */
      segundoAt: Date | null
    }
  | { ok: false; motivo: 'cupo' | 'estado' | 'cuenta' | 'error'; detalle: string }

interface FilaCuenta {
  id: string
  setter_id: string
  cupo_diario: number
  activa: boolean
  ig_username: string
}

interface FilaAsignacion {
  id: string
  contact_id: string
  setter_id: string
  estado: string
  contactado_at: Date | null
  respondio_a: string | null
}

export async function registrarEnvio(
  params: {
    assignmentId: string
    setterId: string
    cuentaId: string
    /** Cuál de las cinco situaciones. 1 entrada, 2 oferta, 3-5 reenganches. */
    paso: PasoDeSeguimiento
    body: string
    templateId: string | null
    templateVariant: number | null
    actorUserId: string | null
  },
  /** Se inyecta en los tests de concurrencia, que corren contra otra base. */
  cliente: Db = db,
): Promise<ResultadoEnvio> {
  const cfg = await leerConfigSetters(cliente)
  const hoy = opsDate()

  try {
    return await cliente.transaction(async (tx) => {
      /* ── 1. Trabar la cuenta ───────────────────────────────────────── */
      const cuentas = await tx.execute(sql`
        select id, setter_id, cupo_diario, activa, ig_username
          from setter_accounts
         where id = ${params.cuentaId}::uuid
           for update
      `)
      const cuenta = cuentas.rows[0] as unknown as FilaCuenta | undefined

      if (!cuenta || cuenta.setter_id !== params.setterId) {
        return { ok: false as const, motivo: 'cuenta' as const, detalle: 'Esa cuenta no es tuya.' }
      }
      if (!cuenta.activa) {
        return {
          ok: false as const,
          motivo: 'cuenta' as const,
          detalle: `La cuenta @${cuenta.ig_username} está desactivada.`,
        }
      }

      /* ── 2. Recontar el cupo del día ───────────────────────────────── */
      const usados = await tx.execute(sql`
        select count(*)::int as n
          from setter_sends
         where setter_account_id = ${cuenta.id}::uuid
           and ops_date = ${hoy}::date
           and undone_at is null
      `)
      const usadoHoy = (usados.rows[0] as { n: number } | undefined)?.n ?? 0

      /* ── 3. Verificar el lead ──────────────────────────────────────── */
      const asignaciones = await tx.execute(sql`
        select id, contact_id, setter_id, estado, contactado_at, respondio_a
          from lead_assignments
         where id = ${params.assignmentId}::uuid
           for update
      `)
      const asignacion = asignaciones.rows[0] as unknown as FilaAsignacion | undefined

      if (!asignacion || asignacion.setter_id !== params.setterId) {
        return { ok: false as const, motivo: 'estado' as const, detalle: 'Ese lead ya no es tuyo.' }
      }

      /*
       * La entrada sale sobre un lead sin tocar. La oferta sale sobre uno
       * contactado —le toca por tiempo— o sobre uno que **acaba de contestar
       * la entrada**, que es el caso bueno: ahí la oferta va enseguida, y por
       * eso el estado es "respondido" y no "contactado".
       *
       * Los reenganches salen sobre leads ya trabajados: ahí lo que manda no
       * es el estado sino que el paso sea el que tenía programado, y eso lo
       * garantiza el índice único por paso unos renglones más abajo.
       */
      const contestoLaEntrada = asignacion.respondio_a === 'primero'
      const esperado =
        params.paso === 1
          ? ['asignado', 'abierto', 'saltado']
          : params.paso === 2
            ? contestoLaEntrada
              ? ['contactado', 'respondido']
              : ['contactado']
            : /*
               * Los reenganches y los tres que salen por marca del setter caen
               * todos acá: sobre un lead ya trabajado. Lo que manda no es el
               * estado sino que el paso sea el que tenía programado.
               */
              ['contactado', 'segundo_enviado', 'respondido']

      if (!esperado.includes(asignacion.estado)) {
        /*
         * Puede ser un reintento de una marca vieja. Si el envío ya está
         * registrado, se responde ok: la app tiene que poder vaciar su cola
         * offline sin quedarse trabada en un error que no puede resolver.
         */
        const previos = await tx.execute(sql`
          select id from setter_sends
           where assignment_id = ${params.assignmentId}::uuid
             and paso = ${params.paso}
             and undone_at is null
           limit 1
        `)
        if (previos.rows.length > 0) {
          return {
            ok: true as const,
            duplicado: true,
            usadoHoy,
            cupo: cuenta.cupo_diario,
            restante: Math.max(cuenta.cupo_diario - usadoHoy, 0),
            sendId: (previos.rows[0] as { id: string }).id,
            segundoAt: null,
          }
        }
        return {
          ok: false as const,
          motivo: 'estado' as const,
          detalle:
            params.paso === 1
              ? 'Ese lead ya está contactado.'
              : 'Ese lead ya no espera ese mensaje.',
        }
      }

      // El cupo se verifica DESPUÉS de descartar el duplicado: una marca
      // repetida no puede rebotar por cupo, porque no consume nada nuevo.
      if (usadoHoy >= cuenta.cupo_diario) {
        return {
          ok: false as const,
          motivo: 'cupo' as const,
          detalle: `La cuenta @${cuenta.ig_username} llegó a su límite de ${cuenta.cupo_diario} de hoy.`,
        }
      }

      /* ── 4. Registrar ──────────────────────────────────────────────── */
      const ahora = new Date()
      const paso = params.paso
      // `tipo` se conserva para los contadores de seguimientos y la línea de
      // tiempo: la entrada es el paso 1, todo lo demás es seguimiento.
      const tipo: SetterSendTipo = paso === 1 ? 'primero' : 'segundo'

      const mensajes = await tx.execute(sql`
        insert into messages (contact_id, account_id, channel, direction, body, template_id,
                              template_variant, sequence_step, status, send_mode,
                              idempotency_key, sent_at)
        values (${asignacion.contact_id}::uuid, null, 'instagram', 'out', ${params.body},
                ${params.templateId}::uuid, ${params.templateVariant}, ${paso},
                'enviado', 'manual',
                ${`setter:${params.assignmentId}:${paso}`}, ${ahora.toISOString()}::timestamptz)
        on conflict do nothing
        returning id
      `)
      const messageId = (mensajes.rows[0] as { id: string } | undefined)?.id ?? null

      const envios = await tx.execute(sql`
        insert into setter_sends (assignment_id, setter_id, setter_account_id, contact_id,
                                  tipo, paso, ops_date, sent_at, message_id)
        values (${params.assignmentId}::uuid, ${params.setterId}::uuid, ${cuenta.id}::uuid,
                ${asignacion.contact_id}::uuid, ${tipo}, ${paso}, ${hoy}::date,
                ${ahora.toISOString()}::timestamptz, ${messageId}::uuid)
        on conflict do nothing
        returning id
      `)

      const sendId = (envios.rows[0] as { id: string } | undefined)?.id ?? null
      if (sendId === null) {
        // El índice único absorbió un reintento. No se consumió cupo de nuevo.
        return {
          ok: true as const,
          duplicado: true,
          usadoHoy,
          cupo: cuenta.cupo_diario,
          restante: Math.max(cuenta.cupo_diario - usadoHoy, 0),
          sendId: null,
          segundoAt: null,
        }
      }

      /*
       * Qué le toca después. La cadena decide sola, y adónde va depende de si
       * el lead alguna vez habló: el que nunca dijo nada termina en el último
       * intento, y el que contestó sigue hasta el último reenganche. Las tres
       * situaciones que salen por marca del setter (le interesa, no le
       * interesa, agendó reunión) no se encadenan desde acá: las programa la
       * acción que las marca.
       */
      const siguiente = proximoSeguimiento(cfg, paso, ahora, asignacion.respondio_a !== null)
      const segundoAt = siguiente?.paso === 2 ? siguiente.cuando : null

      if (paso === 1) {
        await tx.execute(sql`
          update lead_assignments
             set estado = 'contactado',
                 contactado_at = ${ahora.toISOString()}::timestamptz,
                 setter_account_id = ${cuenta.id}::uuid,
                 segundo_programado_at = ${siguiente!.cuando.toISOString()}::timestamptz,
                 proximo_paso = ${siguiente!.paso},
                 proximo_seguimiento_at = ${siguiente!.cuando.toISOString()}::timestamptz,
                 pospuesto_at = null
           where id = ${params.assignmentId}::uuid
        `)
      } else if (paso === 2) {
        await tx.execute(sql`
          update lead_assignments
             set estado = 'segundo_enviado',
                 segundo_mensaje_at = ${ahora.toISOString()}::timestamptz,
                 segundo_programado_at = null,
                 proximo_paso = ${siguiente?.paso ?? null},
                 proximo_seguimiento_at = ${siguiente?.cuando.toISOString() ?? null}::timestamptz,
                 pospuesto_at = null
           where id = ${params.assignmentId}::uuid
        `)
      } else {
        /*
         * Un reenganche no cambia el estado del lead: seguía siendo "respondió"
         * o "segundo enviado" antes y lo sigue siendo. Lo único que cambia es
         * qué le toca después, y eso lo decide la cadena: al reenganche le
         * sigue el último de todos, al "le interesa" le sigue su reenganche por
         * si se enfría, y a los demás no les sigue nada.
         */
        await tx.execute(sql`
          update lead_assignments
             set proximo_paso = ${siguiente?.paso ?? null},
                 proximo_seguimiento_at = ${siguiente?.cuando.toISOString() ?? null}::timestamptz,
                 pospuesto_at = null
           where id = ${params.assignmentId}::uuid
        `)
      }

      /*
       * El contacto queda con el nombre del setter (es la base de la comisión)
       * y sin `next_followup_at`: la secuencia de este lead la maneja su cola,
       * no el Despachador. Si quedara programado, aparecería en las dos.
       */
      await tx.execute(sql`
        update contacts
           set stage = case when stage in ('nuevo', 'encolado') then 'contactado'::contact_stage
                            else stage end,
               setter_id = ${params.setterId}::uuid,
               sent_count = sent_count + 1,
               sequence_step = ${paso},
               last_outbound_at = ${ahora.toISOString()}::timestamptz,
               next_followup_at = null,
               updated_at = now()
         where id = ${asignacion.contact_id}::uuid
      `)

      // Caché de presentación del panel. La autoridad sigue siendo el recuento.
      await tx.execute(sql`
        update setter_accounts
           set enviados_hoy = ${usadoHoy + 1},
               contador_fecha = ${hoy}::date,
               ultimo_envio_at = ${ahora.toISOString()}::timestamptz
         where id = ${cuenta.id}::uuid
      `)

      await tx.execute(sql`
        insert into events (type, contact_id, message_id, actor_user_id, payload_jsonb)
        values (${paso === 1 ? 'lead_contactado' : 'lead_segundo_enviado'},
                ${asignacion.contact_id}::uuid, ${messageId}::uuid, ${params.actorUserId}::uuid,
                ${JSON.stringify({
                  setterId: params.setterId,
                  cuenta: cuenta.ig_username,
                  usadoHoy: usadoHoy + 1,
                  cupo: cuenta.cupo_diario,
                })}::jsonb)
      `)

      return {
        ok: true as const,
        duplicado: false,
        usadoHoy: usadoHoy + 1,
        cupo: cuenta.cupo_diario,
        restante: Math.max(cuenta.cupo_diario - usadoHoy - 1, 0),
        sendId,
        segundoAt,
      }
    })
  } catch (err) {
    console.error('Error al registrar el envío del setter:', err)
    return {
      ok: false,
      motivo: 'error',
      detalle: 'No se pudo registrar. Nada quedó a medias: probá de nuevo.',
    }
  }
}

/**
 * Deshace la última marca.
 *
 * Sella `undone_at` en vez de borrar, así el cupo se libera solo —el recuento
 * excluye los deshechos— sin decrementar ningún contador a mano. Es la red de
 * seguridad del botón grande en una pantalla chica: marcar sin querer pasa.
 */
export async function deshacerEnvio(
  sendId: string,
  setterId: string,
  actorUserId: string | null,
  cliente: Db = db,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await leerConfigSetters(cliente)

  try {
    return await cliente.transaction(async (tx) => {
      const filas = await tx.execute(sql`
        update setter_sends
           set undone_at = now()
         where id = ${sendId}::uuid
           and setter_id = ${setterId}::uuid
           and undone_at is null
        returning assignment_id, contact_id, paso, message_id, setter_account_id
      `)

      const envio = filas.rows[0] as
        | {
            assignment_id: string
            contact_id: string
            paso: number
            message_id: string | null
            setter_account_id: string
          }
        | undefined

      if (!envio) return { ok: false, error: 'Esa marca ya no se puede deshacer.' }

      if (envio.message_id) {
        await tx.execute(sql`
          update messages set undone_at = now() where id = ${envio.message_id}::uuid
        `)
      }

      if (envio.paso === 1) {
        await tx.execute(sql`
          update lead_assignments
             set estado = 'abierto', contactado_at = null, segundo_programado_at = null,
                 proximo_paso = null, proximo_seguimiento_at = null
           where id = ${envio.assignment_id}::uuid
        `)
        await tx.execute(sql`
          update contacts
             set sent_count = greatest(sent_count - 1, 0),
                 sequence_step = greatest(sequence_step - 1, 0),
                 stage = case when greatest(sent_count - 1, 0) = 0 then 'nuevo'::contact_stage
                              else stage end,
                 setter_id = case when greatest(sent_count - 1, 0) = 0 then null
                                  else setter_id end,
                 updated_at = now()
           where id = ${envio.contact_id}::uuid
        `)
      } else if (envio.paso === 2) {
        /*
         * Al deshacer la oferta el lead vuelve a esperarla, pero desde dónde
         * depende de por qué le tocaba. Al que nunca contestó se le recalcula
         * la fecha desde su primer mensaje; al que había contestado la entrada
         * le vuelve a tocar ya mismo, porque su oferta nunca fue una espera.
         */
        await tx.execute(sql`
          update lead_assignments
             set estado = case when respondio_a is not null then 'respondido'::lead_assignment_estado
                               else 'contactado'::lead_assignment_estado end,
                 segundo_mensaje_at = null,
                 proximo_paso = 2,
                 segundo_programado_at = case when respondio_a is null
                   then coalesce(contactado_at, now()) + ${`${cfg.horasSegundoMensaje} hours`}::interval
                   end,
                 proximo_seguimiento_at = case when respondio_a is null
                   then coalesce(contactado_at, now()) + ${`${cfg.horasSegundoMensaje} hours`}::interval
                   else now() end
           where id = ${envio.assignment_id}::uuid
        `)
        await tx.execute(sql`
          update contacts
             set sent_count = greatest(sent_count - 1, 0),
                 sequence_step = greatest(sequence_step - 1, 0),
                 updated_at = now()
           where id = ${envio.contact_id}::uuid
        `)
      } else {
        // Un reenganche deshecho vuelve a quedar pendiente: si se marcó sin
        // querer, el lead no puede perder su último intento por eso.
        await tx.execute(sql`
          update lead_assignments
             set proximo_paso = ${envio.paso}, proximo_seguimiento_at = now()
           where id = ${envio.assignment_id}::uuid
        `)
        await tx.execute(sql`
          update contacts
             set sent_count = greatest(sent_count - 1, 0), updated_at = now()
           where id = ${envio.contact_id}::uuid
        `)
      }

      await tx.execute(sql`
        update setter_accounts
           set enviados_hoy = greatest(enviados_hoy - 1, 0)
         where id = ${envio.setter_account_id}::uuid
      `)

      await tx.execute(sql`
        insert into events (type, contact_id, actor_user_id, payload_jsonb)
        values ('envio_setter_deshecho', ${envio.contact_id}::uuid, ${actorUserId}::uuid,
                ${JSON.stringify({ paso: envio.paso })}::jsonb)
      `)

      return { ok: true }
    })
  } catch (err) {
    console.error('Error al deshacer el envío del setter:', err)
    return { ok: false, error: 'No se pudo deshacer.' }
  }
}
