import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import { horasHabilesEntre } from '@/lib/horas-habiles'
import { leerConfigSetters } from '@/server/setters/config'

/**
 * La cola de clasificación.
 *
 * Cuando un lead contesta la oferta, alguien tiene que decidir por dónde sigue:
 * si eso fue una objeción (tibio), ruido (silencio) o un sí (interesado). El
 * sistema no puede deducirlo de un texto libre — entre "cuánto sale" y "no me
 * interesa" hay un lead ganado y uno perdido, y equivocarse manda el mensaje
 * que no era.
 *
 * Hasta que alguien decida, el lead está **parado**. Es la espera más cara que
 * hay en toda la operación, porque no es un desconocido: es alguien que ya
 * habló y está del otro lado esperando respuesta. Por eso esta cola tiene su
 * propia pantalla y su propio reloj en vez de ser una pestaña más de la
 * bandeja.
 *
 * El reloj se cuenta en horas hábiles: uno que contestó a las once de la noche
 * no está atrasado a las tres de la mañana.
 */

export interface LeadSinClasificar {
  assignmentId: string
  contactId: string
  negocio: string
  igUsername: string
  rubro: string | null
  setterNombre: string
  respondidoAt: Date
  /** Lo que el setter anotó que dijo el lead. Es obligatorio al marcar. */
  nota: string | null
  /** Las últimas líneas del chat, de la más vieja a la más nueva. */
  hilo: Array<{ entrante: boolean; texto: string; cuando: Date }>
  horasEsperando: number
  /** Pasó el SLA: va en rojo. */
  atrasado: boolean
}

export interface ColaDeClasificacion {
  leads: LeadSinClasificar[]
  /** Horas hábiles del SLA, para poder decirlo en pantalla. */
  sla: number
  atrasados: number
}

export async function colaDeClasificacion(): Promise<ColaDeClasificacion> {
  const cfg = await leerConfigSetters()
  const ahora = new Date()

  const filas = await db.execute(sql`
    select la.id, la.contact_id, la.respondido_at, la.nota,
           c.business_name, c.ig_username, c.niche,
           u.name as setter_nombre,
           coalesce(h.hilo, '[]'::jsonb) as hilo
      from lead_assignments la
      join contacts c on c.id = la.contact_id
      join setters s on s.id = la.setter_id
      join users u on u.id = s.user_id
      /*
       * Las últimas líneas del chat, en una sola pasada. Sin el hilo delante,
       * clasificar es adivinar: la nota dice lo que el setter entendió, no lo
       * que el lead escribió.
       */
      left join lateral (
        select jsonb_agg(x order by x.sent_at asc) as hilo from (
          select m.direction, m.body, coalesce(m.sent_at, m.created_at) as sent_at
            from messages m
           where m.contact_id = c.id and m.undone_at is null
           order by coalesce(m.sent_at, m.created_at) desc
           limit 4
        ) x
      ) h on true
     where la.respondio_a = 'segundo'
       and la.clasificado_at is null
       and la.estado not in ('vencido', 'devuelto')
       and la.respondido_at is not null
     order by la.respondido_at asc
     limit 200
  `)

  const leads = (filas.rows as Array<{
    id: string
    contact_id: string
    respondido_at: Date
    nota: string | null
    business_name: string
    ig_username: string
    niche: string | null
    setter_nombre: string
    hilo: Array<{ direction: string; body: string; sent_at: string }> | null
  }>).map((f) => {
    const respondidoAt = new Date(f.respondido_at)
    const horas = horasHabilesEntre(respondidoAt, ahora)
    return {
      assignmentId: f.id,
      contactId: f.contact_id,
      negocio: f.business_name,
      igUsername: f.ig_username,
      rubro: f.niche,
      setterNombre: f.setter_nombre,
      respondidoAt,
      nota: f.nota,
      hilo: (f.hilo ?? []).map((m) => ({
        entrante: m.direction === 'in',
        texto: m.body,
        cuando: new Date(m.sent_at),
      })),
      horasEsperando: horas,
      atrasado: horas > cfg.horasParaClasificar,
    }
  })

  return {
    leads,
    sla: cfg.horasParaClasificar,
    atrasados: leads.filter((l) => l.atrasado).length,
  }
}

/** Cuántos están esperando. Para la campana y el tablero, sin traer la lista. */
export async function cuantosSinClasificar(): Promise<number> {
  const filas = await db.execute(sql`
    select count(*)::int as n
      from lead_assignments la
     where la.respondio_a = 'segundo'
       and la.clasificado_at is null
       and la.estado not in ('vencido', 'devuelto')
  `)
  return (filas.rows[0] as { n: number } | undefined)?.n ?? 0
}
