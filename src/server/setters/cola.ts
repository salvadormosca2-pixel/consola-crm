import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import type { LeadEstado } from '@/db/enums'
import type { PasoDeSeguimiento } from '@/lib/setters-config'
import { opsDate, OPS_TZ } from '@/lib/tz'
import { barrer } from '@/server/setters/asignacion'
import { leerCupoDeSetter, type CupoDeSetter } from '@/server/setters/cupo'
import {
  armarMensaje,
  leerPlantillasDeSetter,
  elegirPlantilla,
  leerVozOperativa,
  linksDeInstagram,
} from '@/server/setters/plantillas'

/**
 * La cola del día del setter.
 *
 * El orden no es negociable: **primero los seguimientos, después los contactos
 * nuevos**. Un lead que ya recibió el primer mensaje y espera el segundo vale
 * más que uno sin tocar, y si los nuevos se comen el cupo los seguimientos se
 * atrasan, que es donde se pierden las respuestas.
 *
 * Dentro de los seguimientos manda el atraso; dentro de los nuevos, el que está
 * más cerca de vencer.
 */

export interface ItemDeCola {
  assignmentId: string
  contactId: string
  businessName: string
  contactName: string | null
  igUsername: string
  niche: string | null
  city: string | null
  /** Cuál de las cinco situaciones le toca a este lead ahora. */
  paso: PasoDeSeguimiento
  estado: LeadEstado
  /** Ya tocó "Abrir Instagram": el botón de marcar está habilitado. */
  abierto: boolean
  venceAt: Date
  /** Horas que le quedan antes de que el lead vuelva al pozo. */
  horasRestantes: number
  /** Días de atraso del segundo mensaje. 0 si le toca hoy. */
  diasAtraso: number
  mensaje: string | null
  /** Por qué no se puede armar el mensaje. Si está, no se puede mandar. */
  motivoBloqueo: string | null
  templateId: string | null
  templateVariant: number | null
  linkDirecto: string
  linkRespaldo: string
}

export interface ColaDelSetter {
  items: ItemDeCola[]
  cupo: CupoDeSetter
  /** Seguimientos que le tocan hoy, contando los atrasados. */
  seguimientos: number
  seguimientosAtrasados: number
  /** Días del seguimiento más atrasado. Es el número que dispara la alerta. */
  diasDeAtraso: number
  nuevos: number
  /** Lo que ya hizo hoy, para la pantalla de día completado. */
  hoy: { contactados: number; respondieron: number; reuniones: number }
}

interface FilaCola {
  id: string
  contact_id: string
  estado: LeadEstado
  vence_at: Date
  abierto_at: Date | null
  proximo_paso: number | null
  proximo_seguimiento_at: Date | null
  business_name: string
  contact_name: string | null
  ig_username: string
  niche: string | null
  city: string | null
  bought: string | null
  variante: number
}

