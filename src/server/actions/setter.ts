'use server'

import { sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db } from '@/db'

import type { EstadoAccion } from '@/lib/form-state'
import { cuantosEntregar } from '@/lib/setters-cupo'
import {
  mensajeDeReunion,
  ofertaTrasLaRespuesta,
  trasClasificar,
  type DestinoDeClasificacion,
} from '@/lib/setters-config'
import { OPS_TZ } from '@/lib/tz'
import { borrarSuscripcion, guardarSuscripcion } from '@/server/push'
import { ErrorDePermiso, exigirSesion, exigirSetter } from '@/server/session'
import { asignarLeads, contarPozo } from '@/server/setters/asignacion'
import { leerConfigSetters } from '@/server/setters/config'
import { leerCupoDeSetter } from '@/server/setters/cupo'
import { agregarLeadPropio } from '@/server/setters/leads'
import { deshacerEnvio, registrarEnvio } from '@/server/setters/envios'
import { notificarYAvisar } from '@/server/setters/notificaciones'
import { linksDeInstagram, mensajeDeAsignacion } from '@/server/setters/plantillas'

/**
 * Todo lo que puede hacer un setter.
 *
 * Cada acción vuelve a pedir la sesión y verifica que el lead sea suyo: el
 * permiso se controla acá, en el servidor, no escondiendo botones. Un setter
 * que descubre el nombre de una acción y la llama con el id de un lead ajeno
 * recibe el mismo "no es tuyo" que si editara la URL.
 */

function alFallar(err: unknown, generico: string): EstadoAccion {
  if (err instanceof ErrorDePermiso) return { ok: false, error: err.message }
  console.error(generico, err)
  return { ok: false, error: generico }
}

function refrescar(): void {
  revalidatePath('/hoy')
  revalidatePath('/mis-leads')
}

/* ── Un lead propio ───────────────────────────────────────────────────── */

const miLeadSchema = z.object({
  instagram: z.string().trim().min(1, 'Poné la cuenta de Instagram.').max(60),
  negocio: z.string().trim().min(2, 'Poné el nombre del negocio.').max(120),
  ciudad: z.string().trim().max(80).optional(),
  nota: z.string().trim().max(300).optional(),
})

/**
 * El setter agrega a alguien que conoce.
 *
 * Entra a su cola como cualquier otro lead y con el mismo guion. Lo único que
 * cambia es de dónde salió: no del pozo, sino de él.
 */
export async function agregarMiLead(datos: unknown): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()
    const parsed = miLeadSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
    }

    const r = await agregarLeadPropio(sesion.setterId, parsed.data, sesion.userId)
    if (!r.ok) return { ok: false, error: r.error }

    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo agregar el lead.')
  }
}

/* ── La cola ──────────────────────────────────────────────────────────── */

/**
 * Queda registrado que abrió el chat de este lead.
 *
 * `abierto_at` no es "se abrió alguna vez": es **se abrió desde el último
 * mensaje que salió**. Cada envío lo vuelve a poner en null, así que el candado
 * del botón "Enviado" se rearma paso por paso.
 *
 * Antes se sellaba una sola vez con un `coalesce` y no se limpiaba nunca, así
 * que a partir de la oferta el botón ya venía habilitado sin haber abierto
 * nada: el candado solo servía en la entrada, que es justo donde menos falta
 * hace: en un seguimiento el pulgar ya conoce la pantalla y marca de memoria.
 */
