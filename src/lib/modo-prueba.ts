/**
 * Modo prueba: entrar sin contraseña.
 *
 * Existe para poder recorrer la app cambiando de rol a cada rato sin tipear
 * credenciales. Es, literalmente, un salteo de autenticación, así que está
 * cerrado con tres llaves y las tres tienen que estar puestas a la vez:
 *
 *   1. `NODE_ENV` distinto de `production`. En un build de producción la
 *      pasarela **no se compila**: no existe el proveedor de acceso.
 *   2. `MODO_PRUEBA=true` en el entorno. Hay que encenderlo a propósito.
 *   3. La cuenta tiene que ser de demostración (`@demo.local`) y no puede ser
 *      la cuenta madre.
 *
 * La tercera es la que importa aunque las otras dos fallen: aunque alguien
 * encienda esto en un servidor, no puede entrar como vos ni como ninguna
 * persona real — solo como los muñecos que crea `npm run demo:setters`.
 */

/** Dominio de las cuentas que pueden entrar sin contraseña. */
export const DOMINIO_DE_PRUEBA = '@demo.local'

export function modoPrueba(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.MODO_PRUEBA === 'true'
}

export function esCuentaDePrueba(email: string): boolean {
  return email.toLowerCase().endsWith(DOMINIO_DE_PRUEBA)
}
