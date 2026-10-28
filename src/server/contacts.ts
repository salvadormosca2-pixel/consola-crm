import 'server-only'

import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'

import { db, type Db } from '@/db'
import type { ContactStage } from '@/db/enums'
import { contacts, events, messages } from '@/db/schema'

/**
 * Tope de filas que se traen de una. Si la base tiene más, la pantalla avisa
 * que está viendo un recorte: una lista cortada en silencio es peor que un
 * aviso, porque parece completa.
 */
export const LIMITE_LISTADO = 5000

export async function contarContactos(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(isNull(contacts.discardedAt))
  return row?.n ?? 0
}

export interface FilaContacto {
  id: string
  businessName: string
  contactName: string | null
  phoneE164: string | null
  hasWhatsapp: boolean
  igUsername: string | null
  hasInstagram: boolean
  niche: string | null
  city: string | null
  bought: string | null
  stage: ContactStage
  score: number
  sentCount: number
  receivedCount: number
  lastOutboundAt: Date | null
  lastInboundAt: Date | null
  nextFollowupAt: Date | null
  /** Si tiene fecha, está dado de baja. Se sigue mostrando, marcado. */
  discardedAt: Date | null
}

export interface FiltrosContactos {
  busqueda?: string
  etapa?: string
  canal?: 'whatsapp' | 'instagram'
  rubro?: string
  ciudad?: string
  respondieron?: 'si' | 'no'
  seguimiento?: 'vencido'
  /** 'si' = le mandé algo alguna vez, aunque después se haya dado de baja. */
  contactados?: 'si' | 'no'
  /** Por defecto vienen todos, de baja o no. */
  baja?: 'solo' | 'sin'
}

/**
 * Qué cuenta como "le hablamos alguna vez".
 *
 * Los contadores del contacto son el camino rápido, pero **no alcanzan**:
 * `vaciarElEquipo` deja en cero `sent_count` y en null `last_outbound_at` de
 * todos los leads que vuelven al pozo. Un negocio contactado antes de un
 * vaciado se vería como si nunca le hubiéramos escrito.
 *
 * El rastro que sí sobrevive es el mensaje: el vaciado borra `setter_sends`
 * pero no toca `messages`, y deshacer un envío no borra la fila, la sella con
 * `undone_at`. Por eso la autoridad acá es "hay un mensaje saliente vigente".
 *
 * Los contadores se siguen mirando igual, para que un envío del Despachador
 * cuente aunque la fila del mensaje no esté, y porque son gratis.
 */
const CONTACTADO = sql`(
  ${contacts.sentCount} > 0
  or ${contacts.lastOutboundAt} is not null
  or exists (
    select 1 from ${messages}
     where ${messages.contactId} = ${contacts.id}
       and ${messages.direction} = 'out'
       and ${messages.undoneAt} is null
  )
)`

/**
 * Lista de contactos con sus filtros combinables.
 *
 * Trae todo de una: con 1.000 contactos el payload es chico y la tabla filtra y
 * ordena en el cliente, que es lo que hace que los filtros respondan al
 * instante en vez de ir y volver al servidor con cada tecla.
 */