export async function abrirChat(assignmentId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()
    await db.execute(sql`
      update lead_assignments
         set estado = case when estado = 'asignado' or estado = 'saltado' then 'abierto'::lead_assignment_estado
                           else estado end,
             abierto_at = coalesce(abierto_at, now())
       where id = ${assignmentId}::uuid and setter_id = ${sesion.setterId}::uuid
    `)
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('lead_abierto', ${sesion.userId}::uuid, ${JSON.stringify({ assignmentId })}::jsonb)
    `)
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo registrar que abriste el chat.')
  }
}

export interface ResultadoMarca extends EstadoAccion {
  usadoHoy?: number
  cupo?: number
  restante?: number
  sendId?: string | null
  /** La marca ya estaba registrada: la app puede vaciar su cola sin reintentar. */
  duplicado?: boolean
  /** La cuenta llegó al tope: hay que confirmar el cambio antes de seguir. */
  requiereCambioDeCuenta?: boolean
}

/**
 * Marca que el mensaje salió.
 *
 * El cuerpo y la cuenta los decide el servidor: el celular solo dice qué lead.
 * Así una app vieja en un teléfono no puede mandar un guion viejo ni imputarle
 * el envío a una cuenta que ya llegó a su cupo.
 */
export async function marcarEnviado(assignmentId: string): Promise<ResultadoMarca> {
  try {
    const sesion = await exigirSetter()

    const cupo = await leerCupoDeSetter(sesion.setterId)

    /*
     * De qué cuenta sale.
     *
     * Un seguimiento **tiene que salir de la cuenta que abrió esa
     * conversación**: en Instagram el hilo vive ahí, y mandarlo desde otra es
     * escribirle de cero a alguien que ya te conoce. Así que la cuenta la
     * decide el lead, no cuál tenga activa el setter en ese momento.
     *
     * Los leads sin contactar sí salen de la activa: todavía no tienen hilo.
     */
    const previa = await db.execute(sql`
      select setter_account_id from lead_assignments
       where id = ${assignmentId}::uuid and setter_id = ${sesion.setterId}::uuid
       limit 1
    `)
    const cuentaDelLead = (previa.rows[0] as { setter_account_id: string | null } | undefined)
      ?.setter_account_id

    const cuenta = cuentaDelLead
      ? (cupo.cuentas.find((c) => c.id === cuentaDelLead) ?? null)
      : cupo.activa

    if (!cuenta) {
      return { ok: false, error: 'La cuenta con la que le escribiste ya no está disponible.' }
    }

    /*
     * El cupo se mira sobre **esa** cuenta. Si es la del hilo y llegó a su
     * tope, el seguimiento espera a mañana: cambiar de cuenta no ayuda, porque
     * la conversación no se mudó.
     */
    if (cuenta.restante <= 0) {
      return {
        ok: false,
        error: cuentaDelLead
          ? `@${cuenta.igUsername} llegó a su límite de hoy y este lead vive en esa conversación. Sigue mañana.`
          : `Llegaste al límite de hoy con @${cuenta.igUsername}. Cambiá de cuenta para seguir.`,
        requiereCambioDeCuenta: !cuentaDelLead,
      }
    }

    // El bloqueo por cambio solo aplica a los leads nuevos: son los únicos que
    // dependen de cuál cuenta esté activa.
    if (!cuentaDelLead && cupo.bloqueadoPorCambio) {
      return {
        ok: false,
        error: `Llegaste al límite de hoy con @${cupo.activa?.igUsername}. Cambiá de cuenta para seguir.`,
        requiereCambioDeCuenta: true,
      }
    }

    const mensaje = await mensajeDeAsignacion(assignmentId, sesion.setterId)
    if (!mensaje.ok) return { ok: false, error: mensaje.motivo }

    const r = await registrarEnvio({
      assignmentId,
      setterId: sesion.setterId,
      cuentaId: cuenta.id,
      paso: mensaje.paso,
      body: mensaje.texto,
      templateId: mensaje.templateId,
      templateVariant: mensaje.variante,
      actorUserId: sesion.userId,
    })

    if (!r.ok) {
      return {
        ok: false,
        error: r.detalle,
        requiereCambioDeCuenta: r.motivo === 'cupo',
      }
    }

    refrescar()
    return {
      ok: true,
      error: null,
      usadoHoy: r.usadoHoy,
      cupo: r.cupo,
      restante: r.restante,
      sendId: r.sendId,
      duplicado: r.duplicado,
    }
  } catch (err) {
    return alFallar(err, 'No se pudo registrar el envío.')
  }
}

/** Lo deja para el final de la cola de hoy. Mañana vuelve como cualquier otro. */
export async function saltearLead(assignmentId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()
    await db.execute(sql`
      update lead_assignments
         set estado = 'saltado', pospuesto_at = now()
       where id = ${assignmentId}::uuid and setter_id = ${sesion.setterId}::uuid
         and estado in ('asignado', 'abierto', 'saltado')
    `)
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('lead_salteado', ${sesion.userId}::uuid, ${JSON.stringify({ assignmentId })}::jsonb)
    `)
    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo saltear.')
  }
}

