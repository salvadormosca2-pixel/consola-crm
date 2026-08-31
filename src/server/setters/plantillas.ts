import 'server-only'

import { sql } from 'drizzle-orm'

import { db } from '@/db'
import { PASO_META } from '@/lib/mensajes-config'
import { pistaDePaso } from '@/lib/pistas'
import type { PasoDeSeguimiento } from '@/lib/setters-config'
import { datosDeContacto, renderTemplate } from '@/lib/templates/render'
import { leerConfigDeMensajes } from '@/server/setters/mensajes'

/**
 * El texto que el setter copia y pega.
 *
 * Un texto por paso —cada escalón de cada pista tiene el suyo—, y cada uno
 * puede tener una versión por rubro. **Todos los escribe el admin**: el sistema
 * no inventa ni completa texto. Si falta el de un paso, el lead queda bloqueado
 * con el motivo a la vista y el setter lo saltea.
 *
 * Cada setter manda una variante distinta del mismo mensaje: mil DMs con el
 * texto exacto es lo que dispara las restricciones de Instagram.
 */

export interface PlantillaDeSetter {
  id: string
  /** Cuerpo base y variantes, ya resueltas en una lista. */
  textos: string[]
}

interface FilaPlantilla {
  id: string
  body: string
  variants: unknown
  sequence_step: number | null
  niche: string | null
}

/**
 * Los mensajes activos de Instagram, indexados por paso y por rubro.
 *
 * La clave del mapa interno es el rubro en minúsculas, y `null` es el general.
 * Al armar un mensaje se busca primero el del rubro del lead y recién después
 * el general: hablarle a una peluquería como a una ferretería es lo que hace
 * que el mensaje se note copiado y pegado.
 */
export type PlantillasPorRubro = Map<number, Map<string | null, PlantillaDeSetter>>

export async function leerPlantillasDeSetter(): Promise<PlantillasPorRubro> {
  const filas = await db.execute(sql`
    select id, body, variants, sequence_step, niche
      from templates
     where active
       and (channel = 'instagram' or channel = 'ambos')
       and coalesce(sequence_step, 1) between 1 and 18
     order by coalesce(sequence_step, 1) asc, updated_at desc
  `)

  const salida: PlantillasPorRubro = new Map()

  for (const f of filas.rows as unknown as FilaPlantilla[]) {
    const paso = f.sequence_step ?? 1
    const clave = f.niche ? f.niche.trim().toLowerCase() : null
    const delPaso = salida.get(paso) ?? new Map<string | null, PlantillaDeSetter>()
    salida.set(paso, delPaso)
    // Si hay dos del mismo rubro, gana la editada más recientemente.
    if (delPaso.has(clave)) continue

    const variantes = Array.isArray(f.variants)
      ? f.variants.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : []
    delPaso.set(clave, { id: f.id, textos: [f.body, ...variantes] })
  }

  return salida
}

/** El mensaje del rubro del lead si existe; si no, el general. */
export function elegirPlantilla(
  plantillas: PlantillasPorRubro,
  paso: number,
  rubro: string | null,
): PlantillaDeSetter | null {
  const delPaso = plantillas.get(paso)
  if (!delPaso) return null
  const porRubro = rubro ? delPaso.get(rubro.trim().toLowerCase()) : undefined
  return porRubro ?? delPaso.get(null) ?? null
}

export interface ContactoParaMensaje {
  businessName: string
  contactName: string | null
  niche: string | null
  bought: string | null
  city: string | null
}

export type MensajeArmado =
  | { ok: true; texto: string; templateId: string; variante: number }
  | { ok: false; motivo: string }

/**
 * Arma el mensaje de un lead.
 *
 * Si falta el dato de una variable NO se manda: el lead queda en la cola con el
 * motivo a la vista y los únicos botones habilitados son saltear y marcar la
 * cuenta como inexistente. Es la misma regla del Despachador — nunca sale
 * "Hola {{negocio}}" —, y acá pesa el doble porque son cuentas personales del
 * setter las que se queman si el mensaje se nota automático.
 */
