import { verify } from '@node-rs/argon2'
import { sql } from 'drizzle-orm'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'

import { authConfig } from '@/auth.config'
import { db } from '@/db'
import { users } from '@/db/schema'

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credencialesSchema.safeParse(raw)
        if (!parsed.success) return null

        const email = parsed.data.email.toLowerCase()
        const [usuario] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            passwordHash: users.passwordHash,
          })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1)

        const hash = usuario?.passwordHash ?? HASH_SEÑUELO
        let coincide = false
        try {
          coincide = await verify(hash, parsed.data.password)
        } catch {
          coincide = false
        }

        if (!usuario || !coincide) return null
        return { id: usuario.id, email: usuario.email, name: usuario.name }
      },
    }),
  ],
})
