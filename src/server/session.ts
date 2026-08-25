import 'server-only'

import { sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { db } from '@/db'
import { esAdmin, type UserRole, type UserStatus } from '@/db/enums'

/**
 * Quién está pidiendo esto.
 *
 * El token dice el rol, pero **el token no es la autoridad**: un setter al que
 * di de baja hace cinco minutos sigue teniendo su cookie válida por 30 días.
 * Cada petición vuelve a leer el usuario de la base y verifica cuatro cosas:
 * que exista, que esté activo, que su token sea posterior al último "cerrar
 * sesión en todos los dispositivos", y qué rol tiene AHORA.
 *
 * Es una consulta por petición, por índice primario. Es barata, y es la
 * diferencia entre revocar un acceso de verdad y creer que lo revocaste.
 */

export interface Sesion {
  userId: string
  nombre: string
  email: string
  rol: UserRole
  estado: UserStatus
  debeCambiarPassword: boolean
  /** Solo si es setter. Es el id de su ficha, no el del usuario. */
  setterId: string | null
}

export type MotivoDeCorte = 'sesion_vieja' | 'cuenta_pausada' | 'cuenta_baja' | 'cuenta_borrada'

type Resultado =
  | { ok: true; sesion: Sesion }
  | { ok: false; motivo: MotivoDeCorte | null }

async function leerSesion(): Promise<Resultado> {
  const token = await auth()
  const userId = token?.user?.id
  if (!userId) return { ok: false, motivo: null }

  const filas = await db.execute(sql`
    select u.id, u.name, u.email, u.role, u.status, u.must_change_password,
           extract(epoch from u.sessions_valid_from)::bigint as valido_desde,
           s.id as setter_id
      from users u
      left join setters s on s.user_id = u.id
     where u.id = ${userId}
     limit 1
  `)

  const fila = filas.rows[0] as
    | {
        id: string
        name: string
        email: string
        role: UserRole
        status: UserStatus
        must_change_password: boolean
        valido_desde: string | number
        setter_id: string | null
      }
    | undefined

  if (!fila) return { ok: false, motivo: 'cuenta_borrada' }
  if (fila.status === 'pausado') return { ok: false, motivo: 'cuenta_pausada' }
  if (fila.status === 'baja') return { ok: false, motivo: 'cuenta_baja' }

  /*
   * Un margen de un minuto: el token se emite un instante antes de que se
   * escriba `sessions_valid_from` en el alta, y sin el margen la persona
   * quedaría afuera del sistema en el mismo momento de entrar.
   */
  const validoDesde = Number(fila.valido_desde)
  if (token.user.emitidoEn > 0 && token.user.emitidoEn + 60 < validoDesde) {
    return { ok: false, motivo: 'sesion_vieja' }
  }

  return {
    ok: true,
    sesion: {
      userId: fila.id,
      nombre: fila.name,
      email: fila.email,
      rol: fila.role,
      estado: fila.status,
      debeCambiarPassword: fila.must_change_password,
      setterId: fila.setter_id,
    },
  }
}

/** La sesión verificada, o null. No redirige: sirve para decidir qué mostrar. */
export async function sesionActual(): Promise<Sesion | null> {
  const r = await leerSesion()
  return r.ok ? r.sesion : null
}

/**
 * Corta la petición y manda a `/salir`, que borra la cookie antes de mandar al
 * ingreso. Ir directo a `/ingresar` con la cookie puesta sería un rebote
 * infinito: el portero ve un token válido y devuelve a la app.
 */
function cortar(motivo: MotivoDeCorte | null): never {
  if (motivo === null) redirect('/ingresar')
  redirect(`/salir?motivo=${motivo}`)
}

/** Cualquiera logueado y en condiciones de trabajar. */
export async function requerirSesion(): Promise<Sesion> {
  const r = await leerSesion()
  if (!r.ok) cortar(r.motivo)
  return r.sesion
}

/**
 * El panel. Un setter que escribe a mano una URL del admin rebota a la suya:
 * no ve un error, ve su pantalla.
 */
export async function requerirAdmin(): Promise<Sesion> {
  const sesion = await requerirSesion()
  if (!esAdmin(sesion.rol)) redirect('/hoy')
  if (sesion.debeCambiarPassword) redirect('/cambiar-clave')
  return sesion
}

/** Credenciales, alta y baja de cuentas, y cambios de rol. Solo yo. */
export async function requerirAdminMadre(): Promise<Sesion> {
  const sesion = await requerirAdmin()
  if (sesion.rol !== 'admin_madre') redirect('/equipo')
  return sesion
}

export interface SesionSetter extends Sesion {
  setterId: string
}

/** La app del celular. */
export async function requerirSetter(): Promise<SesionSetter> {
  const sesion = await requerirSesion()
  if (sesion.rol !== 'setter') redirect('/equipo')
  if (sesion.debeCambiarPassword) redirect('/cambiar-clave')
  /*
   * Un usuario con rol setter y sin ficha es un alta a medias. No se le
   * inventa una: se lo manda a cambiar de contraseña, que es la única pantalla
   * donde no necesita ficha, y el panel muestra el alta incompleta.
   */
  if (!sesion.setterId) redirect('/salir?motivo=cuenta_borrada')
  return { ...sesion, setterId: sesion.setterId }
}

/* ── Versiones para server actions ────────────────────────────────────────
   En una acción no se redirige: se devuelve un error que el formulario pinta
   al lado del botón. Redirigir desde una acción deja al usuario sin saber qué
   pasó con lo que acababa de tocar.                                        */

export class ErrorDePermiso extends Error {
  constructor(mensaje = 'No tenés permiso para hacer esto.') {
    super(mensaje)
    this.name = 'ErrorDePermiso'
  }
}

export async function exigirSesion(): Promise<Sesion> {
  const r = await leerSesion()
  if (!r.ok) throw new ErrorDePermiso('Tu sesión ya no vale. Volvé a entrar.')
  return r.sesion
}

export async function exigirAdmin(): Promise<Sesion> {
  const sesion = await exigirSesion()
  if (!esAdmin(sesion.rol)) throw new ErrorDePermiso()
  return sesion
}

export async function exigirAdminMadre(): Promise<Sesion> {
  const sesion = await exigirSesion()
  if (sesion.rol !== 'admin_madre') {
    throw new ErrorDePermiso('Esto lo puede hacer solamente la cuenta principal.')
  }
  return sesion
}

export async function exigirSetter(): Promise<SesionSetter> {
  const sesion = await exigirSesion()
  if (sesion.rol !== 'setter' || !sesion.setterId) throw new ErrorDePermiso()
  return { ...sesion, setterId: sesion.setterId }
}

/**
 * El setter puede tocar solo lo suyo; el admin, cualquier cosa. Devuelve el
 * setter sobre el que se está actuando y quién lo está haciendo.
 */
export async function exigirSobreSetter(setterId: string): Promise<{
  sesion: Sesion
  esPropio: boolean
}> {
  const sesion = await exigirSesion()
  if (esAdmin(sesion.rol)) return { sesion, esPropio: false }
  if (sesion.rol === 'setter' && sesion.setterId === setterId) return { sesion, esPropio: true }
  throw new ErrorDePermiso()
}
