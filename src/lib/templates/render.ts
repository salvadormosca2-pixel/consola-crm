/**
 * Armado del mensaje a partir de una plantilla.
 *
 * Regla dura de la spec, y es la razón por la que esto es una función pura y
 * testeada aparte: **si falta el dato de una variable, el mensaje NO se manda.**
 * Se marca `saltado` con el motivo y aparece en Revisar. Nunca sale
 * "Hola {{nombre}}" ni "Hola ,".
 */

export const VARIABLES = [
  'negocio',
  'nombre',
  'rubro',
  'compro',
  'ciudad',
  'mi_nombre',
  'oferta',
] as const

export type Variable = (typeof VARIABLES)[number]

export const VARIABLE_META: Record<Variable, { label: string; origen: string }> = {
  negocio: { label: '{{negocio}}', origen: 'Nombre del negocio' },
  nombre: { label: '{{nombre}}', origen: 'Nombre de la persona' },
  rubro: { label: '{{rubro}}', origen: 'Rubro del contacto' },
  compro: { label: '{{compro}}', origen: 'Qué te compró antes' },
  ciudad: { label: '{{ciudad}}', origen: 'Ciudad del contacto' },
  mi_nombre: { label: '{{mi_nombre}}', origen: 'Configuración' },
  oferta: { label: '{{oferta}}', origen: 'Configuración' },
}

export type Datos = Partial<Record<Variable, string | null | undefined>>

export type ResultadoRender =
  | { ok: true; texto: string; usadas: Variable[] }
  | { ok: false; motivo: string; faltantes: string[] }

const PATRON = /\{\{\s*([a-z_]+)\s*\}\}/gi

/** Variables que usa una plantilla, en orden de aparición y sin repetir. */
export function variablesDe(cuerpo: string): string[] {
  const vistas = new Set<string>()
  for (const m of cuerpo.matchAll(PATRON)) {
    const v = (m[1] ?? '').toLowerCase()
    if (v) vistas.add(v)
  }
  return [...vistas]
}

/** Variables escritas en la plantilla que no existen. */
export function variablesDesconocidas(cuerpo: string): string[] {
  return variablesDe(cuerpo).filter((v) => !VARIABLES.includes(v as Variable))
}

/**
 * Reemplaza las variables por los datos del contacto.
 *
 * Falla —y no manda— si alguna variable de la plantilla no tiene dato. Esto es
 * a propósito: es preferible saltear un contacto y revisarlo que mandarle un
 * mensaje que se nota automático.
 */
export function renderTemplate(cuerpo: string, datos: Datos): ResultadoRender {
  const usadas = variablesDe(cuerpo)

  const desconocidas = usadas.filter((v) => !VARIABLES.includes(v as Variable))
  if (desconocidas.length > 0) {
    return {
      ok: false,
      motivo: `La plantilla usa variables que no existen: ${desconocidas.map((v) => `{{${v}}}`).join(', ')}.`,
      faltantes: desconocidas,
    }
  }

  const faltantes = usadas.filter((v) => {
    const valor = datos[v as Variable]
    return valor === null || valor === undefined || String(valor).trim().length === 0
  })

  if (faltantes.length > 0) {
    return {
      ok: false,
      motivo:
        faltantes.length === 1
          ? `Falta el dato de {{${faltantes[0]}}}.`
          : `Faltan los datos de ${faltantes.map((v) => `{{${v}}}`).join(', ')}.`,
      faltantes,
    }
  }

  const texto = cuerpo
    .replace(PATRON, (_, v: string) => String(datos[v.toLowerCase() as Variable] ?? '').trim())
    // Espacios dobles y espacios antes de puntuación quedan feos y delatan un
    // reemplazo automático.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .trim()

  return { ok: true, texto, usadas: usadas as Variable[] }
}

/**
 * Elige qué variante de la plantilla usar.
 *
 * Rota de forma estable según el contacto: el mismo contacto recibe siempre la
 * misma variante, y a lo largo de una lista las variantes quedan repartidas
 * parejo. Sirve para que no salgan 300 mensajes idénticos y para poder comparar
 * qué redacción responde mejor.
 */
export function elegirVariante(
  cuerpo: string,
  variantes: unknown,
  semilla: string,
): { texto: string; indice: number } {
  const lista = Array.isArray(variantes)
    ? variantes.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : []

  const todas = [cuerpo, ...lista]
  if (todas.length === 1) return { texto: cuerpo, indice: 0 }

  let h = 0
  for (let i = 0; i < semilla.length; i++) h = (h * 31 + semilla.charCodeAt(i)) >>> 0
  const indice = h % todas.length
  return { texto: todas[indice]!, indice }
}

/**
 * Vista previa: reemplaza lo que hay y deja marcado lo que falta, en vez de
 * fallar. Es para el editor de plantillas, no para enviar.
 */
export function renderParaVistaPrevia(
  cuerpo: string,
  datos: Datos,
): { texto: string; faltantes: string[] } {
  const faltantes: string[] = []
  const texto = cuerpo.replace(PATRON, (_, v: string) => {
    const clave = v.toLowerCase() as Variable
    const valor = datos[clave]
    if (valor === null || valor === undefined || String(valor).trim().length === 0) {
      faltantes.push(clave)
      return `⟨${clave}?⟩`
    }
    return String(valor).trim()
  })
  return { texto, faltantes: [...new Set(faltantes)] }
}

/** Datos del contacto listos para el render. */
export function datosDeContacto(c: {
  businessName: string
  contactName: string | null
  niche: string | null
  bought: string | null
  city: string | null
}, config: { miNombre?: string | null; oferta?: string | null } = {}): Datos {
  return {
    negocio: c.businessName,
    // El nombre de pila solo: "Hola María Fernanda Quiroga" no lo escribe nadie.
    nombre: c.contactName ? c.contactName.trim().split(/\s+/)[0] : null,
    rubro: c.niche,
    compro: c.bought,
    ciudad: c.city,
    mi_nombre: config.miNombre ?? null,
    oferta: config.oferta ?? null,
  }
}

/** Link que abre WhatsApp con el mensaje ya cargado. */
export function linkWhatsApp(e164: string, texto: string): string {
  return `https://wa.me/${e164}?text=${encodeURIComponent(texto)}`
}

/** Link que abre el chat de Instagram. El mensaje va por portapapeles. */
export function linkInstagram(usuario: string): string {
  return `https://ig.me/m/${usuario}`
}