/**
 * El perfil no existe o está caído.
 *
 * Lo saca de circulación y lo manda a la pestaña de revisión del admin. Es
 * información valiosa, no un descarte: la lista scrapeada tiene basura y esto
 * es lo único que la identifica.
 */
export async function marcarCuentaInexistente(assignmentId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()

    const filas = await db.execute(sql`
      update lead_assignments
         set estado = 'cuenta_inexistente', devuelto_at = now(),
             devuelto_motivo = 'El perfil de Instagram no existe.'
       where id = ${assignmentId}::uuid and setter_id = ${sesion.setterId}::uuid
         and estado in ('asignado', 'abierto', 'saltado')
      returning contact_id
    `)

    const contactId = (filas.rows[0] as { contact_id: string } | undefined)?.contact_id
    if (!contactId) return { ok: false, error: 'Ese lead ya no está en tu cola.' }

    // Se saca del pozo para que no se lo lleve otro setter mañana.
    await db.execute(sql`
      update contacts
         set stage = 'descartado', discarded_at = now(), updated_at = now()
       where id = ${contactId}::uuid
    `)

    await db.execute(sql`
      insert into events (type, contact_id, actor_user_id, payload_jsonb)
      values ('lead_cuenta_inexistente', ${contactId}::uuid, ${sesion.userId}::uuid, '{}'::jsonb)
    `)

    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo marcar la cuenta como inexistente.')
  }
}

/** Deshace la última marca. El cupo se libera solo. */
export async function deshacerMarca(sendId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()
    const r = await deshacerEnvio(sendId, sesion.setterId, sesion.userId)
    if (!r.ok) return { ok: false, error: r.error ?? 'No se pudo deshacer.' }
    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo deshacer.')
  }
}

export interface MensajeListo extends EstadoAccion {
  texto?: string
  linkDirecto?: string
  igUsername?: string
  /** Cuál de las cinco situaciones salió elegida. Sirve para titular la hoja. */
  paso?: number
}

/**
 * El mensaje que le toca a un lead, armado y listo para copiar.
 *
 * Existe para poder mandar desde "Mis leads" sin pasar por la cola del día: el
 * caso que importa es el lead que acaba de contestar la entrada y necesita la
 * oferta **ahora**, no mañana cuando le toque en la cola.
 *
 * Igual que en la cola, el texto lo decide el servidor con lo que el admin
 * escribió para ese rubro. Acá no se inventa nada.
 */
export async function verMensajePreparado(assignmentId: string): Promise<MensajeListo> {
  try {
    const sesion = await exigirSetter()

    const filas = await db.execute(sql`
      select c.ig_username
        from lead_assignments la
        join contacts c on c.id = la.contact_id
       where la.id = ${assignmentId}::uuid and la.setter_id = ${sesion.setterId}::uuid
       limit 1
    `)
    const fila = filas.rows[0] as { ig_username: string } | undefined
    if (!fila) return { ok: false, error: 'Ese lead ya no es tuyo.' }

    const mensaje = await mensajeDeAsignacion(assignmentId, sesion.setterId)
    if (!mensaje.ok) return { ok: false, error: mensaje.motivo }

    return {
      ok: true,
      error: null,
      texto: mensaje.texto,
      paso: mensaje.paso,
      igUsername: fila.ig_username,
      ...linksDeInstagram(fila.ig_username),
    }
  } catch (err) {
    return alFallar(err, 'No se pudo preparar el mensaje.')
  }
}

/* ── Respondió y reunión ──────────────────────────────────────────────── */

