import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { MeetingStatus, MeetingType } from '@/db/enums'
import { OPS_TZ } from '@/lib/tz'

/**
 * El calendario de reuniones.
 *
 * Las que agendan los setters usan la misma tabla `meetings` de siempre, con el
 * setter que la consiguió: no hay una tabla paralela. La reunión la manejo yo;
 * el setter la ve en su pestaña pero no la toca.
 */

export const VISTAS_REUNION = ['dia', 'semana', 'lista'] as const
export type VistaReunion = (typeof VISTAS_REUNION)[number]

export interface FilaReunion {
  id: string
  contactId: string
  businessName: string
  igUsername: string | null
  phoneE164: string | null
  scheduledAt: Date
  durationMinutes: number
  type: MeetingType
  status: MeetingStatus
  notes: string | null
  setterId: string | null
  setterNombre: string | null
  /** Es en las próximas 24 horas: va destacada. */
  inminente: boolean
}

/**
 * `ancla` es el día que se está mirando, en formato operativo. La ventana se
 * calcula en la zona de trabajo y no en UTC: una reunión de las 21:00 de un
 * martes tiene que caer en el martes, no en el miércoles.
 */
export async function listarReuniones(params: {
  vista: VistaReunion
  ancla: string
  setterId?: string | null
}): Promise<FilaReunion[]> {
  const { vista, ancla, setterId } = params

  const ventana =
    vista === 'dia'
      ? sql`(m.scheduled_at at time zone ${OPS_TZ})::date = ${ancla}::date`
      : vista === 'semana'
        ? sql`(m.scheduled_at at time zone ${OPS_TZ})::date
              between ${ancla}::date - ((extract(isodow from ${ancla}::date)::int - 1) * interval '1 day')
                  and ${ancla}::date + ((7 - extract(isodow from ${ancla}::date)::int) * interval '1 day')`
        : // La lista muestra lo que viene: lo pasado se consulta por día.
          sql`m.scheduled_at >= now() - interval '2 hours'`

  const filas = await db.execute(sql`
    select m.id, m.scheduled_at, m.duration_minutes, m.type, m.status, m.notes,
           m.setter_id, u.name as setter_nombre,
           c.id as contact_id, c.business_name, c.ig_username, c.phone_e164
      from meetings m
      join contacts c on c.id = m.contact_id
      left join setters s on s.id = m.setter_id
      left join users u on u.id = s.user_id
     where ${ventana}
       ${setterId ? sql`and m.setter_id = ${setterId}::uuid` : sql``}
     order by m.scheduled_at asc
     limit 400
  `)

  const limite = Date.now() + 86_400_000

  return (filas.rows as Array<{
    id: string
    scheduled_at: Date
    duration_minutes: number
    type: MeetingType
    status: MeetingStatus
    notes: string | null
    setter_id: string | null
    setter_nombre: string | null
    contact_id: string
    business_name: string
    ig_username: string | null
    phone_e164: string | null
  }>).map((f) => {
    const cuando = new Date(f.scheduled_at)
    return {
      id: f.id,
      contactId: f.contact_id,
      businessName: f.business_name,
      igUsername: f.ig_username,
      phoneE164: f.phone_e164,
      scheduledAt: cuando,
      durationMinutes: f.duration_minutes,
      type: f.type,
      status: f.status,
      notes: f.notes,
      setterId: f.setter_id,
      setterNombre: f.setter_nombre,
      inminente:
        cuando.getTime() >= Date.now() &&
        cuando.getTime() <= limite &&
        f.status !== 'cancelada' &&
        f.status !== 'hecha',
    }
  })
}
