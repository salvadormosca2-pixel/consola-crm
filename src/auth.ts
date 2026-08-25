import { verify } from '@node-rs/argon2'
import { eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'

import { authConfig } from '@/auth.config'
import { db } from '@/db'
import type { UserRole, UserStatus } from '@/db/enums'
import { events, users } from '@/db/schema'
import { esCuentaDePrueba, modoPrueba } from '@/lib/modo-prueba'
import { SETTERS_CONFIG_DEFAULT } from '@/lib/setters-config'

const credencialesSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

/**
 * Hash descartable de una contraseña cualquiera. Se verifica contra él cuando
 * el email no existe, para que el tiempo de respuesta no revele si la cuenta
 * está dada de alta o no.
 */
const HASH_SEÑUELO =
  '$argon2id$v=19$m=19456,t=2,p=1$c2VudGluZWxhc2FsdA$8Y3Wm3P1qkTz5Q2hK6nVvJcXbF7dR0aLmNuOpIyEwSg'

/**
 * Error con motivo propio. NextAuth solo deja pasar el `code`, así que el
 * formulario lo traduce a un texto: "bloqueada" y "contraseña incorrecta" son
 * cosas distintas y el que entra tiene que poder distinguirlas.
 */
export class ErrorDeIngreso extends CredentialsSignin {
  constructor(code: 'credenciales' | 'bloqueada' | 'pausada' | 'baja') {
    super()
    this.code = code
  }
}

/** De dónde entró. Sirve para saber si alguien directamente no está entrando. */
async function origenDeLaPeticion(): Promise<{ ip: string | null; agente: string | null }> {
  try {
    const h = await headers()
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip')?.trim() ?? null
    return { ip, agente: h.get('user-agent')?.slice(0, 300) ?? null }
  } catch {
    return { ip: null, agente: null }
  }
}

/**
 * Pasarela de prueba: entra sin contraseña.
 *
 * Solo se agrega a la lista de proveedores si `modoPrueba()` da true, y esa
 * función ya exige que no sea un build de producción. En producción este
 * proveedor no existe, así que no hay nada que atacar.
 */
const proveedorDePrueba = Credentials({
  id: 'prueba',
  name: 'Modo prueba',
  credentials: { email: { label: 'Email', type: 'email' } },
  async authorize(raw) {
    if (!modoPrueba()) return null

    const email = String((raw as { email?: unknown }).email ?? '').toLowerCase()
    // Aunque alguien encienda el modo en un servidor, solo puede entrar como
    // los muñecos de la demostración. Nunca como una persona real.
    if (!esCuentaDePrueba(email)) return null

    const [usuario] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)

    if (!usuario || usuario.status !== 'activo' || usuario.role === 'admin_madre') return null

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, usuario.id))
    await db.insert(events).values({
      type: 'ingreso',
      actorUserId: usuario.id,
      payload: { modoPrueba: true },
    })

    return {
      id: usuario.id,
      email: usuario.email,
      name: usuario.name,
      rol: usuario.role as UserRole,
    }
  },
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...(modoPrueba() ? [proveedorDePrueba] : []),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credencialesSchema.safeParse(raw)
        if (!parsed.success) throw new ErrorDeIngreso('credenciales')

        const cfg = SETTERS_CONFIG_DEFAULT
        const email = parsed.data.email.toLowerCase()

        const [usuario] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            passwordHash: users.passwordHash,
            role: users.role,
            status: users.status,
            failedAttempts: users.failedAttempts,
            lockedUntil: users.lockedUntil,
          })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1)

        // Se verifica siempre, exista o no, para no filtrar qué emails existen.
        const hash = usuario?.passwordHash ?? HASH_SEÑUELO
        let coincide = false
        try {
          coincide = await verify(hash, parsed.data.password)
        } catch {
          coincide = false
        }

        if (!usuario) throw new ErrorDeIngreso('credenciales')

        // Bloqueo temporal: frena el intento por fuerza bruta sin dejar la
        // cuenta inutilizable, que sería peor que el problema.
        if (usuario.lockedUntil && usuario.lockedUntil > new Date()) {
          throw new ErrorDeIngreso('bloqueada')
        }

        if (!coincide) {
          const intentos = usuario.failedAttempts + 1
          const bloquear = intentos >= cfg.intentosParaBloquear
          await db
            .update(users)
            .set({
              failedAttempts: bloquear ? 0 : intentos,
              lockedUntil: bloquear
                ? new Date(Date.now() + cfg.minutosDeBloqueo * 60_000)
                : usuario.lockedUntil,
            })
            .where(eq(users.id, usuario.id))

          await db.insert(events).values({
            type: 'ingreso_fallido',
            actorUserId: usuario.id,
            payload: { intentos, bloqueada: bloquear },
          })

          throw new ErrorDeIngreso(bloquear ? 'bloqueada' : 'credenciales')
        }

        const estado = usuario.status as UserStatus
        if (estado === 'pausado') throw new ErrorDeIngreso('pausada')
        if (estado === 'baja') throw new ErrorDeIngreso('baja')

        const { ip, agente } = await origenDeLaPeticion()
        await db
          .update(users)
          .set({
            failedAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            lastLoginIp: ip,
            lastLoginAgent: agente,
          })
          .where(eq(users.id, usuario.id))

        await db.insert(events).values({
          type: 'ingreso',
          actorUserId: usuario.id,
          payload: { ip, agente },
        })

        return {
          id: usuario.id,
          email: usuario.email,
          name: usuario.name,
          rol: usuario.role as UserRole,
        }
      },
    }),
  ],
})
