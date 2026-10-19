import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Db } from '@/db'
import type { LeadEstado } from '@/db/enums'
import { normalizarInstagram } from '@/lib/equipo-lote'
import { calcularVencimiento, type PasoDeSeguimiento } from '@/lib/setters-config'
import type { Pestana } from '@/lib/setters-vistas'
import { leerConfigSetters } from '@/server/setters/config'
import { elegirTexto, leerTextos } from '@/server/setters/textos'

/**
 * "Mis leads": todo lo que el setter tiene, no solo la cola de hoy.
 *
 * La pantalla existe por un motivo concreto: las respuestas no llegan cuando
 * uno manda el mensaje, llegan tres días después. El setter necesita poder
 * buscar ese negocio por nombre y marcarlo en dos toques, sin depender de que
 * aparezca en una cola.
 *
 * Los rótulos de las pestañas viven en `@/lib/setters-vistas`: los necesita
 * también el componente de cliente, y este módulo es `server-only`.
 */

export interface FilaLead {
  assignmentId: string
  contactId: string
  businessName: string
  igUsername: string
  niche: string | null
  city: string | null
  estado: LeadEstado
  asignadoAt: Date
  contactadoAt: Date | null
  respondidoAt: Date | null
  calificadoAt: Date | null
  venceAt: Date
  /** Horas hasta que vuelve al pozo. Solo importa si está sin contactar. */
  horasRestantes: number
  /** Está en riesgo de vencer y todavía no lo trabajó. */
  porVencer: boolean
  reunionAt: Date | null
  linkDirecto: string
  /**
   * El mensaje que le toca, ya armado, o null si no le toca ninguno.
   *
   * Va acá y no se pide al tocar el botón porque copiar tiene que pasar dentro
   * del mismo toque del dedo: si hay que esperar al servidor, el navegador ya
   * no lo deja escribir en el portapapeles.
   */
  mensaje: string | null
}

export interface MisLeads {
  filas: FilaLead[]
  totales: {
    contactados: number
    calificados: number
    reuniones: number
  }
  conteos: Record<Pestana, number>
}

/**
 * Una etapa por pestaña, y el lead está en una sola a la vez. Es lo que hace
 * que cada fila tenga una única acción posible en vez de todos los botones.
 *
 * Las condiciones y `etapaDe` en el cliente tienen que decir lo mismo, o la
 * pestaña muestra una fila con el botón de otra etapa.
 */
const FILTROS: Record<Pestana, ReturnType<typeof sql>> = {
  por_contactar: sql`la.estado in ('asignado', 'abierto', 'saltado')`,
  contactados: sql`la.estado in ('contactado', 'segundo_enviado', 'respondido')`,
  calificados: sql`la.estado = 'calificado' and m.id is null`,
  reuniones: sql`m.id is not null`,
}

/**
 * Un lead con reunión agendada vive en "Reuniones" y en ningún otro lado: si
 * apareciera además en "Respondió", el setter volvería a ver el botón de
 * agendar sobre alguien que ya tiene fecha.
 */
const SIN_REUNION = sql`not exists (
  select 1 from meetings mm
   where mm.contact_id = la.contact_id and mm.setter_id = la.setter_id
)`

