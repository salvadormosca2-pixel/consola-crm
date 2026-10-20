import 'server-only'

import { sql } from 'drizzle-orm'

import { db, type Ejecutor } from '@/db'
import { esPaso, PASO_META, PASOS_DE_PISTA, type Paso } from '@/lib/pistas'
import { textoPorDefecto, type SettersConfig } from '@/lib/setters-config'
import { leerConfigSetters } from '@/server/setters/config'
import { PASOS_VIGENTES } from '@/server/setters/pasos'

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
 * **Dos niveles, y el de arriba gana:** el texto escrito para ese lead, y si no
 * tiene, el general de su paso (en la configuración). Con los dos vacíos el
 * lead aparece bloqueado en la cola del setter, con el motivo a la vista.
 *
 * El general existe porque sin él nadie podía mandar nada hasta que el admin
 * escribiera un mensaje por cada lead: con cuarenta leads nuevos por día, eso
 * es la operación entera parada. Lo que no vuelve son las plantillas con
 * `{{negocio}}`: el general es texto plano, igual para todos, y lo que diga
 * algo de ese negocio se escribe lead por lead.
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
  | { ok: true; texto: string; propio: boolean }
  | { ok: false; motivo: string }

/**
 * El texto de un lead en un paso, o por qué no se puede mandar.
 *
 * **Dos niveles, y el de arriba gana:** el que se escribió para ese lead, y si
 * no tiene, el de por defecto de su paso. Sin ninguno de los dos el lead queda
 * bloqueado, porque nunca sale un mensaje que nadie escribió.
 *
 * El motivo se escribe pensando en el setter, que es quien lo lee en el
 * celular y no puede resolverlo: lo único que puede hacer es saltear el lead y
 * seguir con el siguiente.
 */
export function elegirTexto(
  textos: Map<number, TextoDeLead> | undefined,
  paso: Paso,
  cfg: SettersConfig,
): MensajeArmado {
  const propio = textos?.get(paso)
  if (propio) return { ok: true, texto: propio.body, propio: true }

  const general = textoPorDefecto(cfg, paso)
  if (general) return { ok: true, texto: general, propio: false }

  return {
    ok: false,
    motivo: `Todavía no hay texto para "${PASO_META[paso].label}": ni el de este lead ni el general.`,
  }
}

/**
 * El mensaje de un lead, armado en el servidor.
 *
 * Se lee acá y no se confía en lo que manda el celular: si el cliente pudiera
 * elegir el cuerpo, un texto viejo cacheado en un teléfono seguiría saliendo
 * después de que el admin lo reescribió.
 */
export type MensajeDeAsignacion =
  | { ok: true; texto: string; contactId: string; paso: Paso; propio: boolean }
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

  if (f.body !== null) {
    return { ok: true, texto: f.body, contactId: f.contact_id, paso, propio: true }
  }

  /* Sin texto propio sale el general del paso, que es lo que destraba la cola
     cuando hay cuarenta leads nuevos y nadie llegó a escribirles uno a uno. */
  const cfg = await leerConfigSetters()
  const general = textoPorDefecto(cfg, paso)
  if (general) {
    return { ok: true, texto: general, contactId: f.contact_id, paso, propio: false }
  }

  return {
    ok: false,
    motivo: `Todavía no hay texto para "${PASO_META[paso].label}": ni el de este lead ni el general.`,
  }
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
  /**
   * El general de ese paso, que es lo que va a salir si no se le escribe uno
   * propio. Se muestra debajo del campo: sin eso, el admin no sabe si dejar la
   * fila vacía significa "no sale nada" o "sale el de siempre".
   */
  general: string | null
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
  /** Cuántos no tienen un texto propio. Les va a salir el general. */
  sinEscribir: number
  /**
   * Cuántos están **bloqueados**: sin texto propio y sin general. Son los
   * únicos que el setter no puede mandar, así que son los que importan.
   */
  bloqueados: number
  /** Los textos generales de cada paso, para poder escribirlos en la pantalla. */
  generales: Array<{ paso: Paso; label: string; body: string | null; cuando: string }>
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
export async function colaDeTextos(cliente: Ejecutor = db): Promise<ColaDeTextos> {
  const cfg = await leerConfigSetters()
  const filas = await cliente.execute(sql`
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
       -- Un paso retirado no se puede escribir: esta pantalla no lo ofrece.
       and p.paso in (${PASOS_VIGENTES})
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
      general: textoPorDefecto(cfg, paso),
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
    bloqueados: leads.filter((l) => l.body === null && l.general === null).length,
    generales: PASOS_DE_PISTA.map((paso) => ({
      paso,
      label: PASO_META[paso].label,
      cuando: PASO_META[paso].cuando,
      body: textoPorDefecto(cfg, paso),
    })),
  }
}

/**
 * Cuántos leads están **bloqueados**: sin texto propio y sin uno general para
 * su paso. Es el número del tablero, y es el único que exige una acción: los
 * que tienen general salen igual.
 */
export async function cuantosSinTexto(cliente: Ejecutor = db): Promise<number> {
  const cfg = await leerConfigSetters()

  /* Los pasos que ya tienen un texto general no bloquean a nadie. Si todos lo
     tienen, no hace falta ni mirar la tabla. */
  const conGeneral = PASOS_DE_PISTA.filter((p) => textoPorDefecto(cfg, p) !== null)
  if (conGeneral.length === PASOS_DE_PISTA.length) return 0

  const lista = sql.join(
    conGeneral.map((p) => sql`${p}`),
    sql`, `,
  )

  const filas = await cliente.execute(sql`
    select count(*)::int as n
      from lead_assignments la
      cross join lateral (
        select case when la.estado in ('asignado', 'abierto', 'saltado') then 1
                    else coalesce(la.proximo_paso, 1) end as paso
      ) p
     where la.estado in ('asignado', 'abierto', 'saltado', 'calificado')
       and (la.estado in ('asignado', 'abierto', 'saltado') or la.proximo_paso is not null)
       and p.paso in (${PASOS_VIGENTES})
       ${conGeneral.length > 0 ? sql`and p.paso not in (${lista})` : sql``}
       and not exists (
         select 1 from lead_textos lt
          where lt.assignment_id = la.id and lt.paso = p.paso
       )
  `)
  return (filas.rows[0] as { n: number } | undefined)?.n ?? 0
}