const respuestaSchema = z.object({
  nota: z.string().trim().max(500).optional(),
  /**
   * Solo se usa si el lead ya recibió la oferta.
   *
   * Son tres y no dos: entre el sí y el no está el que contestó con una duda,
   * que es el que más se pierde. Tratarlo como un no lo cierra para siempre.
   */
  interes: z.enum(['interesa', 'no_interesa', 'tibio']).optional(),
})

/** De lo que marca el setter a la pista por la que sigue el lead. */
const DESTINO_DEL_INTERES: Record<'interesa' | 'no_interesa' | 'tibio', DestinoDeClasificacion> = {
  interesa: 'interesado',
  no_interesa: 'no_interesa',
  tibio: 'tibio',
}

/**
 * El lead contestó. Hay dos versiones y no significan lo mismo.
 *
 *   · Contestó el **primer** mensaje: abrió conversación y todavía no sabe a
 *     qué nos dedicamos. Lo único que importa es que contestó —lo que haya
 *     dicho es un "hola"— así que **no se le pide nada escrito al setter**.
 *     Hacerlo escribir ahí es fricción por nada, y lo que se escribe por
 *     obligación no se lee nunca.
 *   · Contestó el **segundo**, que es el que lleva la oferta: ya sabe qué le
 *     estamos ofreciendo y está diciendo que sí o que no. Acá **la nota es
 *     obligatoria**: qué dijo exactamente es lo que decide cómo se sigue, y es
 *     lo único que queda escrito de esa conversación cuando yo la retomo.
 *
 * A cuál contestó **lo decide el servidor** mirando el estado, no el celular:
 * es el único que sabe con certeza qué mensajes salieron.
 */
