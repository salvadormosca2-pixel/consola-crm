import { normalizarInstagram, normalizarTelefonoAr } from '@/lib/phone-ar'

import type { Campo, Mapeo } from './columns'

/**
 * Convierte las filas crudas del Excel en contactos listos para insertar.
 *
 * Es lógica pura: no toca la base ni la red, así que se puede testear con
 * archivos armados a mano y correr en un Web Worker sin cambios.
 *
 * Regla de oro: una fila con teléfono inválido NO se pierde. Se importa con
 * `hasWhatsapp = false` y con el motivo cargado, para que aparezca en Revisar.
 */

export interface FilaPreparada {
  /** Número de fila en el archivo, contando el encabezado. Sirve para "fila 47". */
  rowNumber: number
  businessName: string
  contactName: string | null
  phoneRaw: string | null
  phoneE164: string | null
  hasWhatsapp: boolean
  igUsername: string | null
  hasInstagram: boolean
  niche: string | null
  bought: string | null
  city: string | null
  notes: string | null
  /** Lo que decía la columna de cuenta, sin resolver todavía. */
  accountRaw: string | null
  dedupeKey: string
  /** Motivos por los que esta fila necesita que la mire una persona. */
  avisos: string[]
  /** Si es true, la fila no se puede importar de ninguna manera. */
  descartada: boolean
  /** La fila cruda, para poder auditar y para el deshacer. */
  raw: Record<string, string>
}

const LIMITES: Partial<Record<Campo, number>> = {
  business_name: 200,
  contact_name: 120,
  niche: 80,
  bought: 300,
  city: 120,
  notes: 1000,
}

function leer(fila: string[], mapeo: Mapeo, campo: Campo): string | null {
  const i = mapeo[campo]
  if (i === undefined) return null
  const v = (fila[i] ?? '').toString().trim()
  if (v.length === 0) return null
  const limite = LIMITES[campo]
  return limite && v.length > limite ? v.slice(0, limite) : v
}

/**
 * Prepara una fila. `rowNumber` es 1-based contando el encabezado, así que la
 * primera fila de datos es la 2, igual que en Excel.
 */
export function prepararFila(
  fila: string[],
  mapeo: Mapeo,
  encabezados: string[],
  rowNumber: number,
): FilaPreparada {
  const avisos: string[] = []

  const raw: Record<string, string> = {}
  encabezados.forEach((h, i) => {
    const v = (fila[i] ?? '').toString().trim()
    if (v.length > 0) raw[h || `col${i + 1}`] = v
  })

  const businessName = leer(fila, mapeo, 'business_name')
  const contactName = leer(fila, mapeo, 'contact_name')
  const phoneRaw = leer(fila, mapeo, 'phone')
  const igRaw = leer(fila, mapeo, 'instagram')

  // ── Teléfono ──────────────────────────────────────────────────────────
  let phoneE164: string | null = null
  let hasWhatsapp = false
  if (phoneRaw !== null) {
    const r = normalizarTelefonoAr(phoneRaw)
    if (r.ok) {
      phoneE164 = r.e164
      hasWhatsapp = true
      if (r.extranjero) avisos.push('El teléfono no es argentino, se guardó tal cual.')
    } else {
      // No se tira: entra igual y va a Revisar.
      avisos.push(`Teléfono: ${r.detalle}`)
    }
  }

  // ── Instagram ─────────────────────────────────────────────────────────
  let igUsername: string | null = null
  let hasInstagram = false
  if (igRaw !== null) {
    const r = normalizarInstagram(igRaw)
    if (r.ok) {
      igUsername = r.usuario
      hasInstagram = true
    } else {
      avisos.push(`Instagram: ${r.detalle}`)
    }
  }

  // ── Validaciones de fila ──────────────────────────────────────────────
  let descartada = false

  if (businessName === null) {
    // Sin nombre de negocio no hay contacto: ni siquiera se puede mostrar.
    avisos.push('Falta el nombre del negocio.')
    descartada = true
  }

  if (phoneE164 === null && igUsername === null) {
    avisos.push('No tiene ningún canal utilizable: ni teléfono válido ni Instagram.')
    descartada = true
  }

  // La clave es el teléfono, y si no hay teléfono, el usuario de Instagram.
  const dedupeKey = phoneE164 ?? (igUsername !== null ? `ig:${igUsername}` : `fila:${rowNumber}`)

  return {
    rowNumber,
    businessName: businessName ?? '',
    contactName,
    phoneRaw,
    phoneE164,
    hasWhatsapp,
    igUsername,
    hasInstagram,
    niche: leer(fila, mapeo, 'niche'),
    bought: leer(fila, mapeo, 'bought'),
    city: leer(fila, mapeo, 'city'),
    notes: leer(fila, mapeo, 'notes'),
    accountRaw: leer(fila, mapeo, 'account'),
    dedupeKey,
    avisos,
    descartada,
    raw,
  }
}

