import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { ContactStage, LeadInteres, SetterSendTipo } from '@/db/enums'
import { RESPUESTAS, type Respuesta } from '@/lib/respuestas-vistas'

/**
 * La bandeja de respuestas, separada por setter.
 *
 * Es la pantalla del detalle: acá está todo etiquetado —quién lo contactó, a
 * qué mensaje contestó, qué dijo exactamente y si está interesado de verdad—
 * mientras que el control de seguimientos es el vistazo de arriba.
 *
 * Está armada en dos niveles, como el de seguimientos: la general con los
 * números del equipo y los nombres, y la de cada persona con lo suyo. Las dos
 * usan las mismas consultas con o sin filtro de setter, así lo de la general
 * es exactamente la suma de lo de adentro.
 */

/** Contestó alguna vez. Es la puerta de entrada a toda esta pantalla. */
const CONTESTO = sql`c.discarded_at is null
                 and (c.received_count > 0 or r.respondio_a is not null)`

/**
 * Lo que dijo el lead, tomado de su asignación más reciente.
 *
 * Se junta por LATERAL y no por subconsulta correlacionada para que la use
 * una sola vez por contacto: la bandeja trae cientos de filas y cada una
 * necesita los tres datos (a qué contestó, si le interesa, qué dijo).
 */
const LATERAL_RESPUESTA = sql`
  left join lateral (
    select la.respondio_a, la.interes, la.nota, la.setter_id, la.respondido_at
      from lead_assignments la
     where la.contact_id = c.id and la.respondido_at is not null
     order by la.respondido_at desc
     limit 1
  ) r on true`

const FILTROS: Record<Respuesta, ReturnType<typeof sql>> = {
  sin_clasificar: sql`c.stage = 'respondido'`,
  sin_oferta: sql`r.respondio_a = 'primero'`,
  oferta: sql`r.respondio_a = 'segundo'`,
  interesados: sql`r.interes = 'interesa'`,
  no_interesa: sql`r.interes = 'no_interesa'`,
}

export type ConteosDeRespuestas = Record<Respuesta, number>

function vacios(): ConteosDeRespuestas {
  return Object.fromEntries(RESPUESTAS.map((v) => [v, 0])) as ConteosDeRespuestas
}

export async function conteosDeRespuestas(setterId?: string): Promise<ConteosDeRespuestas> {
  const filas = await db.execute(sql`
    select
      count(*) filter (where ${FILTROS.sin_clasificar})::int as sin_clasificar,
      count(*) filter (where ${FILTROS.sin_oferta})::int as sin_oferta,
      count(*) filter (where ${FILTROS.oferta})::int as oferta,
      count(*) filter (where ${FILTROS.interesados})::int as interesados,
      count(*) filter (where ${FILTROS.no_interesa})::int as no_interesa
      from contacts c
      ${LATERAL_RESPUESTA}
     where ${CONTESTO}
       ${setterId ? sql`and r.setter_id = ${setterId}::uuid` : sql``}
  `)
  const f = filas.rows[0] as ConteosDeRespuestas | undefined
  return { ...vacios(), ...(f ?? {}) }
}

/* ── Los nombres ──────────────────────────────────────────────────────── */

export interface SetterConRespuestas {
  setterId: string
  nombre: string
  conteos: ConteosDeRespuestas
  /** Cuántos contactó en total: es el denominador de todo lo demás. */
  contactados: number
  /** Última respuesta que trajo. Dice si el canal sigue vivo. */
  ultimaRespuesta: Date | null
}

export interface GeneralDeRespuestas {
  conteos: ConteosDeRespuestas
  setters: SetterConRespuestas[]
  /**
   * Respuestas que no vinieron del equipo de Instagram: contactos viejos o
   * cargados a mano. Se cuentan aparte para que los números por setter cierren.
   */
  sinSetter: number
}