export async function marcarRespondio(
  assignmentId: string,
  datos?: { nota?: string; interes?: string },
): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSesion()
    const parsed = respuestaSchema.safeParse(datos ?? {})
    if (!parsed.success) return { ok: false, error: 'Revisá los datos.' }
    // Zod recorta pero no descarta: una nota de solo espacios llega como ''.
    const texto = parsed.data.nota && parsed.data.nota.length > 0 ? parsed.data.nota : null

    const propio = sesion.rol === 'setter'

    const previas = await db.execute(sql`
      select estado, contact_id, setter_id from lead_assignments
       where id = ${assignmentId}::uuid
         ${propio ? sql`and setter_id = ${sesion.setterId}::uuid` : sql``}
       limit 1
    `)
    const previa = previas.rows[0] as
      | { estado: string; contact_id: string; setter_id: string }
      | undefined

    if (!previa) return { ok: false, error: 'Ese lead no es tuyo.' }
    if (!['asignado', 'abierto', 'saltado', 'contactado', 'segundo_enviado'].includes(previa.estado)) {
      return { ok: false, error: 'Ese lead ya está marcado.' }
    }

    const yaVioLaOferta = previa.estado === 'segundo_enviado'
    const respondioA = yaVioLaOferta ? 'segundo' : 'primero'
    const interes = yaVioLaOferta ? (parsed.data.interes ?? 'interesa') : null

    if (yaVioLaOferta && !parsed.data.interes) {
      return { ok: false, error: 'Decime si le interesa, si no, o si quedó tibio.' }
    }

    /*
     * La nota es obligatoria solo acá. Cuando contestan la oferta, lo que
     * dijeron es la información: decide si se le insiste, si se le baja el
     * precio o si se cierra. Un "le interesa" pelado no le sirve a nadie.
     *
     * Se valida en el servidor y no solo en la pantalla porque es una regla
     * del negocio, no una comodidad del formulario.
     */
    if (yaVioLaOferta && texto === null) {
      return { ok: false, error: 'Escribí qué dijo: es lo que necesito para seguirlo.' }
    }

    /*
     * Contestar no es el final: es donde el lead pasa a lo que sigue.
     *
     *   · contestó la entrada → la oferta, que es de lo que todavía no se
     *     enteró, y sale **ya**: si contestó está mirando el celular ahora.
     *   · contestó la oferta → adónde va lo decide lo que se marcó, y son tres
     *     destinos distintos: el sí arranca el mensaje que lleva a una fecha, el
     *     no arranca el cierre cordial, y el tibio entra a su pista de cuatro
     *     escalones. Los dos primeros salen en el acto; el tibio espera su día.
     *
     * Marcar la respuesta a la oferta **es** clasificarla, así que el lead no
     * pasa por la cola: la decisión ya está tomada y queda sellada acá.
     */
    const cfg = await leerConfigSetters()
    const siguiente =
      respondioA === 'primero'
        ? ofertaTrasLaRespuesta()
        : trasClasificar(cfg, DESTINO_DEL_INTERES[interes ?? 'interesa'])

    const filas = await db.execute(sql`
      update lead_assignments
         set estado = 'respondido', respondido_at = now(), segundo_programado_at = null,
             respondio_a = ${respondioA}::setter_send_tipo,
             interes = ${interes}::lead_interes,
             clasificado_at = ${yaVioLaOferta ? sql`now()` : sql`null`},
             clasificado_por = ${yaVioLaOferta ? sql`${sesion.userId}::uuid` : sql`null`},
             proximo_paso = ${siguiente?.paso ?? null},
             proximo_seguimiento_at = ${siguiente?.cuando.toISOString() ?? null}::timestamptz,
             nota = coalesce(${texto}, nota),
             marcado_por = ${propio ? null : sesion.userId}::uuid
       where id = ${assignmentId}::uuid
      returning contact_id, setter_id
    `)

    const fila = filas.rows[0] as { contact_id: string; setter_id: string } | undefined
    if (!fila) return { ok: false, error: 'Ese lead ya no está en tu cola.' }

    /*
     * Un "no me interesa" es un no de verdad: el contacto se da por perdido y
     * no aparece en mi cola de trabajo. Los otros dos casos van a la bandeja
     * como 'respondido', que es donde los clasifico como siempre.
     */
    const etapa = interes === 'no_interesa' ? 'perdido' : 'respondido'

    await db.execute(sql`
      update contacts
         set stage = ${etapa}::contact_stage,
             received_count = greatest(received_count, 1),
             last_inbound_at = now(),
             first_replied_at = coalesce(first_replied_at, now()),
             next_followup_at = null,
             setter_id = coalesce(setter_id, ${fila.setter_id}::uuid),
             updated_at = now()
       where id = ${fila.contact_id}::uuid
    `)

    await db.execute(sql`
      insert into events (type, contact_id, actor_user_id, payload_jsonb)
      values ('lead_respondio', ${fila.contact_id}::uuid, ${sesion.userId}::uuid,
              ${JSON.stringify({ porElAdmin: !propio, nota: texto, respondioA, interes })}::jsonb)
    `)

    const info = await db.execute(sql`
      select c.business_name, u.name as setter
        from contacts c
        left join setters s on s.id = ${fila.setter_id}::uuid
        left join users u on u.id = s.user_id
       where c.id = ${fila.contact_id}::uuid
    `)
    const d = info.rows[0] as { business_name: string; setter: string | null } | undefined
    const quien = d?.setter ?? 'Un setter'
    const negocio = d?.business_name ?? 'un lead'
    const cola = texto ? ` · "${texto}"` : ''

    await notificarYAvisar(
      {
        tipo: 'respondio',
        texto:
          respondioA === 'primero'
            ? `${quien}: ${negocio} contestó el primer mensaje${cola}`
            : interes === 'interesa'
              ? `${quien}: a ${negocio} LE INTERESA la oferta${cola}`
              : `${quien}: ${negocio} vio la oferta y no le interesa${cola}`,
        enlace: interes === 'no_interesa' ? '/equipo/leads?ver=oferta' : '/respondieron',
        setterId: fila.setter_id,
        contactId: fila.contact_id,
      },
      respondioA === 'primero'
        ? 'Contestó el primer mensaje'
        : interes === 'interesa'
          ? 'Le interesa la oferta'
          : 'Respuesta a la oferta',
    )

    refrescar()
    revalidatePath('/respondieron')
    revalidatePath('/equipo')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo marcar la respuesta.')
  }
}

const reunionSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elegí una fecha.'),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Elegí una hora.'),
  tipo: z.enum(['llamada', 'videollamada', 'presencial']).default('llamada'),
  nota: z.string().trim().max(500).optional(),
})

/**
 * El lead agendó una reunión.
 *
 * Usa la tabla `meetings` que ya existe, con el setter que la consiguió. El
 * setter la ve en su pestaña pero no la maneja: a partir de acá es mía.
 */
export async function agendarReunion(
  assignmentId: string,
  datos: { fecha: string; hora: string; tipo?: string; nota?: string },
): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSesion()
    const parsed = reunionSchema.safeParse(datos)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá la fecha y la hora.' }
    }

    const propio = sesion.rol === 'setter'
    const filas = await db.execute(sql`
      select la.contact_id, la.setter_id, la.estado, c.business_name
        from lead_assignments la
        join contacts c on c.id = la.contact_id
       where la.id = ${assignmentId}::uuid
         ${propio ? sql`and la.setter_id = ${sesion.setterId}::uuid` : sql``}
       limit 1
    `)

    const fila = filas.rows[0] as
      | { contact_id: string; setter_id: string; estado: string; business_name: string }
      | undefined
    if (!fila) return { ok: false, error: 'Ese lead no es tuyo.' }

    // Quien acepta una reunión después de ver la oferta está diciendo que sí.
    const vioLaOferta = fila.estado === 'segundo_enviado'

    /*
     * La fecha y la hora se escriben en la zona de operación, no en la del
     * celular: si el setter viaja, la reunión no tiene que moverse sola.
     */
    const cuando = `${parsed.data.fecha} ${parsed.data.hora}`

    // La confirmación por escrito, que sale apenas queda agendada.
    const reunionAlLead = mensajeDeReunion()

    const reuniones = await db.execute(sql`
      insert into meetings (contact_id, scheduled_at, type, notes, setter_id)
      values (${fila.contact_id}::uuid,
              (${cuando}::timestamp at time zone ${OPS_TZ}),
              ${parsed.data.tipo}::meeting_type,
              ${parsed.data.nota ?? null},
              ${fila.setter_id}::uuid)
      returning id, scheduled_at
    `)
    const reunion = reuniones.rows[0] as { id: string; scheduled_at: Date }

    await db.execute(sql`
      update lead_assignments
         set estado = 'respondido',
             respondido_at = coalesce(respondido_at, now()),
             segundo_programado_at = null,
             respondio_a = coalesce(respondio_a,
                                    ${vioLaOferta ? 'segundo' : 'primero'}::setter_send_tipo),
             interes = case when ${vioLaOferta} then coalesce(interes, 'interesa'::lead_interes)
                            else interes end,
             /*
              * Agendar **es** clasificar, y la más alta que hay. Sin esto el
              * lead quedaba figurando en la cola de clasificación como si nadie
              * hubiera decidido nada, con la reunión ya cargada: el mejor
              * resultado posible, contado como trabajo pendiente y sumando
              * atraso al SLA.
              */
             clasificado_at = coalesce(clasificado_at, now()),
             clasificado_por = coalesce(clasificado_por, ${sesion.userId}::uuid),
             /*
              * Agendar no corta la conversación: la confirma. Antes esto ponía
              * el próximo paso en null y la reunión quedaba de palabra en un
              * chat de Instagram, que es a lo que no se presenta nadie.
              */
             proximo_paso = ${reunionAlLead.paso},
             proximo_seguimiento_at = ${reunionAlLead.cuando.toISOString()}::timestamptz,
             marcado_por = ${propio ? null : sesion.userId}::uuid
       where id = ${assignmentId}::uuid
    `)

    await db.execute(sql`
      update contacts
         set stage = 'reunion_agendada',
             received_count = greatest(received_count, 1),
             first_replied_at = coalesce(first_replied_at, now()),
             next_followup_at = null,
             setter_id = coalesce(setter_id, ${fila.setter_id}::uuid),
             updated_at = now()
       where id = ${fila.contact_id}::uuid
    `)

    await db.execute(sql`
      insert into events (type, contact_id, actor_user_id, payload_jsonb)
      values ('reunion_agendada', ${fila.contact_id}::uuid, ${sesion.userId}::uuid,
              ${JSON.stringify({ cuando, tipo: parsed.data.tipo })}::jsonb)
    `)

    const nombres = await db.execute(sql`
      select u.name from setters s join users u on u.id = s.user_id
       where s.id = ${fila.setter_id}::uuid
    `)
    const setter = (nombres.rows[0] as { name: string } | undefined)?.name ?? 'Un setter'

    const formateada = new Intl.DateTimeFormat('es-AR', {
      timeZone: OPS_TZ,
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(reunion.scheduled_at))

    await notificarYAvisar(
      {
        tipo: 'reunion_agendada',
        texto: `${setter} agendó reunión con ${fila.business_name} para el ${formateada}`,
        enlace: '/reuniones',
        setterId: fila.setter_id,
        contactId: fila.contact_id,
        meetingId: reunion.id,
      },
      'Reunión agendada',
    )

    refrescar()
    revalidatePath('/reuniones')
    revalidatePath('/equipo')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo agendar la reunión.')
  }
}

