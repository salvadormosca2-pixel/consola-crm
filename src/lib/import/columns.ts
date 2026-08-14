/**
 * Detección automática de columnas del Excel.
 *
 * El mapeo que adivina esto siempre se puede corregir a mano antes de importar,
 * así que el criterio es acertar seguido sin arriesgar: ante la duda, no mapea
 * y deja que la persona elija.
 */

export const CAMPOS = [
  'business_name',
  'contact_name',
  'phone',
  'instagram',
  'niche',
  'bought',
  'city',
  'notes',
  'account',
] as const

export type Campo = (typeof CAMPOS)[number]

export const CAMPO_META: Record<Campo, { label: string; ayuda: string; requerido?: boolean }> = {
  business_name: { label: 'Negocio', ayuda: 'El nombre del comercio', requerido: true },
  contact_name: { label: 'Nombre', ayuda: 'La persona con la que hablás' },
  phone: { label: 'Teléfono', ayuda: 'Se normaliza a formato internacional' },
  instagram: { label: 'Instagram', ayuda: 'Usuario o link, se limpia solo' },
  niche: { label: 'Rubro', ayuda: 'Peluquería, gimnasio…' },
  bought: { label: 'Qué compró', ayuda: 'Alimenta la variable {{compro}}' },
  city: { label: 'Ciudad', ayuda: '' },
  notes: { label: 'Notas', ayuda: '' },
  account: { label: 'Cuenta asignada', ayuda: 'Código o número de la cuenta que le escribe' },
}

/**
 * Sinónimos por campo. Se comparan contra el encabezado normalizado (sin
 * acentos, sin signos, en minúsculas).
 */
const SINONIMOS: Record<Campo, string[]> = {
  business_name: [
    'negocio', 'empresa', 'comercio', 'razonsocial', 'razon', 'local', 'tienda',
    'nombrenegocio', 'nombredelnegocio', 'nombrecomercial', 'business', 'company',
    'nombrefantasia', 'marca', 'cliente',
  ],
  contact_name: [
    'nombre', 'contacto', 'nombrecontacto', 'nombredecontacto', 'persona',
    'titular', 'duenio', 'dueno', 'encargado', 'name', 'firstname', 'nombreyapellido',
  ],
  phone: [
    'telefono', 'tel', 'celular', 'cel', 'whatsapp', 'wsp', 'wa', 'movil',
    'numero', 'nro', 'phone', 'mobile', 'contactotelefono', 'telefonos',
  ],
  instagram: ['instagram', 'ig', 'usuario', 'usuarioig', 'usuarioinstagram', 'arroba', 'perfil', 'insta'],
  niche: ['rubro', 'categoria', 'tipo', 'actividad', 'sector', 'nicho', 'niche', 'industria'],
  bought: [
    'compro', 'quecompro', 'compra', 'producto', 'servicio', 'pedido',
    'ultimacompra', 'adquirio', 'contrato',
  ],
  city: ['ciudad', 'localidad', 'provincia', 'zona', 'city', 'domicilio', 'direccion'],
  notes: ['notas', 'nota', 'observaciones', 'comentarios', 'obs', 'detalle', 'notes'],
  account: ['cuenta', 'cuentaasignada', 'numeroasignado', 'emisor', 'linea', 'asignado', 'wa'],
}

/** Saca acentos, signos y espacios para poder comparar encabezados. */
export function normalizarEncabezado(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export type Mapeo = Partial<Record<Campo, number>>

/**
 * Adivina qué columna corresponde a cada campo.
 *
 * Prioridad: coincidencia exacta del encabezado, después que el encabezado
 * contenga el sinónimo. Una columna no se asigna a dos campos, y `wa` no se usa
 * como sinónimo de cuenta si ya hay algo que parezca teléfono.
 */
export function adivinarMapeo(encabezados: string[], filas: string[][] = []): Mapeo {
  const normalizados = encabezados.map(normalizarEncabezado)
  const mapeo: Mapeo = {}
  const usadas = new Set<number>()

  const asignar = (campo: Campo, indice: number) => {
    if (usadas.has(indice) || mapeo[campo] !== undefined) return
    mapeo[campo] = indice
    usadas.add(indice)
  }

  // 1. Coincidencia exacta.
  for (const campo of CAMPOS) {
    const idx = normalizados.findIndex((h, i) => !usadas.has(i) && SINONIMOS[campo].includes(h))
    if (idx >= 0) asignar(campo, idx)
  }

  // 2. El encabezado contiene el sinónimo. Se prueban los sinónimos más largos
  //    primero, para que 'nombrenegocio' gane sobre 'nombre'.
  for (const campo of CAMPOS) {
    if (mapeo[campo] !== undefined) continue
    const orden = [...SINONIMOS[campo]].sort((a, b) => b.length - a.length)
    for (const sin of orden) {
      if (sin.length < 3) continue
      const idx = normalizados.findIndex((h, i) => !usadas.has(i) && h.includes(sin))
      if (idx >= 0) {
        asignar(campo, idx)
        break
      }
    }
  }

  // 3. Si no se encontró teléfono ni Instagram por el encabezado, se mira el
  //    contenido: una columna donde la mayoría de los valores parecen teléfonos
  //    es la de teléfonos, aunque el encabezado diga cualquier cosa.
  if (mapeo.phone === undefined && filas.length > 0) {
    const idx = columnaQueParece(filas, encabezados.length, usadas, pareceTelefono)
    if (idx !== null) asignar('phone', idx)
  }
  if (mapeo.instagram === undefined && filas.length > 0) {
    const idx = columnaQueParece(filas, encabezados.length, usadas, pareceInstagram)
    if (idx !== null) asignar('instagram', idx)
  }

  return mapeo
}

function columnaQueParece(
  filas: string[][],
  columnas: number,
  usadas: Set<number>,
  predicado: (v: string) => boolean,
): number | null {
  let mejor: number | null = null
  let mejorRatio = 0

  for (let c = 0; c < columnas; c++) {
    if (usadas.has(c)) continue
    const valores = filas.map((f) => (f[c] ?? '').trim()).filter((v) => v.length > 0)
    if (valores.length === 0) continue
    const ratio = valores.filter(predicado).length / valores.length
    if (ratio > 0.7 && ratio > mejorRatio) {
      mejorRatio = ratio
      mejor = c
    }
  }
  return mejor
}

function pareceTelefono(v: string): boolean {
  const d = v.replace(/\D/g, '')
  return d.length >= 8 && d.length <= 15 && /^[\d\s()+.\-]+$/.test(v)
}

function pareceInstagram(v: string): boolean {
  return /^@/.test(v.trim()) || /instagram\.com/i.test(v)
}

/** Un mapeo sirve si tiene nombre de negocio y al menos un canal. */
export function mapeoCompleto(mapeo: Mapeo): { ok: boolean; falta: string[] } {
  const falta: string[] = []
  if (mapeo.business_name === undefined) falta.push('Negocio')
  if (mapeo.phone === undefined && mapeo.instagram === undefined) {
    falta.push('Teléfono o Instagram (al menos uno)')
  }
  return { ok: falta.length === 0, falta }
}
