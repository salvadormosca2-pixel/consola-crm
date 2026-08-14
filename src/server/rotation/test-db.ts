import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import dotenv from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from '@/db/schema'

/**
 * Base de datos para los tests de integración y concurrencia.
 *
 * Corren contra Postgres de verdad, no contra mocks: lo que se está probando es
 * exactamente el comportamiento de los locks y de las transacciones, que un
 * mock no puede reproducir.
 *
 * Usa una base aparte (`<base>_test`) para no tocar los datos de desarrollo.
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

/** Deja la base vacía entre tests, sin recrear el esquema. */
export async function limpiar(pool: Pool): Promise<void> {
  await pool.query(`
    truncate events, messages, import_batch_items, meetings, pilots,
             ig_dispatch_state, contacts, import_batches, messaging_accounts, templates
    restart identity cascade
  `)
}

export interface CuentaDeTest {
  code?: string
  status?: 'activa' | 'calentando' | 'pausada' | 'bloqueada' | 'esperando_preparacion'
  dailyCap?: number
  minGapSeconds?: number
  warmupDay?: number | null
  channel?: 'whatsapp' | 'instagram'
  windowStart?: string
  windowEnd?: string
}

let contador = 0

export async function crearCuenta(pool: Pool, opts: CuentaDeTest = {}): Promise<string> {
  contador++
  const code = opts.code ?? `WA-${String(contador).padStart(2, '0')}`
  const channel = opts.channel ?? 'whatsapp'
  const r = await pool.query<{ id: string }>(
    `insert into messaging_accounts
       (code, label, channel, phone_e164, ig_username, status, daily_cap,
        min_gap_seconds, warmup_day, window_start, window_end)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      code,
      `${code} test`,
      channel,
      channel === 'whatsapp' ? `54938300000${String(contador).padStart(2, '0')}` : null,
      channel === 'instagram' ? `cuenta${contador}` : null,
      opts.status ?? 'activa',
      opts.dailyCap ?? 30,
      // Por defecto sin espera: los tests de cupo prueban el cupo, no la espera.
      opts.minGapSeconds ?? 0,
      opts.warmupDay ?? null,
      opts.windowStart ?? '00:00',
      opts.windowEnd ?? '23:59',
    ],
  )
  return r.rows[0]!.id
}

export async function crearContacto(pool: Pool, i = 0): Promise<string> {
  contador++
  const r = await pool.query<{ id: string }>(
    `insert into contacts (business_name, phone_e164, has_whatsapp, dedupe_key)
     values ($1, $2, true, $2) returning id`,
    [`Negocio ${i}`, `549383${String(1000000 + contador).slice(-7)}`],
  )
  return r.rows[0]!.id
}

/** Cuántos mensajes de esa cuenta consumen cupo hoy, según la fuente de verdad. */
export async function contarCupo(pool: Pool, accountId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `select count(*) as n from messages
      where account_id = $1
        and status in ('enviado','entregado','leido','respondido')
        and undone_at is null`,
    [accountId],
  )
  return Number(r.rows[0]?.n ?? 0)
}
