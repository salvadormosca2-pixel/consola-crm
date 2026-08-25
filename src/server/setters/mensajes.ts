import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  MENSAJES_CONFIG_KEY,
  MENSAJES_CONFIG_VACIA,
  mensajesConfigSchema,
  type MensajesConfig,
  type Paso,
} from '@/lib/mensajes-config'
import { renderParaVistaPrevia, variablesDesconocidas } from '@/lib/templates/render'

/**
 * Los mensajes que mandan los setters.
 *
 * Se guardan en `templates`, la tabla que ya existía. Dos cosas la gobiernan:
 *
 *   · **el paso** — 1 es la entrada, 2 es la oferta;
 *   · **el rubro** — si hay un mensaje escrito para el rubro del lead, gana ese;
 *     si no, se usa el general. Hablarle a una peluquería como a una ferretería
 *     es lo que hace que el mensaje se note copiado y pegado.
 *
 * Cada mensaje puede tener variantes. **Cada setter manda una variante
 * distinta**: mil DMs con el mismo texto exacto es lo que dispara las
 * restricciones de Instagram.
 */

export interface MensajeGuardado {
  id: string
  paso: Paso
  /** null = el mensaje general, el que se usa cuando no hay uno del rubro. */
  rubro: string | null
  cuerpo: string
  variantes: string[]
  activo: boolean
  /** Variables escritas que no existen. Si hay alguna, el mensaje no sale. */
  errores: string[]
  actualizado: Date
}

export async function leerConfigDeMensajes(): Promise<MensajesConfig> {
  const filas = await db.execute(sql`
    select value_jsonb from settings where key = ${MENSAJES_CONFIG_KEY} limit 1
  `)
  const valor = (filas.rows[0] as { value_jsonb: unknown } | undefined)?.value_jsonb
  if (!valor) return MENSAJES_CONFIG_VACIA
  const parsed = mensajesConfigSchema.safeParse(valor)
  return parsed.success ? parsed.data : MENSAJES_CONFIG_VACIA
}

export async function listarMensajes(): Promise<MensajeGuardado[]> {
  const filas = await db.execute(sql`
    select id, coalesce(sequence_step, 1) as paso, niche, body, variants, active, updated_at
      from templates
     where channel in ('instagram', 'ambos')
       and coalesce(sequence_step, 1) in (1, 2)
     order by coalesce(sequence_step, 1) asc, (niche is null) desc, niche asc
  `)

  return (filas.rows as Array<{
    id: string
    paso: number
    niche: string | null
    body: string
    variants: unknown
    active: boolean
    updated_at: Date
  }>).map((f) => ({
    id: f.id,
    paso: (f.paso === 2 ? 2 : 1) as Paso,
    rubro: f.niche,
    cuerpo: f.body,
    variantes: Array.isArray(f.variants)
      ? f.variants.filter((v): v is string => typeof v === 'string')
      : [],
    activo: f.active,
    errores: variablesDesconocidas(f.body).map((v) => `{{${v}}} no existe`),
    actualizado: new Date(f.updated_at),
  }))
}

/** Los rubros que hay en la base, para poder escribirles un mensaje propio. */
export async function rubrosConLeads(): Promise<Array<{ rubro: string; leads: number }>> {
  const filas = await db.execute(sql`
    select niche as rubro, count(*)::int as leads
      from contacts
     where origen = 'scrapeado' and discarded_at is null and niche is not null and niche <> ''
     group by niche
     order by count(*) desc, niche asc
     limit 40
  `)
  return filas.rows as Array<{ rubro: string; leads: number }>
}

/** Vista previa con un lead de ejemplo, para ver cómo queda antes de guardar. */
export function vistaPrevia(
  cuerpo: string,
  config: MensajesConfig,
  ejemplo: { negocio: string; rubro: string; ciudad: string; nombre: string },
): { texto: string; faltantes: string[] } {
  return renderParaVistaPrevia(cuerpo, {
    negocio: ejemplo.negocio,
    rubro: ejemplo.rubro,
    ciudad: ejemplo.ciudad,
    nombre: ejemplo.nombre,
    mi_nombre: config.miNombre || null,
    oferta: config.oferta || null,
  })
}
