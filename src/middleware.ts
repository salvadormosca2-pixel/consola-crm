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
   */
  matcher: [
    '/((?!api/auth|api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)',
  ],
}
