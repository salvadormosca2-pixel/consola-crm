import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import { esPaso, PASO_META, type Paso } from '@/lib/pistas'

/**
 * El texto que el setter copia y pega.
 *
 * **Uno por lead y por paso, escrito a mano por el admin.** No hay plantillas,
 * no hay variables, no hay versión por rubro: cada negocio recibe un mensaje
 * pensado para él.
 *
 * Antes esto salía de `templates`: un texto por paso con `{{negocio}}` adentro,
 * el mismo para los mil leads de la lista. Servía para mandar mucho, que es
 * justo lo que hace que una cuenta quede restringida y lo que hace que nadie
 * conteste. Escribirlos uno por uno cuesta tiempo del admin, y ese es el precio
 * que se decidió pagar.
 *
 * **Sin texto no sale nada.** El lead aparece en la cola del setter bloqueado,
 * con el motivo a la vista, y del otro lado aparece en la pantalla de Textos
 * esperando que alguien lo escriba. Nunca se completa ni se sugiere nada: un
 * mensaje a medias mandado desde la cuenta personal de alguien no se puede
 * deshacer.
 */

export interface TextoDeLead {
  assignmentId: string
  paso: Paso
  body: string
  escritoAt: Date
}

interface FilaTexto {
  assignment_id: string
  paso: number
  body: string
  updated_at: Date
}

/**
 * Los textos de varios leads de una, indexados por asignación y paso.
 *
 * La cola del setter trae treinta leads y cada uno está en un paso distinto:
 * una consulta por lead son treinta viajes a la base para pintar una pantalla
 * que se abre veinte veces por día.
 */
export async function leerTextos(
  assignmentIds: readonly string[],
): Promise<Map<string, Map<number, TextoDeLead>>> {
  const salida = new Map<string, Map<number, TextoDeLead>>()
  if (assignmentIds.length === 0) return salida

  const filas = await db.execute(sql`
    select assignment_id, paso, body, updated_at
      from lead_textos
     where assignment_id in (${sql.join(
       assignmentIds.map((i) => sql`${i}::uuid`),
       sql`, `,
     )})
  `)

  for (const f of filas.rows as unknown as FilaTexto[]) {
    const delLead = salida.get(f.assignment_id) ?? new Map<number, TextoDeLead>()
    salida.set(f.assignment_id, delLead)
    delLead.set(f.paso, {
      assignmentId: f.assignment_id,
      paso: f.paso as Paso,
      body: f.body,
      escritoAt: new Date(f.updated_at),
    })
  }

  return salida
}

export type MensajeArmado =
  | { ok: true; texto: string }
  | { ok: false; motivo: string }

/**
 * El texto de un lead en un paso, o por qué no se puede mandar.
 *
 * El motivo se escribe pensando en el setter, que es quien lo lee en el
 * celular y no puede resolverlo: lo único que puede hacer es saltear el lead y
 * seguir con el siguiente.
 */
export function elegirTexto(
  textos: Map<number, TextoDeLead> | undefined,
  paso: Paso,
): MensajeArmado {
  const texto = textos?.get(paso)
  if (!texto) {
    return {
      ok: false,
      motivo: `Falta el texto de "${PASO_META[paso].label}" para este lead. Lo está escribiendo el admin.`,
    }
  }
  return { ok: true, texto: texto.body }
}

/**
 * El mensaje de un lead, armado en el servidor.
 *
 * Se lee acá y no se confía en lo que manda el celular: si el cliente pudiera
 * elegir el cuerpo, un texto viejo cacheado en un teléfono seguiría saliendo
 * después de que el admin lo reescribió.
 */
export type MensajeDeAsignacion =
  | { ok: true; texto: string; contactId: string; paso: Paso }
  | { ok: false; motivo: string }

