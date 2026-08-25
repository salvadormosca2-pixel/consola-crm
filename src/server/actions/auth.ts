'use server'

import { hash, verify } from '@node-rs/argon2'
import { eq, sql } from 'drizzle-orm'
import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { signIn, signOut } from '@/auth'
import { rutaInicial } from '@/auth.config'
import { db } from '@/db'
import type { UserRole } from '@/db/enums'
import { events, users } from '@/db/schema'
import { DOMINIO_DE_PRUEBA, esCuentaDePrueba, modoPrueba } from '@/lib/modo-prueba'
import { SETTERS_CONFIG_DEFAULT } from '@/lib/setters-config'
import { exigirSesion } from '@/server/session'

const schema = z.object({
  email: z.string().min(1, 'Escribí tu email.').email('Ese email no tiene formato válido.'),
  password: z.string().min(1, 'Escribí tu contraseña.'),
})

export type EstadoIngreso = { error: string | null }

/** Cada motivo de rechazo dice lo suyo: "bloqueada" no es "te equivocaste". */
const MOTIVOS: Record<string, string> = {
  credenciales: 'Email o contraseña incorrectos.',
  bloqueada:
    `Demasiados intentos fallidos. Esperá ${SETTERS_CONFIG_DEFAULT.minutosDeBloqueo} minutos y probá de nuevo.`,
  pausada: 'Tu cuenta está pausada. Hablá con el administrador.',
  baja: 'Tu cuenta está dada de baja.',
}

export async function ingresar(_prev: EstadoIngreso, formData: FormData): Promise<EstadoIngreso> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  }

  let destino: '/equipo' | '/hoy' | '/cambiar-clave' = '/equipo'

  try {
    await signIn('credentials', { ...parsed.data, redirect: false })

    const [usuario] = await db
      .select({ rol: users.role, debeCambiar: users.mustChangePassword })
      .from(users)
      .where(sql`lower(${users.email}) = ${parsed.data.email.toLowerCase()}`)
      .limit(1)

    // Con la contraseña temporal no se trabaja: primero elige una propia.
    destino = usuario?.debeCambiar ? '/cambiar-clave' : rutaInicial(usuario?.rol)
  } catch (err) {
    if (err instanceof AuthError) {
      const code = 'code' in err && typeof err.code === 'string' ? err.code : 'credenciales'
      return { error: MOTIVOS[code] ?? MOTIVOS.credenciales! }
    }
    console.error('Error al ingresar:', err)
    return { error: 'No pude conectar con la base. Revisá que Postgres esté levantado.' }
  }

  redirect(destino)
}

export async function salir(): Promise<void> {
  await signOut({ redirectTo: '/ingresar' })
}

/* ── Modo prueba ──────────────────────────────────────────────────────── */

export interface CuentaDePrueba {
  email: string
  nombre: string
  rol: UserRole
  detalle: string
}

/**
 * Las cuentas de demostración, para el acceso de un toque.
 *
 * Devuelve una lista vacía si el modo prueba está apagado, así la pantalla de
 * ingreso no muestra ni una pista de que exista esta puerta.
 */
export async function cuentasDePrueba(): Promise<CuentaDePrueba[]> {
  if (!modoPrueba()) return []

  const filas = await db.execute(sql`
    select u.email, u.name, u.role,
           coalesce((select count(*)::int from setter_accounts sa
                      where sa.setter_id = s.id), 0) as cuentas
      from users u
      left join setters s on s.user_id = u.id
     where u.status = 'activo'
       and u.role <> 'admin_madre'
       and lower(u.email) like ${`%${DOMINIO_DE_PRUEBA}`}
     order by u.role desc, u.name asc
  `)

  return (filas.rows as Array<{
    email: string
    name: string
    role: UserRole
    cuentas: number
  }>).map((f) => ({
    email: f.email,
    nombre: f.name,
    rol: f.role,
    detalle:
      f.role === 'setter'
        ? `${f.cuentas} ${f.cuentas === 1 ? 'cuenta' : 'cuentas'} de Instagram`
        : 'Panel completo, sin credenciales',
  }))
}

/** Entra como una cuenta de demostración, sin contraseña. */
export async function entrarDePrueba(email: string): Promise<EstadoIngreso> {
  if (!modoPrueba()) return { error: 'El modo prueba está apagado.' }
  if (!esCuentaDePrueba(email)) return { error: 'Esa cuenta no es de prueba.' }

  let destino: '/equipo' | '/hoy' = '/equipo'

  try {
    await signIn('prueba', { email, redirect: false })

    const [usuario] = await db
      .select({ rol: users.role })
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1)

    destino = rutaInicial(usuario?.rol)
  } catch (err) {
    if (err instanceof AuthError) return { error: 'No se pudo entrar con esa cuenta de prueba.' }
    console.error('Error al entrar en modo prueba:', err)
    return { error: 'No pude conectar con la base.' }
  }

  redirect(destino)
}

/* ── Cambio de contraseña ─────────────────────────────────────────────── */

export type EstadoClave = { ok: boolean; error: string | null }

const claveSchema = (largoMinimo: number) =>
  z
    .object({
      actual: z.string().min(1, 'Escribí tu contraseña actual.'),
      nueva: z
        .string()
        .min(largoMinimo, `La contraseña nueva necesita al menos ${largoMinimo} caracteres.`),
      repetir: z.string(),
    })
    .refine((v) => v.nueva === v.repetir, {
      message: 'Las dos contraseñas nuevas no coinciden.',
      path: ['repetir'],
    })
    .refine((v) => v.nueva !== v.actual, {
      message: 'La contraseña nueva tiene que ser distinta de la temporal.',
      path: ['nueva'],
    })

/**
 * El setter entra con la temporal y elige la suya antes de poder trabajar.
 * También es la pantalla para cambiarla después, cuando quiera.
 */
export async function cambiarPassword(
  _prev: EstadoClave,
  formData: FormData,
): Promise<EstadoClave> {
  const cfg = SETTERS_CONFIG_DEFAULT

  let sesion
  try {
    sesion = await exigirSesion()
  } catch {
    return { ok: false, error: 'Tu sesión ya no vale. Volvé a entrar.' }
  }

  const parsed = claveSchema(cfg.largoMinimoPassword).safeParse({
    actual: formData.get('actual'),
    nueva: formData.get('nueva'),
    repetir: formData.get('repetir'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  }

  const [usuario] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, sesion.userId))
    .limit(1)

  if (!usuario) return { ok: false, error: 'Tu cuenta ya no existe.' }

  let coincide = false
  try {
    coincide = await verify(usuario.passwordHash, parsed.data.actual)
  } catch {
    coincide = false
  }
  if (!coincide) return { ok: false, error: 'La contraseña actual no es correcta.' }

  const nuevoHash = await hash(parsed.data.nueva, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: nuevoHash, mustChangePassword: false })
      .where(eq(users.id, sesion.userId))
    await tx.insert(events).values({ type: 'password_cambiada', actorUserId: sesion.userId })
  })

  redirect(rutaInicial(sesion.rol))
}
