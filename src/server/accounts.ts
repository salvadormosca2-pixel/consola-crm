import 'server-only'

import { asc, eq, sql } from 'drizzle-orm'

import { db } from '@/db'
import type { Salud } from '@/db/enums'
import { contacts, messagingAccounts } from '@/db/schema'
import type { LecturaCuenta } from '@/components/cap-meter'
import { diasDeCalentamiento, OPS_CONFIG_DEFAULT } from '@/lib/ops-config'
import { opsDate, OPS_TZ } from '@/lib/tz'
import { diagnosticar } from '@/server/rotation/health'
import { cupoEfectivo, faltantesDePreparacion, type CuentaParaCupo } from '@/server/rotation/quota'

/**
 * Cupo del día de una cuenta.
 *
 * Delega en la lógica de rotación: el cupo de un número que calienta sale de la
 * escala configurable, no de una columna por cuenta, y tiene que dar lo mismo
 * acá que en la transacción de reserva.
 */
export function capEfectivo(a: Pick<CuentaParaCupo, 'status' | 'dailyCap' | 'warmupDay'>): number {
  return cupoEfectivo(
    { ...a, minGapSeconds: 0, windowStart: '00:00', windowEnd: '23:59' },
    OPS_CONFIG_DEFAULT,
  )
}

/**
 * Lecturas para el medidor de cupo.
 * `sentToday` solo cuenta si `counterDate` es la fecha operativa de hoy en
 * Catamarca; si quedó de ayer, la cuenta arranca en cero sin necesidad de un
 * job de reinicio.
 */
export async function leerCupos(): Promise<LecturaCuenta[]> {
  const hoy = opsDate()
  const filas = await db
    .select({
      id: messagingAccounts.id,
      code: messagingAccounts.code,
      label: messagingAccounts.label,
      channel: messagingAccounts.channel,
      status: messagingAccounts.status,
      dailyCap: messagingAccounts.dailyCap,
      warmupDay: messagingAccounts.warmupDay,
      sentToday: messagingAccounts.sentToday,
      counterDate: messagingAccounts.counterDate,
    })
    .from(messagingAccounts)
    .orderBy(asc(messagingAccounts.channel), asc(messagingAccounts.code))

  return filas.map((a) => ({
    id: a.id,
    code: a.code,
    label: a.label,
    channel: a.channel,
    status: a.status,
    cap: capEfectivo(a),
    enviados: a.counterDate === hoy ? a.sentToday : 0,
  }))
}

export interface FilaCuenta extends LecturaCuenta {
  phoneE164: string | null
  igUsername: string | null
  mode: 'api' | 'manual'
  dailyCap: number
  warmupDay: number | null
  /** Cuántos días tiene la escala de calentamiento configurada. */
  warmupTotal: number
  warmupRepeats: number
  minGapSeconds: number
  windowStart: string
  windowEnd: string
  instanceName: string | null
  sessionHint: string | null
  /** Claves del checklist ya marcadas. */
  prepChecklist: string[]
  /** Puntos del checklist que faltan. Vacío = lista para entrar al reparto. */
  faltaPreparacion: string[]
  consecutiveFailures: number
  lastSentAt: Date | null
  salud: Salud
  saludMotivo: string
  /** Tasa de respuesta de los últimos 7 días. null si no hay muestra. */
  tasaRespuesta7d: number | null
  notes: string | null
  /** Contactos con esta cuenta asignada. */
  asignados: number
  /** De esos, a cuántos ya se les mandó al menos un mensaje. */
  contactados: number
  /** Los que todavía esperan el primer mensaje. */
  pendientes: number
  /** Días hasta terminar la lista al ritmo del cupo actual. null si no aplica. */
  diasDeCola: number | null
}

/**
 * Panel de cuentas con la vista de distribución: cuántos contactos tiene cada
 * una asignados, cuántos ya contactó, cuántos le quedan y en cuántos días
 * termina su lista al ritmo del cupo.
 */