export async function mensajeDeAsignacion(
  assignmentId: string,
  setterId: string,
): Promise<MensajeDeAsignacion> {
  const filas = await db.execute(sql`
    select la.contact_id, la.proximo_paso, la.proximo_seguimiento_at,
           t.body
      from lead_assignments la
      left join lateral (
        select lt.body from lead_textos lt
         where lt.assignment_id = la.id
           and lt.paso = case
                 when la.proximo_seguimiento_at is not null
                  and la.proximo_seguimiento_at <= now()
                 then coalesce(la.proximo_paso, 1) else 1 end
         limit 1
      ) t on true
     where la.id = ${assignmentId}::uuid and la.setter_id = ${setterId}::uuid
     limit 1
  `)

  const f = filas.rows[0] as
    | {
        contact_id: string
        proximo_paso: number | null
        proximo_seguimiento_at: Date | null
        body: string | null
      }
    | undefined

  if (!f) return { ok: false, motivo: 'Ese lead ya no es tuyo.' }

  /*
   * El paso lo decide el servidor mirando lo que el lead tiene programado, no
   * el celular: si tiene un seguimiento vencido le toca ese, y si no, el
   * primer mensaje.
   */
  const leToca =
    f.proximo_seguimiento_at !== null && new Date(f.proximo_seguimiento_at).getTime() <= Date.now()
  const crudo = leToca ? (f.proximo_paso ?? 1) : 1
  const paso: Paso = esPaso(crudo) ? crudo : 1

  if (f.body === null) {
    return {
      ok: false,
      motivo: `Falta el texto de "${PASO_META[paso].label}" para este lead. Lo está escribiendo el admin.`,
    }
  }

  return { ok: true, texto: f.body, contactId: f.contact_id, paso }
}

/**
 * Links del perfil. `ig.me` abre el chat directo en la app de Instagram; el
 * otro abre el perfil, y es el respaldo para cuando el primero no resuelve.
 *
 * No existe forma de precargar el texto de un DM de Instagram: por eso el
 * mensaje va al portapapeles y el setter pega. Es semi-automático a propósito.
 */
export function linksDeInstagram(usuario: string): { linkDirecto: string; linkRespaldo: string } {
  const limpio = usuario.replace(/^@/, '').trim()
  return {
    linkDirecto: `https://ig.me/m/${limpio}`,
    linkRespaldo: `https://www.instagram.com/${limpio}/`,
  }
}

/* ── La cola del admin: los leads esperando su texto ──────────────────── */

export interface LeadEsperandoTexto {
  assignmentId: string
  contactId: string
  negocio: string
  igUsername: string
  rubro: string | null
  ciudad: string | null
  nombreDePersona: string | null
  setterNombre: string
  /** Qué mensaje hay que escribirle. */
  paso: Paso
  /** Cómo se llama ese paso, ya resuelto para no repetirlo en la pantalla. */
  pasoLabel: string
  /** El texto que ya está escrito, si lo hay. Se abre para editarlo. */
  body: string | null
  /** Lo que anotó el setter al calificarlo. Es con lo que se escribe. */
  nota: string | null
  /** Cuándo le toca salir. En el primer mensaje, cuándo vence el lead. */
  cuando: Date | null
  /** Las últimas líneas del chat, de la más vieja a la más nueva. */
  hilo: Array<{ entrante: boolean; texto: string; cuando: Date }>
}

export interface ColaDeTextos {
  /** Leads asignados que todavía no recibieron el primer mensaje. */
  primerMensaje: LeadEsperandoTexto[]
  /** Leads calificados a los que les toca un escalón del seguimiento. */
  seguimiento: LeadEsperandoTexto[]
  /** Cuántos de los de arriba no tienen una sola letra escrita. */
  sinEscribir: number
}

/**
 * Los leads que están esperando que yo escriba su mensaje.
 *
 * Es la pantalla que reemplaza a la de plantillas, y tiene una diferencia de
 * fondo: antes se escribían seis textos y servían para siempre; ahora se
 * escribe uno por lead, así que la pantalla no es un formulario sino una cola
 * de trabajo. Por eso ordena por urgencia —el que está por vencer y el que
 * tiene el seguimiento más atrasado van arriba— y muestra el hilo al lado del
 * campo: no se puede escribirle a alguien sin leer lo que dijo.
 *
 * Los que ya tienen texto escrito también aparecen, abajo de los que no: el
 * texto se puede corregir hasta que sale.
 */
