import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { Channel, ContactStage } from '@/db/enums'
import { OPS_CONFIG_DEFAULT } from '@/lib/ops-config'
import { intercalarPorCuenta } from '@/server/rotation/select'
import {
  datosDeContacto,
  elegirVariante,
  linkInstagram,
  linkWhatsApp,
  renderTemplate,
} from '@/lib/templates/render'
import { cupoEfectivo, techoParaLaConsola } from '@/server/rotation/quota'
import { opsDate, OPS_TZ } from '@/lib/tz'
import type { ColaDelDia, ItemDeCola, Prioridad } from '@/lib/dispatch-types'
import { leerConfigChatwoot } from '@/server/chatwoot/config'
import { leerConfigEvolution } from '@/server/evolution/config'

/**
 * La cola del día del Despachador.
 *
 * El orden importa y no es negociable: primero los seguimientos vencidos,
 * después los de hoy, y recién al final los contactos nuevos. Con 300 mensajes
 * de techo por día y listas de 1.000, si los nuevos se comen el cupo los
 * seguimientos se atrasan, y ahí es donde se pierden las ventas.
 */

interface FilaCola {
  contact_id: string
  business_name: string
  contact_name: string | null
  niche: string | null
  city: string | null
  bought: string | null
  stage: ContactStage
  score: number
  sent_count: number
  received_count: number
  last_outbound_at: Date | null
  next_followup_at: Date | null
  destino: string
  cuenta_id: string
  cuenta_code: string
  cuenta_label: string
  cuenta_status: string
  cuenta_daily_cap: number
  cuenta_warmup_day: number | null
  cuenta_min_gap: number
  cuenta_window_start: string
  cuenta_window_end: string
  cuenta_mode: 'api' | 'manual'
  cuenta_inbox: number | null
  cuenta_instancia: string | null
  usado_hoy: number
}

/**
 * Qué parte de la cola se quiere.
 *
 *   todos         — el Despachador: primeros mensajes y seguimientos juntos.
 *   nuevos        — solo los que nunca recibieron nada.
 *   seguimientos  — solo los que ya recibieron al menos un mensaje.
 *
 * Es el mismo motor en los tres casos: mismo armado del mensaje, mismos cupos,
 * misma rotación. Lo único que cambia es a quién se le escribe.
 */
export type ModoDeCola = 'todos' | 'nuevos' | 'seguimientos'

/**
 * Arma la cola de un canal.
 *
 * Solo entran contactos que todavía no respondieron: si contestó, la secuencia
 * se corta y pasa a la bandeja, no al despachador.
 */