/* ── Cuentas y tandas ─────────────────────────────────────────────────── */

/** Confirma que ya cambió de cuenta en Instagram. El contador arranca de nuevo. */
export async function confirmarCambioDeCuenta(cuentaId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()
    const filas = await db.execute(sql`
      update setters
         set cuenta_activa_id = ${cuentaId}::uuid, cuenta_activa_desde = now()
       where id = ${sesion.setterId}::uuid
         and exists (select 1 from setter_accounts sa
                      where sa.id = ${cuentaId}::uuid
                        and sa.setter_id = ${sesion.setterId}::uuid
                        and sa.activa)
      returning id
    `)
    if (filas.rows.length === 0) return { ok: false, error: 'Esa cuenta no es tuya.' }

    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('cuenta_setter_cambiada', ${sesion.userId}::uuid,
              ${JSON.stringify({ cuentaId })}::jsonb)
    `)
    refrescar()
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo cambiar de cuenta.')
  }
}

export interface ResultadoTanda extends EstadoAccion {
  entregados?: number
}

/**
 * Pedir más leads.
 *
 * **Solo entrega si le queda alguna cuenta con cupo hoy.** Entregar leads sin
 * cupo es entregarle una forma de quemarse la cuenta: el setter los ve, los
 * quiere hacer, y termina mandando 45 desde el mismo perfil.
 */
export async function pedirMasLeads(): Promise<ResultadoTanda> {
  try {
    const sesion = await exigirSetter()
    const cupo = await leerCupoDeSetter(sesion.setterId)

    if (cupo.restanteTotal <= 0) {
      const cuantas = cupo.cuentas.filter((c) => c.activa).length
      return {
        ok: false,
        error:
          cuantas > 1
            ? 'Tus cuentas llegaron al límite de hoy. Seguí mañana.'
            : 'Tu cuenta llegó al límite de hoy. Seguí mañana.',
      }
    }

    const conteos = await db.execute(sql`
      select count(*) filter (where estado in ('asignado', 'abierto', 'saltado'))::int as pendientes
        from lead_assignments
       where setter_id = ${sesion.setterId}::uuid
    `)
    const c = conteos.rows[0] as { pendientes: number }

    const cantidad = cuantosEntregar({
      estado: cupo,
      tandaDiaria: cupo.tandaDiaria,
      pendientes: c.pendientes,
    })

    if (cantidad <= 0) {
      return {
        ok: false,
        error: 'Ya tenés asignado todo lo que tus cuentas pueden mandar hoy.',
      }
    }

    const entregados = await asignarLeads(sesion.setterId, cantidad, sesion.userId)

    if (entregados === 0) {
      const pozo = await contarPozo()
      return {
        ok: false,
        error:
          pozo === 0
            ? 'No quedan leads sin asignar. Avisale al administrador.'
            : 'No se pudo entregar la tanda. Probá de nuevo en un momento.',
      }
    }

    refrescar()
    return { ok: true, error: null, entregados }
  } catch (err) {
    return alFallar(err, 'No se pudo entregar la tanda.')
  }
}

/* ── Avisos ───────────────────────────────────────────────────────────── */

/** "Entendido": registra la lectura con fecha y hora. */
export async function confirmarAviso(destinatarioId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()
    await db.execute(sql`
      update mensajes_destinatarios
         set leido_at = coalesce(leido_at, now())
       where id = ${destinatarioId}::uuid and setter_id = ${sesion.setterId}::uuid
    `)
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('mensaje_equipo_leido', ${sesion.userId}::uuid,
              ${JSON.stringify({ destinatarioId })}::jsonb)
    `)
    revalidatePath('/avisos')
    revalidatePath('/hoy')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo confirmar el aviso.')
  }
}