export async function listarCuentas(): Promise<FilaCuenta[]> {
  const hoy = opsDate()

  // La asignación es por canal: los contactos de WhatsApp cuelgan de
  // assigned_wa_account_id y los de Instagram de assigned_ig_account_id.
  const asignadoA = sql<string>`case
    when ${messagingAccounts.channel} = 'whatsapp' then ${contacts.assignedWaAccountId}
    else ${contacts.assignedIgAccountId} end`

  const filas = await db
    .select({
      id: messagingAccounts.id,
      code: messagingAccounts.code,
      label: messagingAccounts.label,
      channel: messagingAccounts.channel,
      status: messagingAccounts.status,
      mode: messagingAccounts.mode,
      phoneE164: messagingAccounts.phoneE164,
      igUsername: messagingAccounts.igUsername,
      instanceName: messagingAccounts.instanceName,
      sessionHint: messagingAccounts.sessionHint,
      prepChecklist: messagingAccounts.prepChecklist,
      dailyCap: messagingAccounts.dailyCap,
      warmupDay: messagingAccounts.warmupDay,
      warmupRepeats: messagingAccounts.warmupRepeats,
      consecutiveFailures: messagingAccounts.consecutiveFailures,
      lastSentAt: messagingAccounts.lastSentAt,
      minGapSeconds: messagingAccounts.minGapSeconds,
      windowStart: messagingAccounts.windowStart,
      windowEnd: messagingAccounts.windowEnd,
      sentToday: messagingAccounts.sentToday,
      counterDate: messagingAccounts.counterDate,
      notes: messagingAccounts.notes,
      asignados: sql<number>`count(${contacts.id})::int`,
      contactados: sql<number>`count(${contacts.id}) filter (where ${contacts.sentCount} > 0)::int`,
    })
    .from(messagingAccounts)
    .leftJoin(
      contacts,
      sql`${asignadoA} = ${messagingAccounts.id} and ${contacts.discardedAt} is null`,
    )
    .groupBy(messagingAccounts.id)
    .orderBy(asc(messagingAccounts.channel), asc(messagingAccounts.code))

  const salud = await leerSenalesDeSalud()

  return filas.map((a) => {
    const cap = capEfectivo(a)
    const pendientes = Math.max(a.asignados - a.contactados, 0)
    const operativa = a.status === 'activa' || a.status === 'calentando'
    const s = salud.get(a.id)
    const enviados7d = s?.enviados7d ?? 0
    const respondidos7d = s?.respondidos7d ?? 0

    const diag = diagnosticar({
      status: a.status,
      consecutiveFailures: a.consecutiveFailures,
      enviados7d,
      respondidos7d,
      tasaHistorica: s?.tasaHistorica ?? null,
      diasDeUso: s?.diasDeUso ?? 0,
    })

    const marcados = Object.entries((a.prepChecklist ?? {}) as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => k)

    return {
      id: a.id,
      code: a.code,
      label: a.label,
      channel: a.channel,
      status: a.status,
      mode: a.mode,
      phoneE164: a.phoneE164,
      igUsername: a.igUsername,
      instanceName: a.instanceName,
      sessionHint: a.sessionHint,
      prepChecklist: marcados,
      faltaPreparacion: faltantesDePreparacion(a.prepChecklist),
      cap,
      dailyCap: a.dailyCap,
      warmupDay: a.warmupDay,
      warmupTotal: diasDeCalentamiento(OPS_CONFIG_DEFAULT),
      warmupRepeats: a.warmupRepeats,
      consecutiveFailures: a.consecutiveFailures,
      lastSentAt: a.lastSentAt,
      salud: diag.salud,
      saludMotivo: diag.motivo,
      tasaRespuesta7d: enviados7d >= 10 ? respondidos7d / enviados7d : null,
      minGapSeconds: a.minGapSeconds,
      windowStart: a.windowStart,
      windowEnd: a.windowEnd,
      notes: a.notes,
      enviados: a.counterDate === hoy ? a.sentToday : 0,
      asignados: a.asignados,
      contactados: a.contactados,
      pendientes,
      diasDeCola: operativa && cap > 0 && pendientes > 0 ? Math.ceil(pendientes / cap) : null,
    }
  })
}

interface SenalesPorCuenta {
  enviados7d: number
  respondidos7d: number
  tasaHistorica: number | null
  diasDeUso: number
}

/**
 * Señales para el semáforo de salud, calculadas desde `messages`.
 *
 * "Respondido" es un saliente que tiene al menos un entrante posterior del mismo
 * contacto: es lo que de verdad indica que el número está sano, más que
 * cualquier estado de entrega.
 */
