import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '@/lib/env'

import * as schema from './schema'

/**
 * Un solo pool por proceso. En desarrollo Next recarga los módulos en cada
 * cambio, así que lo guardamos en globalThis para no dejar conexiones colgadas.
 */
const globalForDb = globalThis as unknown as { __crmPool?: Pool }

/**
 * Cuántas conexiones abre **cada instancia**.
 *
 * En un servidor propio hay un proceso y diez conexiones alcanzan de sobra.
 * En Vercel no: cada instancia sin uso se apaga y se levantan otras según la
 * demanda, así que el número se multiplica por cuántas haya vivas en ese
 * momento. Con diez cada una, media docena de instancias agotan el límite de
 * un Postgres chico y la aplicación empieza a fallar con "too many clients"
 * justo cuando más se usa.
 *
 * Tres por instancia es suficiente: cada pedido usa una conexión por unos
 * milisegundos.
 */
const MAXIMO = process.env.VERCEL ? 3 : 10

function createPool(): Pool {
  const { DATABASE_URL, DATABASE_SSL } = env()
  return new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
    max: MAXIMO,
    // Sin uso, la conexión se suelta rápido: una instancia dormida no tiene por
    // qué seguir ocupando un lugar en la base.
    idleTimeoutMillis: process.env.VERCEL ? 10_000 : 30_000,
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