export function armarMensaje(
  plantilla: PlantillaDeSetter | null,
  contacto: ContactoParaMensaje,
  varianteDelSetter: number,
  voz: { miNombre?: string | null; oferta?: string | null },
  paso: PasoDeSeguimiento,
): MensajeArmado {
  if (!plantilla) {
    /* Cada texto se escribe en una pantalla distinta según a qué pista
       pertenezca, así que el motivo tiene que nombrar la correcta: mandarlo a
       Mensajes a buscar un texto que se escribe en Seguimientos es un callejón. */
    const pista = pistaDePaso(paso)
    const donde = pista === 'silencio' || pista === 'tibio' || pista === 'sin_abrir'
      ? 'Seguimientos'
      : 'Mensajes'
    return {
      ok: false,
      motivo: `Todavía no escribiste el mensaje de "${PASO_META[paso].label}". Cargalo en ${donde}.`,
    }
  }

  const indice = ((varianteDelSetter % plantilla.textos.length) + plantilla.textos.length) %
    plantilla.textos.length
  const cuerpo = plantilla.textos[indice]!

  const r = renderTemplate(cuerpo, datosDeContacto(contacto, voz))
  if (!r.ok) return { ok: false, motivo: r.motivo }

  return { ok: true, texto: r.texto, templateId: plantilla.id, variante: indice }
}

/** El nombre y la oferta que van en {{mi_nombre}} y {{oferta}}. */
export async function leerVozOperativa(): Promise<{ miNombre: string | null; oferta: string | null }> {
  const cfg = await leerConfigDeMensajes()
  return {
    miNombre: cfg.miNombre.trim() || null,
    oferta: cfg.oferta.trim() || null,
  }
}

/**
 * El mensaje que corresponde a un lead, armado en el servidor.
 *
 * Se rearma acá y no se confía en el texto que manda el celular: si el cliente
 * pudiera elegir el cuerpo, un guion viejo cacheado en un teléfono seguiría
 * saliendo después de que cambié la plantilla, que es justo lo que el mensaje
 * bloqueante trata de evitar.
 */
export type MensajeDeAsignacion =
  | {
      ok: true
      texto: string
      templateId: string
      variante: number
      contactId: string
      paso: PasoDeSeguimiento
    }
  | { ok: false; motivo: string }

export async function mensajeDeAsignacion(
  assignmentId: string,
  setterId: string,
): Promise<MensajeDeAsignacion> {
  const filas = await db.execute(sql`
    select la.contact_id, la.estado, la.proximo_paso, la.proximo_seguimiento_at,
           c.business_name, c.contact_name, c.niche, c.bought, c.city,
           s.variante
      from lead_assignments la
      join contacts c on c.id = la.contact_id
      join setters s on s.id = la.setter_id
     where la.id = ${assignmentId}::uuid and la.setter_id = ${setterId}::uuid
     limit 1
  `)

  const f = filas.rows[0] as
    | {
        contact_id: string
        estado: string
        proximo_paso: number | null
        proximo_seguimiento_at: Date | null
        business_name: string
        contact_name: string | null
        niche: string | null
        bought: string | null
        city: string | null
        variante: number
      }
    | undefined

  if (!f) return { ok: false, motivo: 'Ese lead ya no es tuyo.' }

  /*
   * El paso lo decide el servidor mirando lo que el lead tiene programado, no
   * el celular. Si tiene un seguimiento vencido le toca ese; si no, la entrada.
   */
  const leToca =
    f.proximo_seguimiento_at !== null && new Date(f.proximo_seguimiento_at).getTime() <= Date.now()
  const paso: PasoDeSeguimiento = leToca ? ((f.proximo_paso ?? 1) as PasoDeSeguimiento) : 1

  const [plantillas, voz] = await Promise.all([leerPlantillasDeSetter(), leerVozOperativa()])

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

  if (!armado.ok) return armado
  return { ...armado, contactId: f.contact_id, paso }
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
