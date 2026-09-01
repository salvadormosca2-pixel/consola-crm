import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import dotenv from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from '@/db/schema'

/**
 * Base de datos para los tests de integración.
 *
 * Corren contra Postgres de verdad, no contra mocks: lo que se prueba es el
 * comportamiento de los locks, del índice único parcial y de las transacciones,
 * y nada de eso lo reproduce un mock.
 *
 * Usa una base aparte (`<base>_test`) para no tocar los datos de desarrollo.
 * Después de cada migración hay que correr `npm run db:migrate:test`.
 */

for (const f of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), f)
  if (existsSync(p)) dotenv.config({ path: p, override: false })
}

export function urlDeTest(): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('Falta DATABASE_URL para los tests.')
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  return base.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2')
}

export function crearPool(): Pool {
  return new Pool({
    connectionString: urlDeTest(),
    // Los tests de concurrencia abren muchas transacciones a la vez: si el pool
    // es más chico que la concurrencia, se serializan solas y el test no prueba
    // lo que dice probar.
    max: 40,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  })
}

export function crearDb(pool: Pool) {
  return drizzle(pool, { schema, casing: 'snake_case' })
}

/**
 * Deja la base vacía entre tests, sin recrear el esquema.
 *
 * `users` entra en la lista porque los tests dan de alta personas. `truncate`
 * no dispara los triggers por fila, así que la protección de la cuenta madre no
 * lo frena — y en la base de test es justo lo que se quiere.
 */
export async function limpiar(pool: Pool): Promise<void> {
  await pool.query(`
    truncate events, messages, import_batch_items, meetings,
             setter_sends, lead_assignments, setter_accounts,
             mensajes_destinatarios, mensajes_equipo, recordatorios, notificaciones,
             push_subscriptions, setters, users,
             contacts, import_batches, templates
    restart identity cascade
  `)
}

let contador = 0

export interface SetterDeTest {
  nombre?: string
  tanda?: number
  /** Una entrada por cuenta de Instagram: su cupo diario. */
  cupos?: number[]
  /**
   * Recién dado de alta: nunca entró y todavía tiene la contraseña temporal.
   *
   * Por defecto el setter de test ya estrenó su acceso, porque es lo que es un
   * setter en casi todos los tests: alguien que trabaja. El reparto saltea a
   * los que no entraron, así que sin esto la mitad de los tests probaría el
   * caso equivocado sin decirlo.
   */
  nuncaEntro?: boolean
}

export interface SetterCreado {
  setterId: string
  userId: string
  cuentas: string[]
}

export async function crearSetter(pool: Pool, opts: SetterDeTest = {}): Promise<SetterCreado> {
  contador++
  const nombre = opts.nombre ?? `Setter ${contador}`

  const u = await pool.query<{ id: string }>(
    `insert into users (email, name, password_hash, role, status,
                        must_change_password, last_login_at)
     values ($1, $2, 'x', 'setter', 'activo', $3, $4) returning id`,
    [
      `setter${contador}@test.local`,
      nombre,
      opts.nuncaEntro ?? false,
      opts.nuncaEntro ? null : new Date(),
    ],
  )
  const userId = u.rows[0]!.id

  const s = await pool.query<{ id: string }>(
    `insert into setters (user_id, tanda_diaria) values ($1, $2) returning id`,
    [userId, opts.tanda ?? 60],
  )
  const setterId = s.rows[0]!.id

  const cuentas: string[] = []
  for (const [i, cupo] of (opts.cupos ?? [30]).entries()) {
    contador++
    const c = await pool.query<{ id: string }>(
      `insert into setter_accounts (setter_id, ig_username, cupo_diario, orden)
       values ($1, $2, $3, $4) returning id`,
      [setterId, `cuenta_test_${contador}`, cupo, i + 1],
    )
    cuentas.push(c.rows[0]!.id)
  }

  return { setterId, userId, cuentas }
}

/** Un lead frío del pozo: con Instagram, sin dueño. */
export async function crearLeadScrapeado(pool: Pool, i = 0): Promise<string> {
  contador++
  const usuario = `negocio_ig_${contador}`
  const r = await pool.query<{ id: string }>(
    `insert into contacts (business_name, ig_username, has_instagram, origen, dedupe_key)
     values ($1, $2, true, 'scrapeado', $2) returning id`,
    [`Negocio scrapeado ${i}`, usuario],
  )
  return r.rows[0]!.id
}

/** Asigna un lead puntual a un setter, para armar el estado de un test. */
export async function asignar(
  pool: Pool,
  contactId: string,
  setterId: string,
  venceEnHoras = 48,
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into lead_assignments (contact_id, setter_id, vence_at)
     values ($1, $2, now() + ($3 || ' hours')::interval) returning id`,
    [contactId, setterId, String(venceEnHoras)],
  )
  return r.rows[0]!.id
}

/** Cuántos mensajes mandó esa cuenta de Instagram, según la autoridad. */
export async function contarCupoDeSetter(pool: Pool, cuentaId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `select count(*) as n from setter_sends
      where setter_account_id = $1 and undone_at is null`,
    [cuentaId],
  )
  return Number(r.rows[0]?.n ?? 0)
}
