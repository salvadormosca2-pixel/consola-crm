import 'server-only'

import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'

import { db } from '@/db'
import type { ContactStage } from '@/db/enums'
import { contacts } from '@/db/schema'

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
}

export interface FiltrosContactos {
  busqueda?: string
  etapa?: string
  canal?: 'whatsapp' | 'instagram'
  rubro?: string
  ciudad?: string
  respondieron?: 'si' | 'no'
  seguimiento?: 'vencido'
}

/**
 * Lista de contactos con sus filtros combinables.
 *
 * Trae todo de una: con 1.000 contactos el payload es chico y la tabla filtra y
 * ordena en el cliente, que es lo que hace que los filtros respondan al
 * instante en vez de ir y volver al servidor con cada tecla.
 */
export async function listarContactos(
  filtros: FiltrosContactos = {},
  limite = 5000,
): Promise<FilaContacto[]> {
  const condiciones: SQL[] = [isNull(contacts.discardedAt)]

  if (filtros.etapa) condiciones.push(sql`${contacts.stage} = ${filtros.etapa}`)
  if (filtros.canal === 'whatsapp') condiciones.push(isNotNull(contacts.phoneE164))
  if (filtros.canal === 'instagram') condiciones.push(isNotNull(contacts.igUsername))
  if (filtros.rubro) condiciones.push(eq(contacts.niche, filtros.rubro))
  if (filtros.ciudad) condiciones.push(eq(contacts.city, filtros.ciudad))
  if (filtros.respondieron === 'si') condiciones.push(sql`${contacts.receivedCount} > 0`)
  if (filtros.respondieron === 'no') condiciones.push(sql`${contacts.receivedCount} = 0`)
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

  const filas = await db
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
    })
    .from(contacts)
    .where(and(...condiciones))
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
      .where(and(isNotNull(contacts.niche), isNull(contacts.discardedAt)))
      .orderBy(asc(contacts.niche)),
    db
      .selectDistinct({ v: contacts.city })
      .from(contacts)
      .where(and(isNotNull(contacts.city), isNull(contacts.discardedAt)))
      .orderBy(asc(contacts.city)),
  ])

  return {
    rubros: rubros.map((r) => r.v).filter((v): v is string => v !== null),
    ciudades: ciudades.map((c) => c.v).filter((v): v is string => v !== null),
  }
}

/** Cuántos contactos hay en cada etapa, para las pastillas de arriba. */
export async function contarPorEtapa(): Promise<Record<string, number>> {
  const filas = await db
    .select({ stage: contacts.stage, n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(isNull(contacts.discardedAt))
    .groupBy(contacts.stage)

  return Object.fromEntries(filas.map((f) => [f.stage, f.n]))
}

/**
 * Cuántos contestaron y todavía no clasifiqué.
 *
 * Es el número del globito en la navegación. La bandeja en sí vive en
 * `@/server/setters/respuestas`, que la abre por setter y por clasificación.
 */
export async function contarSinClasificar(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.stage, 'respondido'), isNull(contacts.discardedAt)))
  return row?.n ?? 0
}


