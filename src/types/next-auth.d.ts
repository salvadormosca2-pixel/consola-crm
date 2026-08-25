import type { DefaultSession } from 'next-auth'

import type { UserRole } from '@/db/enums'

/**
 * El rol viaja en el token para que el portero (que corre en el borde, sin
 * base) pueda rebotar a un setter que escribe a mano una URL del admin.
 *
 * No es la autoridad: la autoridad es `requerirAdmin()` y compañía, que
 * releen el usuario de la base en cada petición. El token solo evita el viaje
 * de ida a una pantalla que igual no le iba a mostrar nada.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      rol: UserRole
      /**
       * Cuándo se emitió el token, en segundos. Se compara contra
       * `sessions_valid_from` del usuario: al cerrar sesión en todos los
       * dispositivos se adelanta esa marca y todo token anterior deja de valer.
       * Es lo que se usa cuando un setter pierde el celular.
       */
      emitidoEn: number
    } & DefaultSession['user']
  }

  interface User {
    rol?: UserRole
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    rol?: UserRole
  }
}
