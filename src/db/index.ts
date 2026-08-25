import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '@/lib/env'

import * as schema from './schema'

/**
 * Un solo pool por proceso. En desarrollo Next recarga los módulos en cada
 * cambio, así que lo guardamos en globalThis para no dejar conexiones colgadas.
 */
const globalForDb = globalThis as unknown as { __crmPool?: Pool }

function createPool(): Pool {
  const { DATABASE_URL, DATABASE_SSL } = env()
  return new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
}

export const pool: Pool = globalForDb.__crmPool ?? createPool()
if (process.env.NODE_ENV !== 'production') globalForDb.__crmPool = pool

export const db = drizzle(pool, { schema, casing: 'snake_case' })

export type Db = typeof db

/**
 * Lo mínimo que necesita una función para hablar con la base.
 *
 * Sirve tanto para el pool como para una transacción. Una transacción de
 * Drizzle no es un `Db` completo —le falta el cliente de abajo—, así que sin
 * este tipo ninguna función podría correr adentro y afuera de una transacción,
 * que es justo lo que hace falta para repartir leads sin condiciones de carrera.
 */
export type Ejecutor = Pick<Db, 'execute'>

export { schema }
