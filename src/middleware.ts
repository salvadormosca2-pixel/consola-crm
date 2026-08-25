import NextAuth from 'next-auth'

import { authConfig } from '@/auth.config'

export const { auth: middleware } = NextAuth(authConfig)

export const config = {
  /*
   * Todo pasa por el portero salvo estáticos, imágenes y dos familias de rutas:
   *
   *   api/auth      — el login mismo.
   *   api/webhooks  — los servidores externos no tienen cookie de sesión.
   *                   Chatwoot no puede loguearse, así que si el portero los
   *                   frena, los redirige a /ingresar y NINGÚN evento llega
   *                   nunca: la consola creería que nadie contestó y seguiría
   *                   mandando seguimientos. Cada webhook se autentica solo,
   *                   con su propio secreto.
   *   api/tareas    — las tareas del reloj, que llama un programador externo
   *                   con su propio secreto.
   *   api/salud     — el chequeo de Coolify, que pega sin cookie antes de
   *                   mandarle tráfico a un contenedor nuevo. Si el portero lo
   *                   redirige a /ingresar, Coolify lo lee como caído y no
   *                   despliega nunca.
   *
   * Los archivos de la PWA (manifiesto, service worker e íconos) también pasan
   * sueltos: el navegador los pide para ofrecer instalar la app, y algunos los
   * piden sin cookies. Si el portero los redirige, el botón de instalar
   * directamente no aparece.
   */
  matcher: [
    '/((?!api/auth|api/webhooks|api/tareas|api/salud|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|iconos/|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)',
  ],
}