async function leerSenalesDeSalud(): Promise<Map<string, SenalesPorCuenta>> {
  const r = await db.execute(sql`
    with salientes as (
      select m.id, m.account_id, m.contact_id, m.sent_at,
             exists (
               select 1 from messages i
                where i.contact_id = m.contact_id
                  and i.direction = 'in'
                  and i.created_at > m.sent_at
             ) as respondido
        from messages m
       where m.direction = 'out'
         and m.status in ('enviado','entregado','leido','respondido')
         and m.undone_at is null
         and m.sent_at is not null
         and m.account_id is not null
    )
    select account_id,
           count(*) filter (where sent_at > now() - interval '7 days')::int as enviados7d,
           count(*) filter (where sent_at > now() - interval '7 days' and respondido)::int as respondidos7d,
           count(*)::int as enviados_total,
           count(*) filter (where respondido)::int as respondidos_total,
           greatest(extract(day from now() - min(sent_at))::int, 0) as dias_de_uso
      from salientes
     group by account_id
  `)

  const mapa = new Map<string, SenalesPorCuenta>()
  for (const fila of r.rows as Array<{
    account_id: string
    enviados7d: number
    respondidos7d: number
    enviados_total: number
    respondidos_total: number
    dias_de_uso: number
  }>) {
    mapa.set(fila.account_id, {
      enviados7d: fila.enviados7d,
      respondidos7d: fila.respondidos7d,
      // Sin muestra suficiente, la histórica no sirve para comparar.
      tasaHistorica:
        fila.enviados_total >= 20 ? fila.respondidos_total / fila.enviados_total : null,
      diasDeUso: fila.dias_de_uso,
    })
  }
  return mapa
}

export interface FilaConciliacion {
  accountId: string
  code: string
  fecha: string
  /** Lo que dice la caché `sent_today` (solo tiene sentido para hoy). */
  contador: number | null
  /** La fuente de verdad: mensajes que consumen cupo ese día. */
  enMensajes: number
  /** Los que volvieron con acuse de Evolution (external_id y estado de entrega). */
  conAcuse: number
  cuadra: boolean
}

/**
 * Conciliación por cuenta y por día.
 *
 * La tercera columna NO es una consulta independiente a Evolution: Evolution no
 * expone un contador de mensajes enviados por instancia y por día que se pueda
 * pedir como fuente aparte. Lo que sí da es el estado de cada mensaje por
 * webhook, así que la columna cuenta los mensajes que volvieron con acuse. Un
 * mensaje contado sin acuse es exactamente la señal de descuadre que interesa.
 */
export async function conciliar(dias = 7): Promise<FilaConciliacion[]> {
  const hoy = opsDate()
  // La fecha operativa se calcula en un CTE y se agrupa por el alias: agrupar
  // por la expresión repetida hace que Postgres no la reconozca como la misma
  // (error 42803) cuando la zona horaria viaja como parámetro.
  const r = await db.execute(sql`
    with envios as (
      select m.account_id,
             (m.sent_at at time zone ${OPS_TZ})::date as fecha,
             (m.external_id is not null
              and (m.delivered_at is not null or m.read_at is not null)) as con_acuse
        from messages m
       where m.direction = 'out'
         and m.status in ('enviado','entregado','leido','respondido')
         and m.undone_at is null
         and m.sent_at is not null
         and m.sent_at > now() - make_interval(days => ${dias})
    )
    select a.id as account_id,
           a.code,
           to_char(e.fecha, 'YYYY-MM-DD') as fecha,
           count(*)::int as en_mensajes,
           count(*) filter (where e.con_acuse)::int as con_acuse,
           case when e.fecha = a.counter_date then a.sent_today end as contador
      from envios e
      join messaging_accounts a on a.id = e.account_id
     group by a.id, a.code, e.fecha, a.counter_date, a.sent_today
     order by e.fecha desc, a.code asc
  `)

  return (r.rows as Array<{
    account_id: string
    code: string
    fecha: string
    en_mensajes: number
    con_acuse: number
    contador: number | null
  }>).map((f) => ({
    accountId: f.account_id,
    code: f.code,
    fecha: f.fecha,
    contador: f.fecha === hoy ? f.contador : null,
    enMensajes: f.en_mensajes,
    conAcuse: f.con_acuse,
    // Solo se exige que cuadre el contador de hoy: los días anteriores ya no
    // tienen caché con la que comparar.
    cuadra: f.fecha !== hoy || f.contador === null || f.contador === f.en_mensajes,
  }))
}

export async function contarCuentas(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(messagingAccounts)
  return row?.n ?? 0
}

export async function obtenerCuenta(id: string) {
  const [row] = await db.select().from(messagingAccounts).where(eq(messagingAccounts.id, id)).limit(1)
  return row ?? null
}
