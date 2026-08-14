import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { ContactStage } from '@/db/enums'

/**
 * Panel de seguimientos.
 *
 * Está armado como lo pensaría alguien que vive de vender: no por fecha, sino
 * por **qué tan cerca está de perderse**. Un contacto que no contestó tres
 * mensajes no es lo mismo que uno al que recién le escribiste ayer, aunque los
 * dos "tengan un seguimiento pendiente".
 *
 * El orden de los grupos es el orden en que conviene trabajarlos.
 */

export type GrupoSeguimiento =
  | 'vencido'
  | 'hoy'
  | 'esta_semana'
  | 'agotado'

export const GRUPO_META: Record<
  GrupoSeguimiento,
  { label: string; explicacion: string; tono: 'negativo' | 'activo' | 'neutral' }
> = {
  vencido: {
    label: 'Atrasados',
    explicacion:
      'Les tocaba antes de hoy y no salieron. Son los que más se enfrían: cada día que pasa baja la chance de que contesten.',
    tono: 'negativo',
  },
  hoy: {
    label: 'Para hoy',
    explicacion: 'Les toca hoy según la secuencia. Es el trabajo del día.',
    tono: 'activo',
  },
  esta_semana: {
    label: 'Esta semana',
    explicacion: 'Ya están programados. No hay nada que hacer todavía, es para saber qué viene.',
    tono: 'neutral',
  },
  agotado: {
    label: 'Sin respuesta',
    explicacion:
      'Recibieron los cuatro mensajes de la secuencia y nunca contestaron. Conviene decidir: dejarlos descansar 60 días o cerrarlos.',
    tono: 'neutral',
  },
}

export interface FilaSeguimiento {
  id: string
  businessName: string
  contactName: string | null
  niche: string | null
  city: string | null
  stage: ContactStage
  score: number
  sentCount: number
  paso: number
  lastOutboundAt: Date | null
  nextFollowupAt: Date | null
  diasSinRespuesta: number
  cuentaCode: string | null
  phoneE164: string | null
  igUsername: string | null
  grupo: GrupoSeguimiento
  /** true si el próximo mensaje puede salir solo por la API. */
  envioAutomatico: boolean
}

export interface PanelSeguimientos {
  grupos: Record<GrupoSeguimiento, FilaSeguimiento[]>
  totales: Record<GrupoSeguimiento, number>
  /** Cuántos hay en cada paso de la secuencia, para ver dónde se traba la gente. */
  porPaso: Array<{ paso: number; n: number }>
}

export async function armarSeguimientos(puedeMandarSolo: boolean): Promise<PanelSeguimientos> {
  const filas = await db.execute(sql`
    select c.id, c.business_name, c.contact_name, c.niche, c.city, c.stage, c.score,
           c.sent_count, c.last_outbound_at, c.next_followup_at,
           c.phone_e164, c.ig_username,
           a.code as cuenta_code, a.mode as cuenta_mode, a.chatwoot_inbox_id as cuenta_inbox,
           a.instance_name as cuenta_instancia,
           greatest(extract(day from now() - coalesce(c.last_outbound_at, now()))::int, 0) as dias,
           case
             when c.sent_count >= 4 then 'agotado'
             when c.next_followup_at < date_trunc('day', now()) then 'vencido'
             when c.next_followup_at < date_trunc('day', now()) + interval '1 day' then 'hoy'
             else 'esta_semana'
           end as grupo
      from contacts c
      left join messaging_accounts a
        on a.id = coalesce(c.assigned_wa_account_id, c.assigned_ig_account_id)
     where c.discarded_at is null
       -- El que contestó sale de la secuencia: va a la bandeja, no acá.
       and c.received_count = 0
       and c.sent_count > 0
       and c.stage not in ('cerrado','perdido','no_contactar','descartado',
                           'respondido','interesado','reunion_agendada')
       and (c.sent_count >= 4
            or (c.next_followup_at is not null
                and c.next_followup_at < now() + interval '7 days'))
     order by c.next_followup_at asc nulls last, c.score desc
     limit 800
  `)

  const grupos: Record<GrupoSeguimiento, FilaSeguimiento[]> = {
    vencido: [],
    hoy: [],
    esta_semana: [],
    agotado: [],
  }

  for (const f of filas.rows as Array<Record<string, unknown>>) {
    const grupo = f.grupo as GrupoSeguimiento
    grupos[grupo].push({
      id: f.id as string,
      businessName: f.business_name as string,
      contactName: f.contact_name as string | null,
      niche: f.niche as string | null,
      city: f.city as string | null,
      stage: f.stage as ContactStage,
      score: f.score as number,
      sentCount: f.sent_count as number,
      paso: Math.min((f.sent_count as number) + 1, 4),
      lastOutboundAt: f.last_outbound_at as Date | null,
      nextFollowupAt: f.next_followup_at as Date | null,
      diasSinRespuesta: Number(f.dias ?? 0),
      cuentaCode: f.cuenta_code as string | null,
      phoneE164: f.phone_e164 as string | null,
      igUsername: f.ig_username as string | null,
      grupo,
      envioAutomatico:
        puedeMandarSolo && f.phone_e164 !== null &&
        (f.cuenta_inbox !== null || f.cuenta_instancia !== null),
    })
  }

  const porPaso = await db.execute(sql`
    select c.sent_count as paso, count(*)::int as n
      from contacts c
     where c.discarded_at is null and c.received_count = 0 and c.sent_count between 1 and 4
       and c.stage not in ('cerrado','perdido','no_contactar','descartado')
     group by c.sent_count order by c.sent_count
  `)

  return {
    grupos,
    totales: {
      vencido: grupos.vencido.length,
      hoy: grupos.hoy.length,
      esta_semana: grupos.esta_semana.length,
      agotado: grupos.agotado.length,
    },
    porPaso: (porPaso.rows as Array<{ paso: number; n: number }>).map((r) => ({
      paso: Number(r.paso),
      n: Number(r.n),
    })),
  }
}