export async function listarMisLeads(
  setterId: string,
  pestana: Pestana,
  busqueda: string,
): Promise<MisLeads> {
  const termino = busqueda.trim()
  const patron = `%${termino.replace(/[%_]/g, (c) => `\\${c}`)}%`

  const filas = await db.execute(sql`
    select la.id, la.contact_id, la.estado, la.asignado_at, la.contactado_at,
           la.respondido_at, la.calificado_at, la.vence_at,
           la.proximo_paso, la.proximo_seguimiento_at,
           c.business_name, c.ig_username, c.niche, c.city, c.contact_name, c.bought,
           m.scheduled_at as reunion_at
      from lead_assignments la
      join contacts c on c.id = la.contact_id
      left join lateral (
        select mm.scheduled_at, mm.id
          from meetings mm
         where mm.contact_id = la.contact_id and mm.setter_id = la.setter_id
         order by mm.scheduled_at desc
         limit 1
      ) m on true
     where la.setter_id = ${setterId}::uuid
       and la.estado not in ('vencido', 'devuelto')
       and ${FILTROS[pestana]}
       ${
         termino.length > 0
           ? sql`and (c.business_name ilike ${patron} or c.ig_username ilike ${patron})`
           : sql``
       }
     order by
       case when la.estado in ('asignado', 'abierto', 'saltado') then la.vence_at end asc,
       coalesce(la.respondido_at, la.contactado_at, la.asignado_at) desc
     limit 300
  `)

  const conteos = await db.execute(sql`
    select
      count(*) filter (where la.estado in ('asignado', 'abierto', 'saltado'))::int as por_contactar,
      count(*) filter (where la.estado in ('contactado', 'segundo_enviado', 'respondido'))::int as contactados,
      count(*) filter (where la.estado = 'calificado' and ${SIN_REUNION})::int as calificados_sin_reunion,
      count(*) filter (where la.calificado_at is not null)::int as calificados,
      count(*) filter (where la.contactado_at is not null)::int as total_contactados,
      count(*) filter (where not (${SIN_REUNION}))::int as con_reunion
      from lead_assignments la
     where la.setter_id = ${setterId}::uuid
       and la.estado not in ('vencido', 'devuelto')
  `)

  const reuniones = await db.execute(sql`
    select count(*)::int as n from meetings where setter_id = ${setterId}::uuid
  `)

  /*
   * Los textos de todas las filas, de un viaje: uno por lead, y pedirlos de a
   * uno sería una consulta por fila.
   */
  const textos = await leerTextos(
    (filas.rows as Array<{ id: string }>).map((f) => f.id),
  )

  const ahora = Date.now()
  const c = conteos.rows[0] as
    | {
        por_contactar: number
        contactados: number
        calificados_sin_reunion: number
        calificados: number
        total_contactados: number
        con_reunion: number
      }
    | undefined
  const nReuniones = (reuniones.rows[0] as { n: number } | undefined)?.n ?? 0

  return {
    filas: (filas.rows as Array<{
      id: string
      contact_id: string
      estado: LeadEstado
      asignado_at: Date
      contactado_at: Date | null
      respondido_at: Date | null
      calificado_at: Date | null
      vence_at: Date
      business_name: string
      ig_username: string
      niche: string | null
      city: string | null
      reunion_at: Date | null
      proximo_paso: number | null
      proximo_seguimiento_at: Date | null
      contact_name: string | null
      bought: string | null
    }>).map((f) => {
      const vence = new Date(f.vence_at)
      const horas = Math.max(Math.floor((vence.getTime() - ahora) / 3_600_000), 0)
      const sinTrabajar = ['asignado', 'abierto', 'saltado'].includes(f.estado)

      /*
       * Qué mensaje le toca. Es la misma regla que en la cola del día: si
       * tiene un seguimiento vencido le toca ese paso, y si nunca recibió nada
       * le toca el primero. Al que no le toca ninguno, 'Abrir chat' abre la
       * conversación sin copiar nada — que es lo correcto: no hay nada escrito
       * para esa charla.
       */
      const leToca =
        f.proximo_seguimiento_at !== null &&
        new Date(f.proximo_seguimiento_at).getTime() <= ahora
      const paso: PasoDeSeguimiento | null = leToca
        ? ((f.proximo_paso ?? 1) as PasoDeSeguimiento)
        : sinTrabajar
          ? 1
          : null

      const armado = paso === null ? null : elegirTexto(textos.get(f.id), paso)

      return {
        assignmentId: f.id,
        contactId: f.contact_id,
        businessName: f.business_name,
        igUsername: f.ig_username,
        niche: f.niche,
        city: f.city,
        estado: f.estado,
        asignadoAt: new Date(f.asignado_at),
        contactadoAt: f.contactado_at ? new Date(f.contactado_at) : null,
        respondidoAt: f.respondido_at ? new Date(f.respondido_at) : null,
        calificadoAt: f.calificado_at ? new Date(f.calificado_at) : null,
        venceAt: vence,
        horasRestantes: horas,
        porVencer: sinTrabajar && horas <= 12,
        reunionAt: f.reunion_at ? new Date(f.reunion_at) : null,
        linkDirecto: `https://ig.me/m/${f.ig_username}`,
        mensaje: armado?.ok ? armado.texto : null,
      }
    }),
    totales: {
      contactados: c?.total_contactados ?? 0,
      calificados: c?.calificados ?? 0,
      reuniones: nReuniones,
    },
    conteos: {
      por_contactar: c?.por_contactar ?? 0,
      contactados: c?.contactados ?? 0,
      calificados: c?.calificados_sin_reunion ?? 0,
      // El número de la pestaña tiene que dar lo mismo que las filas que trae.
      reuniones: c?.con_reunion ?? 0,
    },
  }
}

/* ── Leads que carga el propio setter ─────────────────────────────────── */

export interface LeadPropio {
  /** La cuenta de Instagram, con o sin arroba. Es lo único obligatorio además del nombre. */
  instagram: string
  negocio: string
  ciudad?: string | null
  nota?: string | null
}

export type ResultadoDeAlta =
  | { ok: true; assignmentId: string; usuario: string }
  | { ok: false; error: string }

