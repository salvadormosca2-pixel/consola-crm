import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import { EVENTO_META, type GrupoDeActividad } from '@/lib/actividad'
import { opsDate } from '@/lib/tz'

/**
 * Todo lo que pasó, en orden.
 *
 * Lee `events`, que es donde cada acción del sistema deja su rastro con autor,
 * hora y contacto. No hay nada que "activar": el registro existe desde el
 * primer día porque se escribe dentro de la misma transacción que la acción.
 * Si el envío se guardó, su evento también; si la transacción falló, no queda
 * ni uno ni el otro.
 *
 * Esta pantalla es solo la lectura.
 */

export interface FilaDeActividad {
  id: string
  tipo: string
  cuando: Date
  /** Quién lo hizo. Null cuando lo hizo el sistema solo (barrido, reparto). */
  quien: string | null
  rolDeQuien: string | null
  /** Sobre qué negocio. Null en los eventos que no son de un lead. */
  negocio: string | null
  igUsername: string | null
  /** Lo que el evento guardó: cupo, motivo, nota, cuenta usada. */
  datos: Record<string, unknown>
}

export interface FiltrosDeActividad {
  grupo?: GrupoDeActividad
  actorUserId?: string
  /** Búsqueda por negocio o por usuario de Instagram. */
  busqueda?: string
}

/**
 * Los tipos de cada grupo, ya listos para el `in (...)` de la consulta.
 *
 * Va como lista de parámetros y no como arreglo: pasar un arreglo de JS a
 * `= any(...)` no sobrevive el viaje —Postgres no le encuentra el tipo— y la
 * consulta revienta en tiempo de ejecución, que es el peor momento.
 */
function tiposDe(grupo: GrupoDeActividad) {
  const tipos = Object.entries(EVENTO_META)
    .filter(([, m]) => m.grupo === grupo)
    .map(([tipo]) => tipo)
  return sql.join(
    tipos.map((t) => sql`${t}`),
    sql`, `,
  )
}

export async function listarActividad(
  filtros: FiltrosDeActividad = {},
  limite = 300,
): Promise<FilaDeActividad[]> {
  const termino = filtros.busqueda?.trim() ?? ''
  const patron = `%${termino.replace(/[%_]/g, (c) => `\\${c}`)}%`

  const filas = await db.execute(sql`
    select e.id, e.type, e.created_at, e.payload_jsonb,
           u.name as quien, u.role as rol,
           c.business_name, c.ig_username
      from events e
      left join users u on u.id = e.actor_user_id
      left join contacts c on c.id = e.contact_id
     where true
       ${filtros.grupo ? sql`and e.type in (${tiposDe(filtros.grupo)})` : sql``}
       ${filtros.actorUserId ? sql`and e.actor_user_id = ${filtros.actorUserId}::uuid` : sql``}
       ${
         termino.length > 0
           ? sql`and (c.business_name ilike ${patron} or c.ig_username ilike ${patron})`
           : sql``
       }
     order by e.created_at desc
     limit ${limite}
  `)

  return (filas.rows as Array<{
    id: string
    type: string
    created_at: Date
    payload_jsonb: Record<string, unknown> | null
    quien: string | null
    rol: string | null
    business_name: string | null
    ig_username: string | null
  }>).map((f) => ({
    id: f.id,
    tipo: f.type,
    cuando: new Date(f.created_at),
    quien: f.quien,
    rolDeQuien: f.rol,
    negocio: f.business_name,
    igUsername: f.ig_username,
    datos: f.payload_jsonb ?? {},
  }))
}

export interface ResumenDeActividad {
  hoy: number
  /** Cuántas acciones hizo cada persona hoy. El orden es el del ranking. */
  porPersona: Array<{ userId: string; nombre: string; rol: string; acciones: number }>
  /** Cuántas de cada grupo hay hoy, para las pestañas. */
  porGrupo: Record<GrupoDeActividad, number>
  /** La más vieja que se guarda. Dice desde cuándo hay registro. */
  desde: Date | null
}

export async function resumenDeActividad(): Promise<ResumenDeActividad> {
  const hoy = opsDate()

  const totales = await db.execute(sql`
    select count(*) filter (where (e.created_at at time zone 'America/Argentina/Buenos_Aires')::date
                                  = ${hoy}::date)::int as hoy,
           min(e.created_at) as desde,
           count(*) filter (where e.type in (${tiposDe('mensajes')}))::int as mensajes,
           count(*) filter (where e.type in (${tiposDe('respuestas')}))::int as respuestas,
           count(*) filter (where e.type in (${tiposDe('leads')}))::int as leads,
           count(*) filter (where e.type in (${tiposDe('equipo')}))::int as equipo
      from events e
  `)

  const personas = await db.execute(sql`
    select u.id, u.name, u.role, count(*)::int as acciones
      from events e
      join users u on u.id = e.actor_user_id
     where (e.created_at at time zone 'America/Argentina/Buenos_Aires')::date = ${hoy}::date
     group by u.id, u.name, u.role
     order by acciones desc, u.name asc
  `)

  const t = totales.rows[0] as
    | {
        hoy: number
        desde: Date | null
        mensajes: number
        respuestas: number
        leads: number
        equipo: number
      }
    | undefined

  return {
    hoy: t?.hoy ?? 0,
    desde: t?.desde ? new Date(t.desde) : null,
    porGrupo: {
      mensajes: t?.mensajes ?? 0,
      respuestas: t?.respuestas ?? 0,
      leads: t?.leads ?? 0,
      equipo: t?.equipo ?? 0,
    },
    porPersona: (personas.rows as Array<{
      id: string
      name: string
      role: string
      acciones: number
    }>).map((f) => ({ userId: f.id, nombre: f.name, rol: f.role, acciones: f.acciones })),
  }
}
