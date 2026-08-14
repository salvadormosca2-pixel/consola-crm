import 'server-only'

import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'

import { db } from '@/db'
import type { ContactStage } from '@/db/enums'
import { contacts, messagingAccounts, settings } from '@/db/schema'
import { voiceSchema, VOICE_KEY, VOZ_VACIA, type PerfilDeVoz } from '@/lib/voice'

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
  cuentaCode: string | null
  cuentaLabel: string | null
  /** Conversación en Chatwoot, para abrir la bandeja directo ahí. */
  chatwootConversationId: number | null
}

export interface FiltrosContactos {
  busqueda?: string
  etapa?: string
  canal?: 'whatsapp' | 'instagram'
  rubro?: string
  ciudad?: string
  cuenta?: string
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
  if (filtros.cuenta) {
    condiciones.push(
      sql`(${contacts.assignedWaAccountId} = ${filtros.cuenta}
           or ${contacts.assignedIgAccountId} = ${filtros.cuenta})`,
    )
  }
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
      chatwootConversationId: contacts.chatwootConversationId,
      cuentaCode: messagingAccounts.code,
      cuentaLabel: messagingAccounts.label,
    })
    .from(contacts)
    .leftJoin(
      messagingAccounts,
      sql`${messagingAccounts.id} = coalesce(${contacts.assignedWaAccountId}, ${contacts.assignedIgAccountId})`,
    )
    .where(and(...condiciones))
    .orderBy(desc(contacts.score), asc(contacts.businessName))
    .limit(limite)

  return filas
}

/** Valores distintos para llenar los desplegables de los filtros. */
export async function opcionesDeFiltro(): Promise<{
  rubros: string[]
  ciudades: string[]
  cuentas: Array<{ id: string; code: string; label: string }>
}> {
  const [rubros, ciudades, cuentas] = await Promise.all([
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
    db
      .select({
        id: messagingAccounts.id,
        code: messagingAccounts.code,
        label: messagingAccounts.label,
      })
      .from(messagingAccounts)
      .orderBy(asc(messagingAccounts.code)),
  ])

  return {
    rubros: rubros.map((r) => r.v).filter((v): v is string => v !== null),
    ciudades: ciudades.map((c) => c.v).filter((v): v is string => v !== null),
    cuentas,
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
 * ¿Hay datos de demostración cargados?
 *
 * Se detecta por la marca que deja `npm run demo:cargar` en las notas de las
 * cuentas. Sirve para avisar en pantalla, así nadie confunde una demo con la
 * base real.
 */
export interface FilaRespondio extends FilaContacto {
  /** Lo último que dijo, para poder clasificar sin abrir la ficha. */
  ultimoMensaje: string | null
  /** Hace cuánto está esperando respuesta tuya, en horas. */
  esperandoHoras: number
}

/**
 * Bandeja de los que contestaron y todavía no clasifiqué.
 *
 * Ordenada por tiempo de espera: el que hace más que contestó y sigue sin
 * respuesta es el que más riesgo tiene de enfriarse.
 */
export async function listarRespondieron(soloSinClasificar = true): Promise<FilaRespondio[]> {
  const filtroEtapa = soloSinClasificar
    ? sql`c.stage = 'respondido'`
    : sql`c.received_count > 0`

  const filas = await db.execute(sql`
    select c.id, c.business_name, c.contact_name, c.phone_e164, c.has_whatsapp,
           c.ig_username, c.has_instagram, c.niche, c.city, c.bought,
           c.stage, c.score, c.sent_count, c.received_count,
           c.last_outbound_at, c.last_inbound_at, c.next_followup_at,
           c.chatwoot_conversation_id,
           a.code as cuenta_code, a.label as cuenta_label,
           ult.body as ultimo_mensaje,
           extract(epoch from (now() - coalesce(c.last_inbound_at, now()))) / 3600 as esperando
      from contacts c
      left join messaging_accounts a
        on a.id = coalesce(c.assigned_wa_account_id, c.assigned_ig_account_id)
      -- LATERAL en vez de subconsulta correlacionada: así usa
      -- messages_entrantes_idx en vez de recorrer messages por cada fila.
      left join lateral (
        select m.body from messages m
         where m.contact_id = c.id and m.direction = 'in'
         order by m.created_at desc limit 1
      ) ult on true
     where c.discarded_at is null and ${filtroEtapa}
     order by c.last_inbound_at asc nulls last
     limit 500
  `)

  return (filas.rows as Array<Record<string, unknown>>).map((f) => ({
    id: f.id as string,
    businessName: f.business_name as string,
    contactName: f.contact_name as string | null,
    phoneE164: f.phone_e164 as string | null,
    hasWhatsapp: f.has_whatsapp as boolean,
    igUsername: f.ig_username as string | null,
    hasInstagram: f.has_instagram as boolean,
    niche: f.niche as string | null,
    city: f.city as string | null,
    bought: f.bought as string | null,
    stage: f.stage as ContactStage,
    score: f.score as number,
    sentCount: f.sent_count as number,
    receivedCount: f.received_count as number,
    lastOutboundAt: f.last_outbound_at as Date | null,
    lastInboundAt: f.last_inbound_at as Date | null,
    nextFollowupAt: f.next_followup_at as Date | null,
    cuentaCode: f.cuenta_code as string | null,
    cuentaLabel: f.cuenta_label as string | null,
    chatwootConversationId: f.chatwoot_conversation_id as number | null,
    ultimoMensaje: f.ultimo_mensaje as string | null,
    esperandoHoras: Math.round(Number(f.esperando ?? 0)),
  }))
}

export async function contarSinClasificar(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.stage, 'respondido'), isNull(contacts.discardedAt)))
  return row?.n ?? 0
}

/** Perfil de voz guardado, o el vacío si nunca se cargó. */
export async function leerVoz(): Promise<PerfilDeVoz> {
  const [fila] = await db.select().from(settings).where(eq(settings.key, VOICE_KEY)).limit(1)
  if (!fila) return VOZ_VACIA
  const parsed = voiceSchema.safeParse(fila.value)
  return parsed.success ? parsed.data : VOZ_VACIA
}

export async function hayDatosDemo(): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messagingAccounts)
    .where(eq(messagingAccounts.notes, 'DEMO'))
  return (row?.n ?? 0) > 0
}
