/**
 * Normalización de teléfonos argentinos a E.164.
 *
 * Es la pieza que más se rompe del importador, así que vale explicar el modelo.
 *
 * En Argentina el número nacional significativo (código de área + abonado) son
 * SIEMPRE 10 dígitos. Lo que varía es el largo del código de área: 2 dígitos
 * (solo el 11), 3 dígitos (las capitales grandes) o 4 dígitos (el resto).
 *
 *   11 5555 5555   → área 11,  abonado 55555555
 *   383 456 7890   → área 383, abonado 4567890
 *   3837 45 6789   → área 3837, abonado 456789
 *
 * El `15` es un prefijo de celular que se marca DESPUÉS del código de área y no
 * forma parte del número. Por eso no se puede borrar "el 15" a ciegas: hay que
 * saber dónde termina el área. Un número con 15 tiene 12 dígitos; sin 15, 10.
 *
 * Para WhatsApp, el formato es 54 + 9 + los 10 dígitos, sin el 15:
 *   0383 15 456 7890  →  5493834567890
 *
 * Lo que NO se puede saber mirando el número: si es un celular o un fijo. Los
 * dos comparten código de área y largo. Por eso `hasWhatsapp` significa
 * "formato válido y normalizable", no "tiene WhatsApp": eso se verifica recién
 * contra la API, y se anota en `wa_verified_at`.
 */

/** El único código de área de 2 dígitos. */
const AREA_2 = '11'

/**
 * Códigos de área de 3 dígitos. El resto de los códigos que empiezan con 2 o 3
 * son de 4 dígitos. Esta lista es lo que permite saber dónde termina el área y,
 * por lo tanto, dónde está el 15.
 */
const AREAS_3 = new Set([
  '220', '221', '223', '230', '236', '237', '249', '260', '261', '263', '264',
  '266', '280', '291', '297', '299',
  '336', '341', '342', '343', '345', '348', '351', '353', '358', '362', '364',
  '370', '376', '379', '380', '381', '383', '385', '387', '388',
])

export type MotivoTelefono =
  | 'vacio'
  | 'sin_digitos'
  | 'corto'
  | 'largo'
  | 'sin_codigo_de_area'
  | 'area_invalida'
  | 'formato_desconocido'

export const MOTIVOS_TELEFONO: Record<MotivoTelefono, string> = {
  vacio: 'La celda está vacía.',
  sin_digitos: 'No tiene ningún dígito.',
  corto: 'Tiene menos dígitos de los que necesita un número argentino.',
  largo: 'Tiene más dígitos de los que puede tener un número.',
  sin_codigo_de_area: 'Empieza con 15 pero no tiene código de área, así que no se sabe de qué ciudad es.',
  area_invalida: 'El código de área no existe.',
  formato_desconocido: 'No se pudo interpretar como un número argentino.',
}

export type ResultadoTelefono =
  | {
      ok: true
      /** E.164 sin el '+': '5493834567890'. */
      e164: string
      /** Código de área detectado, para poder mostrarlo y auditarlo. */
      area: string
      /** true si el número no es argentino y se respetó tal cual vino. */
      extranjero: boolean
    }
  | { ok: false; motivo: MotivoTelefono; detalle: string }

/**
 * Normaliza un teléfono a E.164.
 *
 * Si el valor trae un `+` con un código de país que no es 54, se respeta tal
 * cual: la lista puede tener algún cliente de afuera y forzarlo a formato
 * argentino sería peor que dejarlo pasar.
 */
export function normalizarTelefonoAr(crudo: string | number | null | undefined): ResultadoTelefono {
  if (crudo === null || crudo === undefined) {
    return { ok: false, motivo: 'vacio', detalle: MOTIVOS_TELEFONO.vacio }
  }

  const texto = String(crudo).trim()
  if (texto.length === 0) {
    return { ok: false, motivo: 'vacio', detalle: MOTIVOS_TELEFONO.vacio }
  }

  // Un '+' en cualquier posición inicial cuenta como marca de internacional.
  // Excel a veces se come el '+' y deja '00' adelante, que es lo mismo.
  const tieneMasInicial = /^\s*\+/.test(texto)
  let d = texto.replace(/\D/g, '')

  if (d.length === 0) {
    return { ok: false, motivo: 'sin_digitos', detalle: MOTIVOS_TELEFONO.sin_digitos }
  }

  let eraInternacional = tieneMasInicial
  if (d.startsWith('00')) {
    d = d.slice(2)
    eraInternacional = true
  }

  // Número de otro país: se respeta como vino.
  if (eraInternacional && !d.startsWith('54')) {
    if (d.length < 8 || d.length > 15) {
      return { ok: false, motivo: d.length < 8 ? 'corto' : 'largo', detalle: MOTIVOS_TELEFONO[d.length < 8 ? 'corto' : 'largo'] }
    }
    return { ok: true, e164: d, area: '', extranjero: true }
  }

  // ── A partir de acá se trabaja el número nacional argentino ────────────
  // Se saca el 54 de país, el 9 de celular y el 0 de larga distancia, en ese
  // orden, porque así es como se anidan.
  if (d.startsWith('54') && d.length >= 12) d = d.slice(2)
  if (d.startsWith('9') && d.length >= 11) d = d.slice(1)
  if (d.startsWith('0')) d = d.replace(/^0+/, '')

  if (d.length === 0) {
    return { ok: false, motivo: 'sin_digitos', detalle: MOTIVOS_TELEFONO.sin_digitos }
  }

  // Con 15 adelante y sin código de área no se puede saber la ciudad.
  // Pasa seguido: la gente anota "15 1234 5678" del celular de al lado.
  if (d.length === 10 && d.startsWith('15')) {
    return {
      ok: false,
      motivo: 'sin_codigo_de_area',
      detalle: MOTIVOS_TELEFONO.sin_codigo_de_area,
    }
  }

  // 12 dígitos = tiene el 15 metido después del código de área.
  if (d.length === 12) {
    const sinQuince = sacarElQuince(d)
    if (sinQuince === null) {
      return { ok: false, motivo: 'formato_desconocido', detalle: MOTIVOS_TELEFONO.formato_desconocido }
    }
    d = sinQuince
  }

  // 11 dígitos: suele ser un 15 pegado a un número sin área, o un dígito de más.
  if (d.length === 11 && d.startsWith('15')) {
    return { ok: false, motivo: 'sin_codigo_de_area', detalle: MOTIVOS_TELEFONO.sin_codigo_de_area }
  }

  if (d.length < 10) {
    return { ok: false, motivo: 'corto', detalle: MOTIVOS_TELEFONO.corto }
  }
  if (d.length > 10) {
    return { ok: false, motivo: 'largo', detalle: MOTIVOS_TELEFONO.largo }
  }

  const area = detectarArea(d)
  if (area === null) {
    return { ok: false, motivo: 'area_invalida', detalle: MOTIVOS_TELEFONO.area_invalida }
  }

  return { ok: true, e164: `549${d}`, area, extranjero: false }
}