/**
 * El setter agrega un lead suyo.
 *
 * El pozo son leads scrapeados que no conoce nadie. Pero el setter también
 * conoce gente —un local del barrio, alguien que le compró a un conocido, el
 * negocio de un amigo— y esos son los mejores leads que hay: hay confianza
 * antes del primer mensaje. Hasta ahora no tenía dónde meterlos y terminaban en
 * una nota del celular, fuera del sistema: sin guion, sin seguimiento y sin
 * quedar registrados como suyos cuando cierran.
 *
 * Entra igual que cualquier otro lead —a su cola, con la entrada como primer
 * paso y el mismo guion— con una sola diferencia: no sale del pozo, se lo
 * asigna él. Las dos reglas que no se tocan siguen valiendo: un negocio lo
 * trabaja un solo setter, y el mismo negocio no entra dos veces.
 */
export async function agregarLeadPropio(
  setterId: string,
  datos: LeadPropio,
  actorUserId: string | null,
  cliente: Db = db,
): Promise<ResultadoDeAlta> {
  const usuario = normalizarInstagram(datos.instagram)
  if (!/^[a-z0-9._]{1,30}$/.test(usuario)) {
    return { ok: false, error: 'Esa cuenta de Instagram no parece válida. Va sin el arroba.' }
  }

  const negocio = datos.negocio.trim()
  if (negocio.length < 2) return { ok: false, error: 'Poné el nombre del negocio.' }

  const cfg = await leerConfigSetters(cliente)
  const vence = calcularVencimiento(cfg)
  const dedupeKey = `ig:${usuario}`

  return cliente.transaction(async (tx) => {
    /*
     * El contacto puede existir ya: importado en una lista, cargado por otro
     * setter, o descartado hace meses. Se traba la fila antes de decidir, así
     * que dos setters agregando el mismo negocio en el mismo segundo no pueden
     * terminar los dos con él.
     */
    const previos = await tx.execute(sql`
      select id, origen, discarded_at from contacts
       where dedupe_key = ${dedupeKey} limit 1
      for update
    `)
    const previo = previos.rows[0] as
      | { id: string; origen: string; discarded_at: Date | null }
      | undefined

    let contactId: string

    if (previo) {
      if (previo.origen === 'cliente') {
        return {
          ok: false as const,
          error: 'Ese negocio ya está cargado como cliente en el CRM. Avisale a tu admin.',
        }
      }

      const tomados = await tx.execute(sql`
        select la.setter_id, u.name as nombre
          from lead_assignments la
          join setters s on s.id = la.setter_id
          join users u on u.id = s.user_id
         where la.contact_id = ${previo.id}::uuid
           and la.estado not in ('vencido', 'devuelto')
         limit 1
      `)
      const tomado = tomados.rows[0] as { setter_id: string; nombre: string } | undefined

      if (tomado) {
        return {
          ok: false as const,
          error:
            tomado.setter_id === setterId
              ? `@${usuario} ya está en tu lista.`
              : `@${usuario} ya lo está trabajando ${tomado.nombre}.`,
        }
      }

      // Estaba libre: vuelve a la cancha con los datos que trae el setter, que
      // lo conoce mejor que la lista de donde salió.
      await tx.execute(sql`
        update contacts
           set business_name = ${negocio},
               city = coalesce(nullif(${datos.ciudad ?? ''}, ''), city),
               notes = coalesce(nullif(${datos.nota ?? ''}, ''), notes),
               discarded_at = null,
               stage = case when stage in ('descartado', 'no_interesado') then 'nuevo'::contact_stage
                            else stage end,
               updated_at = now()
         where id = ${previo.id}::uuid
      `)
      contactId = previo.id
    } else {
      const nuevos = await tx.execute(sql`
        insert into contacts (business_name, ig_username, has_instagram, origen,
                              city, notes, dedupe_key)
        values (${negocio}, ${usuario}, true, 'scrapeado',
                ${datos.ciudad?.trim() || null}, ${datos.nota?.trim() || null}, ${dedupeKey})
        returning id
      `)
      contactId = (nuevos.rows[0] as { id: string }).id
    }

    const asignaciones = await tx.execute(sql`
      insert into lead_assignments (contact_id, setter_id, vence_at)
      values (${contactId}::uuid, ${setterId}::uuid, ${vence.toISOString()}::timestamptz)
      on conflict do nothing
      returning id
    `)
    const assignmentId = (asignaciones.rows[0] as { id: string } | undefined)?.id
    if (!assignmentId) {
      return { ok: false as const, error: `@${usuario} ya lo está trabajando alguien.` }
    }

    await tx.execute(sql`
      insert into events (type, contact_id, actor_user_id, payload_jsonb)
      values ('lead_agregado', ${contactId}::uuid, ${actorUserId}::uuid,
              ${JSON.stringify({ setterId, usuario, negocio })}::jsonb)
    `)

    return { ok: true as const, assignmentId, usuario }
  })
}
