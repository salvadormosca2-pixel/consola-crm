import './load-env'

import { createInterface } from 'node:readline/promises'

import { hash } from '@node-rs/argon2'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { z } from 'zod'

import { users } from '../src/db/schema'

/**
 * Alta de usuarios. No hay registro público: la app es para 1–3 personas y
 * las cuentas se crean desde acá.
 *
 *   npm run user:create                       (pregunta los datos)
 *   npx tsx scripts/create-user.ts --email juan@ejemplo.com --name Juan --password "..."
 *
 * Los flags van con `npx tsx` y no con `npm run --`, porque npm se come los
 * argumentos que empiezan con `--`. Si el email ya existe, actualiza la
 * contraseña en lugar de fallar.
 */

const argSchema = z.object({
  email: z.string().email('El email no es válido.'),
  name: z.string().min(1, 'El nombre no puede estar vacío.'),
  password: z.string().min(6, 'La contraseña necesita al menos 6 caracteres.'),
})

function readFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg?.startsWith('--')) {
      const value = argv[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        out[arg.slice(2)] = value
        i++
      }
    }
  }
  return out
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL. Copiá .env.example a .env.local.')

  const flags = readFlags(process.argv.slice(2))
  let input = flags

  if (!flags.email || !flags.name || !flags.password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      input = {
        email: flags.email ?? (await rl.question('Email: ')).trim(),
        name: flags.name ?? (await rl.question('Nombre: ')).trim(),
        password: flags.password ?? (await rl.question('Contraseña (mínimo 6): ')).trim(),
      }
    } finally {
      rl.close()
    }
  }

  const parsed = argSchema.safeParse(input)
  if (!parsed.success) {
    console.error('\nNo pude crear el usuario:')
    for (const issue of parsed.error.issues) console.error(`  · ${issue.message}`)
    process.exit(1)
  }

  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  })
  const db = drizzle(pool, { casing: 'snake_case' })

  try {
    const email = parsed.data.email.toLowerCase()
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)

    const passwordHash = await hash(parsed.data.password, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    })

    if (existing.length > 0) {
      await db
        .update(users)
        .set({ passwordHash, name: parsed.data.name, mustChangePassword: false })
        .where(sql`lower(${users.email}) = ${email}`)
      console.log(`Contraseña actualizada para ${email}.`)
    } else {
      /*
       * El primero que se crea es la cuenta madre: la que ve todo, la única que
       * crea y borra cuentas, y la que la base protege de ser borrada o
       * degradada. Los siguientes son admins comunes. Los setters NO se crean
       * desde acá: se dan de alta desde el panel, que además genera su tarjeta
       * de acceso.
       */
      const [conteo] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(sql`role = 'admin_madre'`)

      const role = (conteo?.n ?? 0) === 0 ? 'admin_madre' : 'admin'
      await db.insert(users).values({ email, name: parsed.data.name, passwordHash, role })
      console.log(
        `Usuario creado: ${email} (${role === 'admin_madre' ? 'cuenta principal' : 'admin'}).` +
          ' Ya podés entrar en /ingresar.',
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error('\nFalló el alta de usuario:\n', err instanceof Error ? err.message : err)
  process.exit(1)
})