export async function armarCola(
  canal: Channel,
  modo: ModoDeCola = 'todos',
  limite = 120,
): Promise<ColaDelDia> {
  const cfg = OPS_CONFIG_DEFAULT
  const hoy = opsDate()

  const columnaCuenta =
    canal === 'whatsapp' ? sql`c.assigned_wa_account_id` : sql`c.assigned_ig_account_id`
  const columnaDestino = canal === 'whatsapp' ? sql`c.phone_e164` : sql`c.ig_username`

  const filas = await db.execute(sql`
    with usado as (
      select account_id, count(*)::int as n
        from messages
       where status in ('enviado','entregado','leido','respondido')
         and undone_at is null
         and (sent_at at time zone ${OPS_TZ})::date = ${hoy}::date
       group by account_id
    )
    select c.id as contact_id, c.business_name, c.contact_name, c.niche, c.city, c.bought,
           c.stage, c.score, c.sent_count, c.received_count,
           c.last_outbound_at, c.next_followup_at,
           ${columnaDestino} as destino,
           a.id as cuenta_id, a.code as cuenta_code, a.label as cuenta_label,
           a.status as cuenta_status, a.daily_cap as cuenta_daily_cap,
           a.warmup_day as cuenta_warmup_day, a.min_gap_seconds as cuenta_min_gap,
           a.window_start as cuenta_window_start, a.window_end as cuenta_window_end,
           a.mode as cuenta_mode, a.chatwoot_inbox_id as cuenta_inbox,
           a.instance_name as cuenta_instancia,
           coalesce(u.n, 0) as usado_hoy
      from contacts c
      join messaging_accounts a on a.id = ${columnaCuenta}
      left join usado u on u.account_id = a.id
     where c.discarded_at is null
       and ${columnaDestino} is not null
       and a.status in ('activa','calentando')
       -- Si ya contestó, la secuencia se corta: va a la bandeja, no acá.
       and c.received_count = 0
       and c.stage not in ('cerrado','perdido','no_contactar','descartado','sin_respuesta',
                           'respondido','interesado','reunion_agendada')
       -- O es un contacto nuevo, o le toca seguimiento hoy o antes.
       and (c.sent_count = 0 or (c.next_followup_at is not null and c.next_followup_at <= now()))
       ${
         modo === 'nuevos'
           ? sql`and c.sent_count = 0`
           : modo === 'seguimientos'
             ? sql`and c.sent_count > 0`
             : sql``
       }
     order by
       case when c.next_followup_at is not null and c.next_followup_at < date_trunc('day', now())
            then 0
            when c.next_followup_at is not null then 1
            else 2 end,
       c.score desc,
       c.business_name asc
     limit ${limite}
  `)

  // Plantillas activas, indexadas por paso y rubro.
  const plantillas = await db.execute(sql`
    select id, body, variants, niche, sequence_step, channel
      from templates
     where active
       and (channel = ${canal} or channel = 'ambos')
     order by (niche is null) asc, sequence_step asc nulls last
  `)

  type Plantilla = {
    id: string
    body: string
    variants: unknown
    niche: string | null
    sequence_step: number | null
  }
  const disponibles = plantillas.rows as Plantilla[]

  /** Plantilla del rubro si existe; si no, la general del mismo paso. */
  const buscarPlantilla = (paso: number, rubro: string | null): Plantilla | null => {
    const delPaso = disponibles.filter((p) => (p.sequence_step ?? 1) === paso)
    return (
      (rubro ? delPaso.find((p) => p.niche === rubro) : undefined) ??
      delPaso.find((p) => p.niche === null) ??
      null
    )
  }

  /*
   * Una cuenta puede mandar sola por dos caminos, y alcanza con uno:
   *   · Chatwoot configurado y la cuenta con su inbox mapeado.
   *   · Evolution configurado y la cuenta con su instancia asignada.
   *
   * Mirar solo Chatwoot dejaba el botón en "Abrir WhatsApp" aunque Evolution
   * estuviera listo y el envío automático funcionara.
   */
  const [chatwootListo, evolutionListo] = await Promise.all([
    leerConfigChatwoot().then((c) => c !== null),
    leerConfigEvolution().then((e) => e !== null),
  ])

  const ahora = new Date()
  const usadoPorCuenta = new Map<string, number>()
  const items: ItemDeCola[] = []
  let sinPlantilla = 0
  let saltados = 0

  for (const f of filas.rows as unknown as FilaCola[]) {
    const paraCupo = {
      status: f.cuenta_status as 'activa' | 'calentando',
      dailyCap: f.cuenta_daily_cap,
      minGapSeconds: f.cuenta_min_gap,
      warmupDay: f.cuenta_warmup_day,
      windowStart: f.cuenta_window_start,
      windowEnd: f.cuenta_window_end,
    }
    const cupo = cupoEfectivo(paraCupo, cfg)
    const techo = techoParaLaConsola(paraCupo, cfg)

    // Se descuentan también los que ya están más arriba en esta misma cola, así
    // la pantalla no ofrece más mensajes de los que la cuenta puede mandar hoy.
    const yaEnCola = usadoPorCuenta.get(f.cuenta_id) ?? 0
    const usado = f.usado_hoy + yaEnCola
    if (usado >= techo) continue

    const prioridad: Prioridad =
      f.sent_count === 0
        ? 'nuevo'
        : f.next_followup_at !== null && new Date(f.next_followup_at) < startOfDay(ahora)
          ? 'vencido'
          : 'hoy'

    const paso = Math.min(f.sent_count + 1, 4)
    const plantilla = buscarPlantilla(paso, f.niche)

    let mensaje: string | null = null
    let motivo: string | null = null
    let variante: number | null = null

    if (!plantilla) {
      sinPlantilla++
      motivo = `No hay plantilla activa para el paso ${paso} de ${canal === 'whatsapp' ? 'WhatsApp' : 'Instagram'}.`
    } else {
      const elegida = elegirVariante(plantilla.body, plantilla.variants, f.contact_id)
      const r = renderTemplate(
        elegida.texto,
        datosDeContacto(
          {
            businessName: f.business_name,
            contactName: f.contact_name,
            niche: f.niche,
            bought: f.bought,
            city: f.city,
          },
          { miNombre: 'el estudio', oferta: 'el servicio nuevo' },
        ),
      )
      if (r.ok) {
        mensaje = r.texto
        variante = elegida.indice
      } else {
        saltados++
        motivo = r.motivo
      }
    }

    usadoPorCuenta.set(f.cuenta_id, yaEnCola + 1)

    items.push({
      contactId: f.contact_id,
      businessName: f.business_name,
      contactName: f.contact_name,
      niche: f.niche,
      city: f.city,
      bought: f.bought,
      stage: f.stage,
      score: f.score,
      sentCount: f.sent_count,
      receivedCount: f.received_count,
      lastOutboundAt: f.last_outbound_at,
      prioridad,
      paso,
      channel: canal,
      destino: f.destino,
      cuentaId: f.cuenta_id,
      cuentaCode: f.cuenta_code,
      cuentaLabel: f.cuenta_label,
      cuentaUsado: usado,
      cuentaTecho: techo,
      cuentaCupo: cupo,
      mensaje,
      motivoSaltado: motivo,
      templateId: plantilla?.id ?? null,
      templateVariant: variante,
      link:
        canal === 'whatsapp'
          ? linkWhatsApp(f.destino, mensaje ?? '')
          : linkInstagram(f.destino),
      /*
       * Solo WhatsApp puede mandar solo. Instagram nunca: no hay API oficial
       * para iniciar conversaciones, así que va por portapapeles y link.
       */
      envioAutomatico:
        canal === 'whatsapp' &&
        ((chatwootListo && f.cuenta_inbox !== null) ||
          (evolutionListo && f.cuenta_instancia !== null)),
    })
  }

  /*
   * Se intercala para que dos mensajes seguidos no salgan del mismo número.
   * No se cambia la cuenta de nadie: se cambia el orden, que es la única forma
   * de respetar a la vez la rotación y la asignación pegada.
   */
  const intercalados = intercalarPorCuenta(items, (i) => i.cuentaId)

  /*
   * Los que no se pueden mandar van al final. Un contacto al que le falta un
   * dato o una plantilla no es accionable: dejarlo adelante frena el trabajo y
   * obliga a saltearlo a mano antes de llegar a los que sí se pueden despachar.
   * Igual quedan en la lista, con el motivo, porque no se esconde nada.
   */
  const ordenados = [
    ...intercalados.filter((i) => i.mensaje !== null),
    ...intercalados.filter((i) => i.mensaje === null),
  ]

  const cupoDisponible = await calcularCupoDisponible(canal)

  return {
    items: ordenados,
    totales: {
      vencidos: items.filter((i) => i.prioridad === 'vencido').length,
      hoy: items.filter((i) => i.prioridad === 'hoy').length,
      nuevos: items.filter((i) => i.prioridad === 'nuevo').length,
      sinPlantilla,
      saltados,
    },
    cupoDisponible,
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Cuántos mensajes más puede mandar hoy la consola en ese canal. */
async function calcularCupoDisponible(canal: Channel): Promise<number> {
  const cfg = OPS_CONFIG_DEFAULT
  const hoy = opsDate()

  const filas = await db.execute(sql`
    with usado as (
      select account_id, count(*)::int as n
        from messages
       where status in ('enviado','entregado','leido','respondido')
         and undone_at is null
         and (sent_at at time zone ${OPS_TZ})::date = ${hoy}::date
       group by account_id
    )
    select a.status, a.daily_cap, a.warmup_day, coalesce(u.n, 0) as usado
      from messaging_accounts a
      left join usado u on u.account_id = a.id
     where a.channel = ${canal} and a.status in ('activa','calentando')
  `)

  let total = 0
  for (const f of filas.rows as Array<{
    status: string
    daily_cap: number
    warmup_day: number | null
    usado: number
  }>) {
    const techo = techoParaLaConsola(
      {
        status: f.status as 'activa' | 'calentando',
        dailyCap: f.daily_cap,
        minGapSeconds: 0,
        warmupDay: f.warmup_day,
        windowStart: '09:00',
        windowEnd: '20:00',
      },
      cfg,
    )
    total += Math.max(techo - f.usado, 0)
  }
  return total
}
