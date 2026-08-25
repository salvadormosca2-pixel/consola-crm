import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { Paso } from '@/lib/mensajes-config'
import { CLASIFICACIONES, type Clasificacion } from '@/lib/seguimientos-vistas'
import { opsDate, OPS_TZ } from '@/lib/tz'
import { barrer } from '@/server/setters/asignacion'

/**
 * El control de seguimientos.
 *
 * Está armado en dos niveles y en dos pantallas distintas, no en una sola larga:
 *
 *   · **General** — los números de todo el equipo, y abajo los nombres.
 *   · **Un setter** — los mismos números, pero solo suyos.
 *
 * Las dos usan exactamente las mismas siete clasificaciones y las mismas
 * consultas, con o sin filtro de setter. Es lo que hace que los números se
 * puedan comparar: lo que ves en la general es la suma de lo que ves adentro.
 *
 * Todo se calcula de `proximo_seguimiento_at` y `proximo_paso`, que es lo que
 * hace aparecer al lead en la cola del celular. Si acá dice que faltan doce, en
 * el teléfono de alguien hay doce esperando.
 */

/** Los que siguen en juego. Un lead devuelto al pozo no le falta a nadie. */
const VIVO = sql`la.estado not in ('vencido', 'devuelto', 'cuenta_inexistente')`

/** Un seguimiento le toca cuando su fecha ya pasó y el lead sigue vivo. */
const PENDIENTE = sql`la.proximo_seguimiento_at is not null
                  and la.proximo_seguimiento_at <= now() and ${VIVO}`

/**
 * Días de atraso, contados por día operativo.
 *
 * Un seguimiento programado para las 23:00 de anoche y no hecho a las 08:00 de
 * hoy tiene un día de atraso, no nueve horas. Es como lo cuenta el equipo.
 */
const DIAS_DE_ATRASO = sql`greatest(0, (now() at time zone ${OPS_TZ})::date
                                      - (la.proximo_seguimiento_at at time zone ${OPS_TZ})::date)`

const CON_SEGUIMIENTO = sql`exists (select 1 from setter_sends ss
                                     where ss.assignment_id = la.id
                                       and ss.paso > 1 and ss.undone_at is null)`

/** Qué lead entra en cada clasificación. Una definición, las dos pantallas. */
const FILTROS: Record<Clasificacion, ReturnType<typeof sql>> = {
  por_contactar: sql`la.estado in ('asignado', 'abierto', 'saltado')`,
  contactados: sql`la.contactado_at is not null and ${VIVO}`,
  seguimiento_hecho: sql`${CON_SEGUIMIENTO} and ${VIVO}`,
  falta_seguimiento: sql`${PENDIENTE}`,
  atrasados: sql`${PENDIENTE} and ${DIAS_DE_ATRASO} > 0`,
  contestaron: sql`la.respondido_at is not null and ${VIVO}`,
  listos: sql`la.interes = 'interesa' and ${VIVO}`,
}

export type Conteos = Record<Clasificacion, number>

function conteosVacios(): Conteos {
  return Object.fromEntries(CLASIFICACIONES.map((c) => [c, 0])) as Conteos
}

/**
 * Los siete números, del equipo entero o de una persona.
 *
 * Van en una sola consulta con `filter`: siete recorridas de la tabla para
 * mostrar siete números en la misma pantalla no tiene sentido.
 */
export async function conteosDeSeguimientos(setterId?: string): Promise<Conteos> {
  const filas = await db.execute(sql`
    select
      count(*) filter (where ${FILTROS.por_contactar})::int as por_contactar,
      count(*) filter (where ${FILTROS.contactados})::int as contactados,
      count(*) filter (where ${FILTROS.seguimiento_hecho})::int as seguimiento_hecho,
      count(*) filter (where ${FILTROS.falta_seguimiento})::int as falta_seguimiento,
      count(*) filter (where ${FILTROS.atrasados})::int as atrasados,
      count(*) filter (where ${FILTROS.contestaron})::int as contestaron,
      count(*) filter (where ${FILTROS.listos})::int as listos
      from lead_assignments la
     ${setterId ? sql`where la.setter_id = ${setterId}::uuid` : sql``}
  `)
  const f = filas.rows[0] as Conteos | undefined
  return { ...conteosVacios(), ...(f ?? {}) }
}

/* ── La pantalla general ──────────────────────────────────────────────── */

export interface SetterEnLista {
  setterId: string
  nombre: string
  /** Mensajes de entrada que mandó hoy. */
  hoy: number
  tanda: number
  conteos: Conteos
  /** Del seguimiento más atrasado que tiene. Es lo que dispara la alerta. */
  diasAtraso: number
  /** Seguimientos que sí hizo hoy. */
  hechosHoy: number
  ultimaActividad: Date | null
  ultimoRecordatorio: Date | null
}