export async function listarContactos(
  filtros: FiltrosContactos = {},
  limite = LIMITE_LISTADO,
  cliente: Db = db,
): Promise<FilaContacto[]> {
  /*
   * Arranca sin ninguna condición a propósito. Antes esto empezaba con
   * `isNull(discardedAt)` y la pantalla escondía los dados de baja: un lead
   * que trabajé y descarté seguía en la base pero no había forma de verlo.
   * Ahora vienen todos y quien filtra es el que mira.
   */
  const condiciones: SQL[] = []

  if (filtros.etapa) condiciones.push(sql`${contacts.stage} = ${filtros.etapa}`)
  if (filtros.canal === 'whatsapp') condiciones.push(isNotNull(contacts.phoneE164))
  if (filtros.canal === 'instagram') condiciones.push(isNotNull(contacts.igUsername))
  if (filtros.rubro) condiciones.push(eq(contacts.niche, filtros.rubro))
  if (filtros.ciudad) condiciones.push(eq(contacts.city, filtros.ciudad))
  if (filtros.respondieron === 'si') condiciones.push(sql`${contacts.receivedCount} > 0`)
  if (filtros.respondieron === 'no') condiciones.push(sql`${contacts.receivedCount} = 0`)
  if (filtros.contactados === 'si') condiciones.push(CONTACTADO)
  if (filtros.contactados === 'no') condiciones.push(sql`not (${CONTACTADO})`)
  if (filtros.baja === 'solo') condiciones.push(isNotNull(contacts.discardedAt))
  if (filtros.baja === 'sin') condiciones.push(isNull(contacts.discardedAt))
  if (filtros.seguimiento === 'vencido') {
    condiciones.push(sql`${contacts.nextFollowupAt} is not null and ${contacts.nextFollowupAt} <= now()`)
  }
  if (filtros.busqueda && filtros.busqueda.trim().length > 0) {
    const q = `%${filtros.busqueda.trim().toLowerCase()}%`
    condiciones.push(
      sql`(lower(${contacts.businessName}) like ${q}
           or lower(coalesce(${contacts.contactName}, '')) like ${q}
           or coalesce(${contacts.phoneE164}, '') like ${q}
           or lower(coalesce(${contacts.igUsername}, '')) like ${q})`,
    )
  }

  const filas = await cliente
    .select({
      id: contacts.id,
      businessName: contacts.businessName,
      contactName: contacts.contactName,
      phoneE164: contacts.phoneE164,
      hasWhatsapp: contacts.hasWhatsapp,
      igUsername: contacts.igUsername,
      hasInstagram: contacts.hasInstagram,
      niche: contacts.niche,
      city: contacts.city,
      bought: contacts.bought,
      stage: contacts.stage,
      score: contacts.score,
      sentCount: contacts.sentCount,
      receivedCount: contacts.receivedCount,
      lastOutboundAt: contacts.lastOutboundAt,
      lastInboundAt: contacts.lastInboundAt,
      nextFollowupAt: contacts.nextFollowupAt,
      discardedAt: contacts.discardedAt,
    })
    .from(contacts)
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(contacts.score), asc(contacts.businessName))
    .limit(limite)

  return filas
}

/** Valores distintos para llenar los desplegables de los filtros. */
export async function opcionesDeFiltro(): Promise<{
  rubros: string[]
  ciudades: string[]
}> {
const [rubros, ciudades] = await Promise.all([
    db
      .selectDistinct({ v: contacts.niche })
      .from(contacts)
      .where(isNotNull(contacts.niche))
      .orderBy(asc(contacts.niche)),
    db
      .selectDistinct({ v: contacts.city })
      .from(contacts)
      .where(isNotNull(contacts.city))
      .orderBy(asc(contacts.city)),
  ])

  return {
    rubros: rubros.map((r) => r.v).filter((v): v is string => v !== null),
    ciudades: ciudades.map((c) => c.v).filter((v): v is string => v !== null),
  }
}

/**
 * Cuántos contactos hay en cada etapa, para las pastillas de arriba.
 *
 * Cuenta también los dados de baja, porque la tabla de abajo ahora los muestra:
 * si las pastillas los dejaran afuera, los números no sumarían al total.
 */
export async function contarPorEtapa(): Promise<Record<string, number>> {
  const filas = await db
    .select({ stage: contacts.stage, n: sql<number>`count(*)::int` })
    .from(contacts)
    .groupBy(contacts.stage)

  return Object.fromEntries(filas.map((f) => [f.stage, f.n]))
}

/**
 * Cuántos contestaron y todavía no clasifiqué.
 *
 * Es el número del globito en la navegación. La bandeja en sí vive en
 * el control de seguimientos del panel, que la abre por setter.
 */
export async function contarSinClasificar(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.stage, 'respondido'), isNull(contacts.discardedAt)))
  return row?.n ?? 0
}



/* ── Volver a tirarlos al pozo ─────────────────────────────────────────── */

