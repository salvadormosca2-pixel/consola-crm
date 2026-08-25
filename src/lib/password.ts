import { randomInt } from 'node:crypto'

/**
 * Contraseñas temporales.
 *
 * Se leen en voz alta y se escriben en el teclado de un celular, así que no
 * llevan mayúsculas, ni símbolos, ni los caracteres que se confunden entre sí:
 * la o y el cero, la l y el uno. Una contraseña "fuerte" que el setter no puede
 * tipear termina copiada en una nota del teléfono.
 *
 * La fuerza sale del largo y de que dura poco: se cambia obligatoriamente en el
 * primer ingreso.
 */

const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789'

export function generarPasswordTemporal(grupos = 3, largoDeGrupo = 4): string {
  const partes: string[] = []
  for (let g = 0; g < grupos; g++) {
    let parte = ''
    for (let i = 0; i < largoDeGrupo; i++) {
      parte += ALFABETO[randomInt(ALFABETO.length)]
    }
    partes.push(parte)
  }
  return partes.join('-')
}

/**
 * La tarjeta de acceso que le paso al setter por donde ya hablo con él.
 *
 * No se manda ningún mail desde el sistema: el equipo se coordina por WhatsApp
 * y un mail más es un mail que no lee. Esto se copia entero y se pega.
 */
export function tarjetaDeAcceso(params: {
  nombre: string
  email: string
  password: string
  url: string
}): string {
  return [
    `Hola ${params.nombre}, este es tu acceso:`,
    '',
    params.url,
    `Usuario: ${params.email}`,
    `Contraseña: ${params.password}`,
    '',
    'Al entrar te va a pedir que elijas una contraseña tuya.',
    '',
    'Para tenerla como app en el celular:',
    'Android: abrí el link en Chrome, menú (⋮) → "Agregar a pantalla de inicio".',
    'iPhone: abrí el link en Safari, Compartir → "Agregar a pantalla de inicio".',
  ].join('\n')
}
