/**
 * Constantes del equipo que comparten el servidor y la pantalla.
 *
 * Viven acá y no en las server actions porque un archivo `'use server'` solo
 * puede exportar funciones asíncronas: una constante ahí adentro no compila.
 */

/**
 * Lo que hay que escribir para vaciar el equipo.
 *
 * La escribe la pantalla y la vuelve a exigir la acción. Un "¿estás seguro?"
 * con un botón al lado se contesta que sí sin leer; escribir una palabra no.
 */
export const PALABRA_PARA_VACIAR = 'VACIAR'