export interface ResumenDelPozo {
  /** Cuántos quedaron en 'nuevo', listos para el próximo reparto. */
  tirados: number
  /** Cuántos no se pueden tocar: 'no contactar' o perfil inexistente. */
  saltados: number
  /** De los tirados, cuántos estaban dados de baja y volvieron a circulación. */
  revividos: number
}

/**
 * Devuelve contactos al pozo para hablarlos de nuevo.
 *
 * Es la misma decisión que ya toma `vaciarElEquipo` cuando cambia el equipo o
 * el guion —toda la lista se vuelve a trabajar desde el principio— pero a
 * pedido y sobre los contactos que se le pasen, sin borrar ningún setter.
 *
 * Tres cosas que no son obvias y son el centro de esto:
 *
 *   1. **Primero se libera la asignación activa.** `lead_assignments_activo_uq`
 *      permite como máximo una asignación por contacto que no haya vuelto al
 *      pozo. Si no se marca 'devuelto' la anterior, el próximo reparto no puede
 *      asignarlo: el lead queda en 'nuevo' y no lo trabaja nadie nunca.
 *   2. **`sent_count` y `last_outbound_at` no se tocan.** Son el registro de
 *      que ya recibió mensajes; borrarlos sería mentir sobre lo que pasó, y es
 *      además lo que lo mantiene en la pantalla de Hablados.
 *   3. **'No contactar' no vuelve nunca.** Es la única etapa que es una
 *      decisión sobre la persona y no sobre el lead. Los perfiles inexistentes
 *      tampoco: escribirle de nuevo a una cuenta que no existe gasta cupo al
 *      aire.
 */
export async function devolverAlPozoEnLote(
  ids: string[],
  actorUserId: string | null,
  cliente: Db = db,
): Promise<ResumenDelPozo> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return { tirados: 0, saltados: 0, revividos: 0 }

  const lista = sql.join(
    unicos.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

  const elegibles = await cliente.execute(sql`
    select c.id, c.stage, (c.discarded_at is not null) as de_baja
      from contacts c
     where c.id in (${lista})
       and c.stage <> 'no_contactar'
       and not exists (
         select 1 from lead_assignments la
          where la.contact_id = c.id and la.estado = 'cuenta_inexistente'
       )
  `)

  const filas = elegibles.rows as Array<{ id: string; stage: ContactStage; de_baja: boolean }>
  const saltados = unicos.length - filas.length
  if (filas.length === 0) return { tirados: 0, saltados, revividos: 0 }

  const elegidos = sql.join(
    filas.map((f) => sql`${f.id}::uuid`),
    sql`, `,
  )

  await cliente.transaction(async (tx) => {
    // 1. Liberar la asignación activa, si la hay. Sin esto no se reasignan.
    await tx.execute(sql`
      update lead_assignments
         set estado = 'devuelto', devuelto_at = now(),
             devuelto_motivo = 'Se lo tira al pozo de nuevo para hablarlo otra vez.',
             marcado_por = ${actorUserId}::uuid
       where contact_id in (${elegidos})
         and estado not in ('vencido', 'devuelto')
    `)

    // 2. El contacto vuelve a arrancar el recorrido, sin perder su historia.
    await tx.execute(sql`
      update contacts
         set stage = 'nuevo',
             sequence_step = 0,
             next_followup_at = null,
             discarded_at = null,
             updated_at = now()
       where id in (${elegidos})
    `)

    // 3. Un evento por contacto, para saber de qué etapa volvió cada uno.
    for (let i = 0; i < filas.length; i += 500) {
      await tx.insert(events).values(
        filas.slice(i, i + 500).map((f) => ({
          type: 'etapa_cambiada',
          contactId: f.id,
          actorUserId,
          payload: { desde: f.stage, hasta: 'nuevo', motivo: 'tirado_al_pozo' },
        })),
      )
    }
  })

  return {
    tirados: filas.length,
    saltados,
    revividos: filas.filter((f) => f.de_baja).length,
  }
}
