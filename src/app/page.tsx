import { redirect } from 'next/navigation'

import { rutaInicial } from '@/auth.config'
import { sesionActual } from '@/server/session'

/**
 * La puerta de entrada, que se adapta a quién entra.
 *
 * Es también el `start_url` de la PWA: el ícono del celular abre acá y el
 * setter cae en su cola. Apuntar el manifiesto directo a `/hoy` hacía que el
 * navegador golpeara esa ruta cada vez que revisaba si la app se puede
 * instalar, aunque no hubiera sesión.
 */
export default async function Raiz() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')
  if (sesion.debeCambiarPassword) redirect('/cambiar-clave')
  redirect(rutaInicial(sesion.rol))
}