export async function generalDeRespuestas(): Promise<GeneralDeRespuestas> {
  const conteos = await conteosDeRespuestas()

  const filas = await db.execute(sql`
    select s.id as setter_id, u.name as nombre,
           count(*) filter (where ${FILTROS.sin_clasificar})::int as sin_clasificar,
           count(*) filter (where ${FILTROS.sin_oferta})::int as sin_oferta,
           count(*) filter (where ${FILTROS.oferta})::int as oferta,
           count(*) filter (where ${FILTROS.interesados})::int as interesados,
           count(*) filter (where ${FILTROS.no_interesa})::int as no_interesa,
           max(r.respondido_at) as ultima_respuesta,
           (select count(*)::int from lead_assignments la
             where la.setter_id = s.id and la.contactado_at is not null) as contactados
      from contacts c
      ${LATERAL_RESPUESTA}
      join setters s on s.id = r.setter_id
      join users u on u.id = s.user_id
     where ${CONTESTO} and u.status <> 'baja'
     group by s.id, u.name
     order by interesados desc, sin_clasificar desc, u.name asc
  `)

  const huerfanas = await db.execute(sql`
    select count(*)::int as n
      from contacts c
      ${LATERAL_RESPUESTA}
     where ${CONTESTO} and r.setter_id is null
  `)

  return {
    conteos,
    sinSetter: (huerfanas.rows[0] as { n: number } | undefined)?.n ?? 0,
    setters: (filas.rows as Array<ConteosDeRespuestas & {
      setter_id: string
      nombre: string
      contactados: number
      ultima_respuesta: Date | null
    }>).map((f) => ({
      setterId: f.setter_id,
      nombre: f.nombre,
      contactados: f.contactados,
      ultimaRespuesta: f.ultima_respuesta ? new Date(f.ultima_respuesta) : null,
      conteos: {
        sin_clasificar: f.sin_clasificar,
        sin_oferta: f.sin_oferta,
        oferta: f.oferta,
        interesados: f.interesados,
        no_interesa: f.no_interesa,
      },
    })),
  }
}

/* ── El detalle ───────────────────────────────────────────────────────── */

export interface RespuestaDetallada {
  id: string
  businessName: string
  contactName: string | null
  igUsername: string | null
  phoneE164: string | null
  niche: string | null
  city: string | null
  stage: ContactStage
  score: number
  /** A qué mensaje contestó. Lo único que de verdad clasifica una respuesta. */
  respondioA: SetterSendTipo | null
  interes: LeadInteres | null
  /** Lo que anotó el setter. Obligatorio al responder la oferta. */
  notaDelSetter: string | null
  /** Lo último que dijo el lead, si quedó registrado. */
  ultimoMensaje: string | null
  respondidoAt: Date | null
  contactadoAt: Date | null
  /** Hace cuánto espera respuesta mía, en horas. */
  esperandoHoras: number
  setterId: string | null
  setterNombre: string | null
}

export async function respuestasDetalladas(
  vista: Respuesta,
  setterId?: string,
): Promise<RespuestaDetallada[]> {
  const filas = await db.execute(sql`
    select c.id, c.business_name, c.contact_name, c.ig_username, c.phone_e164,
           c.niche, c.city, c.stage, c.score, c.last_inbound_at,
           r.respondio_a, r.interes, r.nota as nota_del_setter, r.respondido_at, r.setter_id,
           la.contactado_at,
           u.name as setter_nombre,
           ult.body as ultimo_mensaje,
           extract(epoch from (now() - coalesce(c.last_inbound_at, now()))) / 3600 as esperando
      from contacts c
      ${LATERAL_RESPUESTA}
      left join setters s on s.id = r.setter_id
      left join users u on u.id = s.user_id
      left join lateral (
        select la2.contactado_at from lead_assignments la2
         where la2.contact_id = c.id and la2.contactado_at is not null
         order by la2.contactado_at asc limit 1
      ) la on true
      left join lateral (
        select m.body from messages m
         where m.contact_id = c.id and m.direction = 'in'
         order by m.created_at desc limit 1
      ) ult on true
     where ${CONTESTO} and ${FILTROS[vista]}
       ${setterId ? sql`and r.setter_id = ${setterId}::uuid` : sql``}
     order by coalesce(r.respondido_at, c.last_inbound_at) asc nulls last
     limit 500
  `)

  return (filas.rows as Array<Record<string, unknown>>).map((f) => ({
    id: f.id as string,
    businessName: f.business_name as string,
    contactName: f.contact_name as string | null,
    igUsername: f.ig_username as string | null,
    phoneE164: f.phone_e164 as string | null,
    niche: f.niche as string | null,
    city: f.city as string | null,
    stage: f.stage as ContactStage,
    score: f.score as number,
    respondioA: f.respondio_a as SetterSendTipo | null,
    interes: f.interes as LeadInteres | null,
    notaDelSetter: f.nota_del_setter as string | null,
    ultimoMensaje: f.ultimo_mensaje as string | null,
    respondidoAt: f.respondido_at ? new Date(f.respondido_at as string) : null,
    contactadoAt: f.contactado_at ? new Date(f.contactado_at as string) : null,
    esperandoHoras: Math.round(Number(f.esperando ?? 0)),
    setterId: f.setter_id as string | null,
    setterNombre: f.setter_nombre as string | null,
  }))
}