const respuestaDeAvisoSchema = z.string().trim().min(1, 'Escribí algo.').max(500)

/**
 * El setter responde un aviso. No es un chat: es para que pueda decir "no me
 * anda la cuenta B" sin salir de la app.
 */
export async function responderAviso(
  destinatarioId: string,
  texto: string,
): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()
    const parsed = respuestaDeAvisoSchema.safeParse(texto)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Escribí algo.' }
    }

    const filas = await db.execute(sql`
      update mensajes_destinatarios
         set respuesta = ${parsed.data}, respondido_at = now(),
             leido_at = coalesce(leido_at, now())
       where id = ${destinatarioId}::uuid and setter_id = ${sesion.setterId}::uuid
      returning mensaje_id
    `)
    if (filas.rows.length === 0) return { ok: false, error: 'Ese aviso no es tuyo.' }

    /*
     * El tipo de evento existía desde siempre y nadie lo insertaba: leer un
     * aviso quedaba registrado y responderlo no. Justo al revés de lo que
     * conviene — "no me anda la cuenta B" es más importante que "lo vi".
     */
    await db.execute(sql`
      insert into events (type, actor_user_id, payload_jsonb)
      values ('mensaje_equipo_respondido', ${sesion.userId}::uuid,
              ${JSON.stringify({ destinatarioId, texto: parsed.data })}::jsonb)
    `)

    await notificarYAvisar(
      {
        tipo: 'respuesta_de_setter',
        texto: `${sesion.nombre} respondió: "${parsed.data}"`,
        enlace: '/equipo/avisos',
        setterId: sesion.setterId,
      },
      'Respuesta de un setter',
    )

    revalidatePath('/avisos')
    revalidatePath('/equipo/avisos')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo enviar tu respuesta.')
  }
}

/** Cierra el recordatorio del admin: lo vio. */
export async function verRecordatorio(recordatorioId: string): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSetter()
    await db.execute(sql`
      update recordatorios set visto_at = now()
       where id = ${recordatorioId}::uuid and setter_id = ${sesion.setterId}::uuid
    `)
    revalidatePath('/hoy')
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudo cerrar el recordatorio.')
  }
}

/* ── Push ─────────────────────────────────────────────────────────────── */

const suscripcionSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().max(300).nullable().optional(),
})

export async function registrarPush(datos: unknown): Promise<EstadoAccion> {
  try {
    const sesion = await exigirSesion()
    const parsed = suscripcionSchema.safeParse(datos)
    if (!parsed.success) return { ok: false, error: 'La suscripción no es válida.' }

    await guardarSuscripcion({
      userId: sesion.userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh,
      auth: parsed.data.auth,
      userAgent: parsed.data.userAgent ?? null,
    })
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudieron activar las notificaciones.')
  }
}

export async function quitarPush(endpoint: string): Promise<EstadoAccion> {
  try {
    await exigirSesion()
    await borrarSuscripcion(endpoint)
    return { ok: true, error: null }
  } catch (err) {
    return alFallar(err, 'No se pudieron desactivar las notificaciones.')
  }
}