export interface GeneralDeSeguimientos {
  conteos: Conteos
  diasAtrasoMaximo: number
  hechosHoy: number
  setters: SetterEnLista[]
}

export async function generalDeSeguimientos(): Promise<GeneralDeSeguimientos> {
  // Antes de contar se pone al día lo que depende del reloj: si no, se
  // reclamarían seguimientos de leads que ya volvieron al pozo.
  await barrer()
  const hoy = opsDate()

  const conteos = await conteosDeSeguimientos()

  const extras = await db.execute(sql`
    select coalesce(max(case when ${PENDIENTE} then ${DIAS_DE_ATRASO} end), 0)::int as dias_atraso
      from lead_assignments la
  `)

  const hechos = await db.execute(sql`
    select count(*)::int as n from setter_sends ss
     where ss.paso > 1 and ss.undone_at is null and ss.ops_date = ${hoy}::date
  `)

  const filas = await db.execute(sql`
    select s.id as setter_id, u.name as nombre, s.tanda_diaria,
           count(la.id) filter (where ${FILTROS.por_contactar})::int as por_contactar,
           count(la.id) filter (where ${FILTROS.contactados})::int as contactados,
           count(la.id) filter (where ${FILTROS.seguimiento_hecho})::int as seguimiento_hecho,
           count(la.id) filter (where ${FILTROS.falta_seguimiento})::int as falta_seguimiento,
           count(la.id) filter (where ${FILTROS.atrasados})::int as atrasados,
           count(la.id) filter (where ${FILTROS.contestaron})::int as contestaron,
           count(la.id) filter (where ${FILTROS.listos})::int as listos,
           coalesce(max(case when ${PENDIENTE} then ${DIAS_DE_ATRASO} end), 0)::int as dias_atraso,
           (select count(*)::int from setter_sends ss
             where ss.setter_id = s.id and ss.undone_at is null
               and ss.ops_date = ${hoy}::date and ss.paso = 1) as hoy,
           (select count(*)::int from setter_sends ss
             where ss.setter_id = s.id and ss.undone_at is null
               and ss.ops_date = ${hoy}::date and ss.paso > 1) as hechos_hoy,
           (select max(ss.sent_at) from setter_sends ss
             where ss.setter_id = s.id and ss.undone_at is null) as ultima_actividad,
           (select max(r.created_at) from recordatorios r
             where r.setter_id = s.id) as ultimo_recordatorio
      from setters s
      join users u on u.id = s.user_id
      left join lead_assignments la on la.setter_id = s.id
     where u.status = 'activo'
     group by s.id, u.name, s.tanda_diaria
     order by dias_atraso desc, falta_seguimiento desc, u.name asc
  `)

  return {
    conteos,
    diasAtrasoMaximo: (extras.rows[0] as { dias_atraso: number } | undefined)?.dias_atraso ?? 0,
    hechosHoy: (hechos.rows[0] as { n: number } | undefined)?.n ?? 0,
    setters: (filas.rows as Array<Conteos & {
      setter_id: string
      nombre: string
      tanda_diaria: number
      dias_atraso: number
      hoy: number
      hechos_hoy: number
      ultima_actividad: Date | null
      ultimo_recordatorio: Date | null
    }>).map((f) => ({
      setterId: f.setter_id,
      nombre: f.nombre,
      hoy: f.hoy,
      tanda: f.tanda_diaria,
      diasAtraso: f.dias_atraso,
      hechosHoy: f.hechos_hoy,
      ultimaActividad: f.ultima_actividad ? new Date(f.ultima_actividad) : null,
      ultimoRecordatorio: f.ultimo_recordatorio ? new Date(f.ultimo_recordatorio) : null,
      conteos: {
        por_contactar: f.por_contactar,
        contactados: f.contactados,
        seguimiento_hecho: f.seguimiento_hecho,
        falta_seguimiento: f.falta_seguimiento,
        atrasados: f.atrasados,
        contestaron: f.contestaron,
        listos: f.listos,
      },
    })),
  }
}

/* ── La ficha de un setter ────────────────────────────────────────────── */

export interface FichaDeSeguimientos {
  setterId: string
  nombre: string
  hoy: number
  tanda: number
  hechosHoy: number
  diasAtraso: number
  conteos: Conteos
  ultimaActividad: Date | null
}

