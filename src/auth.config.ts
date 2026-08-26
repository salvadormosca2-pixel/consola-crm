import type { NextAuthConfig } from 'next-auth'

import type { UserRole } from '@/db/enums'

/**
 * Configuración liviana, sin dependencias de Node: la usa el middleware para
 * decidir si la petición pasa. El proveedor de credenciales (que necesita
 * argon2 y la base) vive en auth.ts, que solo corre en el servidor Node.
 */

/** A dónde va cada quien al entrar. */
export function rutaInicial(rol: UserRole | undefined): '/hoy' | '/equipo' {
  return rol === 'setter' ? '/hoy' : '/equipo'
}

/**
 * Las rutas de la app del setter. Todo lo demás es panel.
 *
 * Una pantalla nueva del setter que no esté en esta lista **no existe para
 * él**: el portero lo rebota a `/hoy` sin decir por qué. Es lo mismo que pasó
 * con `/referencias` cuando se agregó.
 */
const RUTAS_SETTER = ['/hoy', '/mis-leads', '/referencias', '/avisos']

function esRutaDeSetter(pathname: string): boolean {
  return RUTAS_SETTER.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

/** Rutas a las que se llega en cualquier rol, ya logueado. */
const RUTAS_COMUNES = ['/cambiar-clave', '/salir', '/api/push', '/manifest.webmanifest']

export const authConfig = {
  trustHost: true,
  /**
   * La sesión dura un año y se renueva sola con el uso.
   *
   * El setter abre esto veinte veces por día desde el celular, parado, con una
   * mano. Hacerlo tipear la contraseña cada tanto no protege nada —el teléfono
   * ya está desbloqueado con su huella— y sí garantiza que la anote en un papel
   * o que pierda dos minutos justo cuando tenía que mandar un mensaje.
   *
   * `updateAge` en un día es lo que la hace deslizante: cada vez que entra, si
   * pasó más de un día, el plazo arranca de nuevo. En la práctica, alguien que
   * usa la app cada semana no vuelve a ver la pantalla de ingreso nunca.
   *
   * Cerrar sesión a la fuerza sigue estando: el admin lo hace desde la ficha
   * del setter, y eso invalida sus accesos al instante.
   */
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 365,
    updateAge: 60 * 60 * 24,
  },
  pages: { signIn: '/ingresar' },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const usuario = auth?.user
      const { pathname } = request.nextUrl
      const rol = usuario?.rol

      if (pathname === '/ingresar') {
        if (usuario) return Response.redirect(new URL(rutaInicial(rol), request.nextUrl))
        return true
      }

      if (!usuario) return false

      if (RUTAS_COMUNES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return true

      /*
       * Los permisos se controlan en el servidor, no escondiendo botones. Un
       * setter que edita la URL a mano rebota acá, y si algo se le escapara al
       * portero, cada pantalla del panel vuelve a pedir el rol contra la base.
       */
      if (rol === 'setter') {
        if (!esRutaDeSetter(pathname)) {
          return Response.redirect(new URL('/hoy', request.nextUrl))
        }
        return true
      }

      // Un admin en la app del setter no tiene cola propia: va a su tablero.
      if (esRutaDeSetter(pathname)) {
        return Response.redirect(new URL('/equipo', request.nextUrl))
      }
      return true
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.email = user.email
        token.rol = user.rol
      }
      return token
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = String(token.id)
        session.user.rol = (token.rol ?? 'setter') as UserRole
        session.user.emitidoEn = typeof token.iat === 'number' ? token.iat : 0
      }
      return session
    },
  },
} satisfies NextAuthConfig
