import 'server-only'

import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'

import { db, type Db } from '@/db'
import type { ContactStage } from '@/db/enums'
import { contacts, messages } from '@/db/schema'

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