export async function colaDeTextos(): Promise<ColaDeTextos> {
  const filas = await db.execute(sql`
    select la.id, la.contact_id, la.estado, la.nota, la.vence_at,
           la.proximo_seguimiento_at, p.paso,
           c.business_name, c.ig_username, c.niche, c.city, c.contact_name,
           u.name as setter_nombre,
           t.body,
           coalesce(h.hilo, '[]'::jsonb) as hilo
      from lead_assignments la
      join contacts c on c.id = la.contact_id
      join setters s on s.id = la.setter_id
      join users u on u.id = s.user_id
      /* El paso que hay que escribirle: el primero si todavía no lo recibió,
         y si no, el escalón que tiene programado. */
      cross join lateral (
        select case when la.estado in ('asignado', 'abierto', 'saltado') then 1
                    else coalesce(la.proximo_paso, 1) end as paso
      ) p
      left join lateral (
        select lt.body from lead_textos lt
         where lt.assignment_id = la.id and lt.paso = p.paso
         limit 1
      ) t on true
      left join lateral (
        select jsonb_agg(x order by x.sent_at asc) as hilo from (
          select m.direction, m.body, coalesce(m.sent_at, m.created_at) as sent_at
            from messages m
           where m.contact_id = c.id and m.undone_at is null
           order by coalesce(m.sent_at, m.created_at) desc
           limit 4
        ) x
      ) h on true
     where la.estado in ('asignado', 'abierto', 'saltado', 'calificado')
       and (la.estado in ('asignado', 'abierto', 'saltado') or la.proximo_paso is not null)
     order by t.body is not null asc,
              coalesce(la.proximo_seguimiento_at, la.vence_at) asc
     limit 300
  `)

  const leads = (filas.rows as Array<{
    id: string
    contact_id: string
    estado: string
    nota: string | null
    vence_at: Date
    paso: number
    proximo_seguimiento_at: Date | null
    business_name: string
    ig_username: string
    niche: string | null
    city: string | null
    contact_name: string | null
    setter_nombre: string
    body: string | null
    hilo: Array<{ direction: string; body: string; sent_at: string }> | null
  }>).map((f) => {
    const crudo = Number(f.paso)
    const paso: Paso = esPaso(crudo) ? crudo : 1
    return {
      assignmentId: f.id,
      contactId: f.contact_id,
      negocio: f.business_name,
      igUsername: f.ig_username,
      rubro: f.niche,
      ciudad: f.city,
      nombreDePersona: f.contact_name,
      setterNombre: f.setter_nombre,
      paso,
      pasoLabel: PASO_META[paso].label,
      body: f.body,
      nota: f.nota,
      cuando: f.proximo_seguimiento_at
        ? new Date(f.proximo_seguimiento_at)
        : f.vence_at
          ? new Date(f.vence_at)
          : null,
      hilo: (f.hilo ?? []).map((m) => ({
        entrante: m.direction === 'in',
        texto: m.body,
        cuando: new Date(m.sent_at),
      })),
      esPrimero: f.estado !== 'calificado',
    }
  })

  return {
    primerMensaje: leads.filter((l) => l.esPrimero),
    seguimiento: leads.filter((l) => !l.esPrimero),
    sinEscribir: leads.filter((l) => l.body === null).length,
  }
}

/** Cuántos leads están esperando texto. Para la campana y el tablero. */
export async function cuantosSinTexto(): Promise<number> {
  const filas = await db.execute(sql`
    select count(*)::int as n
      from lead_assignments la
      cross join lateral (
        select case when la.estado in ('asignado', 'abierto', 'saltado') then 1
                    else coalesce(la.proximo_paso, 1) end as paso
      ) p
     where la.estado in ('asignado', 'abierto', 'saltado', 'calificado')
       and (la.estado in ('asignado', 'abierto', 'saltado') or la.proximo_paso is not null)
       and not exists (
         select 1 from lead_textos lt
          where lt.assignment_id = la.id and lt.paso = p.paso
       )
  `)
  return (filas.rows[0] as { n: number } | undefined)?.n ?? 0
}