export async function fichaDeSeguimientos(setterId: string): Promise<FichaDeSeguimientos | null> {
  await barrer()
  const hoy = opsDate()

  const filas = await db.execute(sql`
    select u.name as nombre, s.tanda_diaria,
           (select count(*)::int from setter_sends ss
             where ss.setter_id = s.id and ss.undone_at is null
               and ss.ops_date = ${hoy}::date and ss.paso = 1) as hoy,
           (select count(*)::int from setter_sends ss
             where ss.setter_id = s.id and ss.undone_at is null
               and ss.ops_date = ${hoy}::date and ss.paso > 1) as hechos_hoy,
           (select max(ss.sent_at) from setter_sends ss
             where ss.setter_id = s.id and ss.undone_at is null) as ultima_actividad,
           coalesce((select max(${DIAS_DE_ATRASO})::int from lead_assignments la
                      where la.setter_id = s.id and ${PENDIENTE}), 0) as dias_atraso
      from setters s
      join users u on u.id = s.user_id
     where s.id = ${setterId}::uuid
     limit 1
  `)

  const f = filas.rows[0] as
    | {
        nombre: string
        tanda_diaria: number
        hoy: number
        hechos_hoy: number
        ultima_actividad: Date | null
        dias_atraso: number
      }
    | undefined
  if (!f) return null

  return {
    setterId,
    nombre: f.nombre,
    hoy: f.hoy,
    tanda: f.tanda_diaria,
    hechosHoy: f.hechos_hoy,
    diasAtraso: f.dias_atraso,
    ultimaActividad: f.ultima_actividad ? new Date(f.ultima_actividad) : null,
    conteos: await conteosDeSeguimientos(setterId),
  }
}

/* ── Lead por lead ────────────────────────────────────────────────────── */

export interface LeadClasificado {
  assignmentId: string
  negocio: string
  igUsername: string
  rubro: string | null
  setterId: string
  setterNombre: string
  /** Qué mensaje le toca, si le toca alguno. */
  paso: Paso | null
  programadoAt: Date | null
  diasAtraso: number
  /** Horas que le quedan antes de volver al pozo. Solo importa sin contactar. */
  horasParaVencer: number
  contactadoAt: Date | null
  respondidoAt: Date | null
  respondioA: string | null
  interes: string | null
  nota: string | null
}

/**
 * Los leads de una clasificación, del equipo o de una persona.
 *
 * Es lo que se abre al tocar un número: no alcanza con saber que faltan
 * cuarenta, hay que ver cuáles son para decidir si se reclaman o se reparten
 * de nuevo.
 */
export async function leadsDeClasificacion(
  clasificacion: Clasificacion,
  setterId?: string,
): Promise<LeadClasificado[]> {
  const filas = await db.execute(sql`
    select la.id, la.proximo_paso as paso, la.proximo_seguimiento_at,
           la.contactado_at, la.respondido_at, la.respondio_a, la.interes, la.nota,
           ${DIAS_DE_ATRASO}::int as dias_atraso,
           greatest(0, floor(extract(epoch from (la.vence_at - now())) / 3600))::int as horas,
           c.business_name, c.ig_username, c.niche,
           s.id as setter_id, u.name as setter_nombre
      from lead_assignments la
      join contacts c on c.id = la.contact_id
      join setters s on s.id = la.setter_id
      join users u on u.id = s.user_id
     where ${FILTROS[clasificacion]}
       ${setterId ? sql`and la.setter_id = ${setterId}::uuid` : sql``}
     order by
       -- Lo urgente arriba, y qué es urgente depende de la clasificación: en
       -- las de seguimiento manda el atraso; en las de contactar, el que está
       -- por vencer; en las de resultado, el que hace más que espera.
       ${
         clasificacion === 'por_contactar'
           ? sql`la.vence_at asc`
           : clasificacion === 'contestaron' || clasificacion === 'listos'
             ? sql`la.respondido_at asc`
             : clasificacion === 'contactados' || clasificacion === 'seguimiento_hecho'
               ? sql`la.contactado_at desc`
               : sql`dias_atraso desc, la.proximo_seguimiento_at asc`
       }
     limit 500
  `)

  return (filas.rows as Array<{
    id: string
    paso: number | null
    proximo_seguimiento_at: Date | null
    contactado_at: Date | null
    respondido_at: Date | null
    respondio_a: string | null
    interes: string | null
    nota: string | null
    dias_atraso: number
    horas: number
    business_name: string
    ig_username: string
    niche: string | null
    setter_id: string
    setter_nombre: string
  }>).map((f) => ({
    assignmentId: f.id,
    negocio: f.business_name,
    igUsername: f.ig_username,
    rubro: f.niche,
    setterId: f.setter_id,
    setterNombre: f.setter_nombre,
    paso: (f.paso as Paso | null) ?? null,
    programadoAt: f.proximo_seguimiento_at ? new Date(f.proximo_seguimiento_at) : null,
    diasAtraso: f.dias_atraso,
    horasParaVencer: f.horas,
    contactadoAt: f.contactado_at ? new Date(f.contactado_at) : null,
    respondidoAt: f.respondido_at ? new Date(f.respondido_at) : null,
    respondioA: f.respondio_a,
    interes: f.interes,
    nota: f.nota,
  }))
}
