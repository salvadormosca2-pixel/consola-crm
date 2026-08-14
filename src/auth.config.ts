import type { NextAuthConfig } from 'next-auth'

/**
 * Configuración liviana, sin dependencias de Node: la usa el middleware para
 * decidir si la petición pasa. El proveedor de credenciales (que necesita
 * argon2 y la base) vive en auth.ts, que solo corre en el servidor Node.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/ingresar' },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const logueado = Boolean(auth?.user)
      const { pathname } = request.nextUrl

      if (pathname === '/ingresar') {
        if (logueado) return Response.redirect(new URL('/contactos', request.nextUrl))
        return true
      }
      return logueado
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.email = user.email
      }
      return token
    },
    session({ session, token }) {
      if (token.id && session.user) session.user.id = String(token.id)
      return session
    },
  },
} satisfies NextAuthConfig