/**
 * Saca el `15` de un número nacional de 12 dígitos, probando las tres
 * posiciones posibles del código de área.
 */
function sacarElQuince(d: string): string | null {
  if (d.startsWith(AREA_2) && d.slice(2, 4) === '15') return AREA_2 + d.slice(4)

  const tres = d.slice(0, 3)
  if (AREAS_3.has(tres) && d.slice(3, 5) === '15') return tres + d.slice(5)

  // El resto de los códigos son de 4 dígitos.
  const cuatro = d.slice(0, 4)
  if (/^[23]/.test(cuatro) && d.slice(4, 6) === '15') return cuatro + d.slice(6)

  return null
}

/**
 * Devuelve el código de área de un número nacional de 10 dígitos.
 *
 * Ojo con una ambigüedad real del plan de numeración: hay códigos de 3 dígitos
 * que son prefijo de códigos de 4 (383 de Catamarca capital y 3837 de
 * Andalgalá, por ejemplo). Mirando solo el número no se puede resolver sin la
 * tabla de prefijos de abonado, que no es pública de forma confiable.
 *
 * Se prefiere el código de 3 dígitos, que es el de la ciudad más grande y el
 * caso más frecuente. **Esto no afecta el E.164**: los 10 dígitos son los
 * mismos se corte donde se corte, así que el número que se le manda a WhatsApp
 * es correcto igual. El área solo se usa para mostrar.
 *
 * Donde sí importa el corte es al sacar el 15, y ahí `sacarElQuince` no
 * adivina: prueba cada largo y se queda con el que efectivamente tiene un 15
 * en la posición correcta.
 */
export function detectarArea(nsn: string): string | null {
  if (nsn.length !== 10) return null
  if (nsn.startsWith(AREA_2)) return AREA_2

  const tres = nsn.slice(0, 3)
  if (AREAS_3.has(tres)) return tres

  const cuatro = nsn.slice(0, 4)
  // Todos los códigos argentinos empiezan con 1, 2 o 3, y el 1 es solo el 11.
  if (/^[23]\d{3}$/.test(cuatro)) return cuatro

  return null
}

/** Formato lindo para mostrar: '+54 9 383 456-7890'. */
export function formatearTelefono(e164: string | null | undefined): string {
  if (!e164) return '—'
  if (!e164.startsWith('549') || e164.length !== 13) return `+${e164}`

  const nsn = e164.slice(3)
  const area = detectarArea(nsn)
  if (!area) return `+${e164}`

  const abonado = nsn.slice(area.length)
  const corte = abonado.length - 4
  return `+54 9 ${area} ${abonado.slice(0, corte)}-${abonado.slice(corte)}`
}

/* ── Instagram ──────────────────────────────────────────────────────────── */

export type ResultadoInstagram =
  | { ok: true; usuario: string }
  | { ok: false; motivo: 'vacio' | 'invalido'; detalle: string }

/**
 * Normaliza un usuario de Instagram: sin arroba, sin URL, en minúsculas y sin
 * espacios. `@Usuario`, `instagram.com/usuario/` y `Usuario ` dan todos
 * `usuario`.
 */
export function normalizarInstagram(crudo: string | null | undefined): ResultadoInstagram {
  if (crudo === null || crudo === undefined) {
    return { ok: false, motivo: 'vacio', detalle: 'La celda está vacía.' }
  }

  const usuario = String(crudo)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@+/, '')
    .replace(/\s+/g, '')
    .toLowerCase()

  if (usuario.length === 0) {
    return { ok: false, motivo: 'vacio', detalle: 'La celda está vacía.' }
  }

  // Instagram permite letras, números, punto y guion bajo, hasta 30 caracteres.
  if (!/^[a-z0-9._]{1,30}$/.test(usuario)) {
    return {
      ok: false,
      motivo: 'invalido',
      detalle: 'El usuario tiene caracteres que Instagram no permite.',
    }
  }

  return { ok: true, usuario }
}
