import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Cifrado de credenciales guardadas en la base (token de Chatwoot, tokens de
 * instancia de Evolution).
 *
 * AES-256-GCM: además de cifrar, autentica. Si alguien edita el valor en la
 * base, el descifrado falla en vez de devolver basura silenciosamente.
 *
 * La clave vive solo en el entorno del servidor. Nada de esto puede llegar al
 * cliente ni a una variable NEXT_PUBLIC_.
 */

const ALGORITMO = 'aes-256-gcm'
const LARGO_IV = 12 // recomendado para GCM
const LARGO_TAG = 16
const PREFIJO = 'v1'

let claveCache: Buffer | null = null

/** Lee y valida la clave maestra del entorno. */
function clave(): Buffer {
  if (claveCache) return claveCache

  const cruda = process.env.ENCRYPTION_KEY
  if (!cruda) {
    throw new Error(
      'Falta ENCRYPTION_KEY. Generala con:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }

  const buf = Buffer.from(cruda, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY tiene que ser de 32 bytes en base64 (son ${buf.length}). ` +
        'Regenerala con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }

  claveCache = buf
  return buf
}

/** Solo para tests: obliga a releer la clave del entorno. */
export function _resetClave(): void {
  claveCache = null
}

/**
 * Cifra un secreto. El resultado es `v1.<iv>.<tag>.<datos>` en base64url, apto
 * para guardar en una columna de texto.
 */
export function cifrar(texto: string): string {
  if (texto.length === 0) throw new Error('No tiene sentido cifrar una cadena vacía.')

  const iv = randomBytes(LARGO_IV)
  const cipher = createCipheriv(ALGORITMO, clave(), iv)
  const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [PREFIJO, b64(iv), b64(tag), b64(datos)].join('.')
}

/**
 * Descifra un secreto. Tira si el valor fue alterado, si la clave cambió o si
 * el formato no es el esperado — nunca devuelve un valor parcial.
 */
export function descifrar(valor: string): string {
  const partes = valor.split('.')
  if (partes.length !== 4 || partes[0] !== PREFIJO) {
    throw new Error('El valor cifrado no tiene el formato esperado.')
  }

  const [, ivB64, tagB64, datosB64] = partes
  const iv = deB64(ivB64!)
  const tag = deB64(tagB64!)
  const datos = deB64(datosB64!)

  if (iv.length !== LARGO_IV || tag.length !== LARGO_TAG) {
    throw new Error('El valor cifrado está corrupto.')
  }

  try {
    const decipher = createDecipheriv(ALGORITMO, clave(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8')
  } catch {
    throw new Error(
      'No se pudo descifrar la credencial. O cambió ENCRYPTION_KEY, o el valor fue alterado. ' +
        'Volvé a cargar la credencial desde Configuración.',
    )
  }
}

/** Muestra un token sin revelarlo: `abcd…7f92`. */
export function enmascarar(texto: string): string {
  if (texto.length <= 8) return '••••'
  return `${texto.slice(0, 4)}…${texto.slice(-4)}`
}

/**
 * Compara dos secretos en tiempo constante.
 *
 * Se usa para validar la firma del webhook de Chatwoot: una comparación con
 * `===` filtra información por el tiempo que tarda en fallar.
 */
export function comparaSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // timingSafeEqual exige el mismo largo, así que el largo se compara aparte.
  // Filtrar el largo no es un riesgo real para un secreto de largo fijo.
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Genera un secreto de webhook nuevo. */
export function generarSecreto(bytes = 32): string {
  return b64(randomBytes(bytes))
}

function b64(b: Buffer): string {
  return b.toString('base64url')
}

function deB64(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}