export async function armarColaDelSetter(setterId: string): Promise<ColaDelSetter> {
  // Antes de mostrar nada, se pone al día lo que depende del reloj: leads
  // vencidos que vuelven al pozo y salteados de ayer que vuelven a la cola.
  await barrer()

  const [cupo, plantillas, voz] = await Promise.all([
    leerCupoDeSetter(setterId),
    leerPlantillasDeSetter(),
    leerVozOperativa(),
  ])

  const filas = await db.execute(sql`
    select la.id, la.contact_id, la.estado, la.vence_at, la.abierto_at,
           la.proximo_paso, la.proximo_seguimiento_at,
           c.business_name, c.contact_name, c.ig_username, c.niche, c.city, c.bought,
           s.variante
      from lead_assignments la
      join contacts c on c.id = la.contact_id
      join setters s on s.id = la.setter_id
     where la.setter_id = ${setterId}::uuid
       and (
         -- Le toca un seguimiento: cualquiera de los cuatro que siguen a la
         -- entrada, según en qué silencio quedó.
         (la.proximo_seguimiento_at is not null and la.proximo_seguimiento_at <= now())
         -- O nunca recibió nada y le toca la entrada.
         or la.estado in ('asignado', 'abierto', 'saltado')
       )
     order by
       -- Los seguimientos van primero, siempre: un lead que ya recibió algo
       -- vale más que uno sin tocar.
       case when la.proximo_seguimiento_at is not null
             and la.proximo_seguimiento_at <= now() then 0 else 1 end,
       -- Entre seguimientos, el más atrasado arriba.
       la.proximo_seguimiento_at asc nulls last,
       -- Entre nuevos, los salteados al final y el resto por vencimiento.
       case when la.estado = 'saltado' then 1 else 0 end,
       la.vence_at asc
     limit 300
  `)

  const ahora = Date.now()
  const items: ItemDeCola[] = []

  for (const f of filas.rows as unknown as FilaCola[]) {
    const programado = f.proximo_seguimiento_at ? new Date(f.proximo_seguimiento_at) : null
    const leToca = programado !== null && programado.getTime() <= ahora

    // Si tiene seguimiento vencido, le toca ese paso. Si no, es un lead sin
    // tocar y le toca la entrada.
    const paso: PasoDeSeguimiento = leToca ? ((f.proximo_paso ?? 1) as PasoDeSeguimiento) : 1

    const armado = armarMensaje(
      elegirPlantilla(plantillas, paso, f.niche),
      {
        businessName: f.business_name,
        contactName: f.contact_name,
        niche: f.niche,
        bought: f.bought,
        city: f.city,
      },
      f.variante,
      voz,
      paso,
    )

    const vence = new Date(f.vence_at)

    items.push({
      assignmentId: f.id,
      contactId: f.contact_id,
      businessName: f.business_name,
      contactName: f.contact_name,
      igUsername: f.ig_username,
      niche: f.niche,
      city: f.city,
      paso,
      estado: f.estado,
      abierto: f.abierto_at !== null,
      venceAt: vence,
      horasRestantes: Math.max(Math.floor((vence.getTime() - ahora) / 3_600_000), 0),
      diasAtraso: programado
        ? Math.max(Math.floor((ahora - programado.getTime()) / 86_400_000), 0)
        : 0,
      mensaje: armado.ok ? armado.texto : null,
      motivoBloqueo: armado.ok ? null : armado.motivo,
      templateId: armado.ok ? armado.templateId : null,
      templateVariant: armado.ok ? armado.variante : null,
      ...linksDeInstagram(f.ig_username),
    })
  }

  const seguimientos = items.filter((i) => i.paso > 1)

  return {
    items,
    cupo,
    seguimientos: seguimientos.length,
    seguimientosAtrasados: seguimientos.filter((i) => i.diasAtraso > 0).length,
    diasDeAtraso: seguimientos.reduce((a, i) => Math.max(a, i.diasAtraso), 0),
    nuevos: items.filter((i) => i.paso === 1).length,
    hoy: await resumenDelDia(setterId),
  }
}

/** Lo que hizo hoy. Es lo que ve en la pantalla de día completado. */
export async function resumenDelDia(
  setterId: string,
): Promise<{ contactados: number; respondieron: number; reuniones: number }> {
  const hoy = opsDate()

  const filas = await db.execute(sql`
    select
      (select count(*)::int from setter_sends ss
        where ss.setter_id = ${setterId}::uuid and ss.ops_date = ${hoy}::date
          and ss.undone_at is null) as contactados,
      (select count(*)::int from lead_assignments la
        where la.setter_id = ${setterId}::uuid
          and la.respondido_at is not null
          and (la.respondido_at at time zone ${OPS_TZ})::date = ${hoy}::date) as respondieron,
      (select count(*)::int from meetings m
        where m.setter_id = ${setterId}::uuid
          and (m.created_at at time zone ${OPS_TZ})::date = ${hoy}::date) as reuniones
  `)

  const f = filas.rows[0] as
    | { contactados: number; respondieron: number; reuniones: number }
    | undefined

  return {
    contactados: f?.contactados ?? 0,
    respondieron: f?.respondieron ?? 0,
    reuniones: f?.reuniones ?? 0,
  }
}