export interface DuplicadoEnArchivo {
  fila: FilaPreparada
  /** Fila del archivo con la que choca. */
  chocaCon: number
  motivo: 'telefono' | 'instagram'
}

/**
 * Saca los duplicados que vienen dentro del mismo archivo.
 *
 * Con 1.000 filas por lote, un duplicado significa que el cliente recibe el
 * mismo mensaje dos veces desde dos números distintos, así que esto se hace
 * antes de tocar la base.
 *
 * Se comparan teléfono e Instagram por separado: dos filas del mismo negocio
 * donde una trae solo Instagram y la otra teléfono + Instagram son la misma
 * persona, y hay que fusionarlas, no duplicarlas.
 */
export function deduplicarArchivo(filas: FilaPreparada[]): {
  unicas: FilaPreparada[]
  duplicadas: DuplicadoEnArchivo[]
} {
  const porTelefono = new Map<string, FilaPreparada>()
  const porInstagram = new Map<string, FilaPreparada>()
  const unicas: FilaPreparada[] = []
  const duplicadas: DuplicadoEnArchivo[] = []

  for (const fila of filas) {
    if (fila.descartada) {
      unicas.push(fila)
      continue
    }

    const yaPorTel = fila.phoneE164 ? porTelefono.get(fila.phoneE164) : undefined
    const yaPorIg = fila.igUsername ? porInstagram.get(fila.igUsername) : undefined
    const previa = yaPorTel ?? yaPorIg

    if (previa) {
      // Se completa la fila que ya estaba con los datos nuevos, en vez de
      // agregar una segunda.
      fusionarEnAnterior(previa, fila)
      if (fila.phoneE164) porTelefono.set(fila.phoneE164, previa)
      if (fila.igUsername) porInstagram.set(fila.igUsername, previa)
      duplicadas.push({
        fila,
        chocaCon: previa.rowNumber,
        motivo: yaPorTel ? 'telefono' : 'instagram',
      })
      continue
    }

    if (fila.phoneE164) porTelefono.set(fila.phoneE164, fila)
    if (fila.igUsername) porInstagram.set(fila.igUsername, fila)
    unicas.push(fila)
  }

  return { unicas, duplicadas }
}

/** Completa los campos vacíos de `destino` con los de `origen`. Nunca pisa. */
export function fusionarEnAnterior(destino: FilaPreparada, origen: FilaPreparada): void {
  if (!destino.phoneE164 && origen.phoneE164) {
    destino.phoneE164 = origen.phoneE164
    destino.phoneRaw = origen.phoneRaw
    destino.hasWhatsapp = origen.hasWhatsapp
    destino.dedupeKey = origen.phoneE164
  }
  if (!destino.igUsername && origen.igUsername) {
    destino.igUsername = origen.igUsername
    destino.hasInstagram = origen.hasInstagram
  }
  for (const campo of ['contactName', 'niche', 'bought', 'city', 'notes', 'accountRaw'] as const) {
    if (!destino[campo] && origen[campo]) destino[campo] = origen[campo]
  }
}

/** Canal preferido: WhatsApp si hay teléfono válido, si no Instagram. */
export function canalPreferido(f: {
  phoneE164: string | null
  igUsername: string | null
}): 'whatsapp' | 'instagram' | null {
  if (f.phoneE164) return 'whatsapp'
  if (f.igUsername) return 'instagram'
  return null
}
