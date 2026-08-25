import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Pool } from 'pg'

/**
 * Migrador propio, en JavaScript pelado.
 *
 * Es JavaScript y no TypeScript por un motivo concreto: **lo corre el
 * contenedor de producción antes de arrancar el servidor**, y esa imagen no
 * tiene `tsx` ni las dependencias de desarrollo. Con esto, desplegar código
 * nuevo contra una base vieja es imposible: o la base está al día, o el
 * servidor no levanta.
 *
 * El migrador de Drizzle envuelve TODAS las migraciones pendientes en una sola
 * transacción, y eso hace imposible algo que necesitamos: `ALTER TYPE ... ADD
 * VALUE` no permite usar el valor nuevo hasta que la transacción que lo creó
 * haya confirmado. Con un solo BEGIN para todo, una migración que agrega un
 * valor de enum y otra que lo usa nunca pueden convivir, por más que estén en
 * archivos separados.
 *
 * Este aplica cada archivo en su propia transacción y confirma entre uno y
 * otro. Los archivos y el journal los sigue generando `drizzle-kit`.
 */

const CARPETA = './drizzle'

export async function migrar() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL.')

  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  })

  try {
    // Las extensiones van primero: el esquema depende de ellas.
    //   pgcrypto → gen_random_uuid()   ·   pg_trgm → búsqueda de contactos
    await pool.query('create extension if not exists pgcrypto')
    await pool.query('create extension if not exists pg_trgm')
    console.log('Extensiones listas: pgcrypto, pg_trgm')

    await pool.query(`
      create table if not exists _migrations (
        tag         text primary key,
        hash        text not null,
        applied_at  timestamptz not null default now()
      )
    `)

    await adoptarRegistroDeDrizzle(pool)

    const entradas = await leerJournal()

    const yaAplicadas = new Map()
    const previas = await pool.query('select tag, hash from _migrations')
    for (const r of previas.rows) yaAplicadas.set(r.tag, r.hash)

    let aplicadas = 0
    for (const entrada of entradas) {
      const contenido = await readFile(resolve(CARPETA, `${entrada.tag}.sql`), 'utf8')
      const hash = createHash('sha256').update(contenido).digest('hex')

      const previo = yaAplicadas.get(entrada.tag)
      if (previo) {
        if (previo !== hash) {
          throw new Error(
            `La migración ${entrada.tag} ya se aplicó pero el archivo cambió.\n` +
              'Nunca edites una migración aplicada: creá una nueva.',
          )
        }
        continue
      }

      const sentencias = contenido
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')
        for (const sentencia of sentencias) await cliente.query(sentencia)
        await cliente.query('insert into _migrations (tag, hash) values ($1, $2)', [
          entrada.tag,
          hash,
        ])
        await cliente.query('commit')
        console.log(`  aplicada  ${entrada.tag}  (${sentencias.length} sentencias)`)
        aplicadas++
      } catch (err) {
        await cliente.query('rollback').catch(() => {})
        throw new ErrorDeMigracion(entrada.tag, err)
      } finally {
        cliente.release()
      }
    }

    console.log(
      aplicadas === 0
        ? 'No había migraciones pendientes.'
        : aplicadas === 1
          ? '1 migración aplicada.'
          : `${aplicadas} migraciones aplicadas.`,
    )
  } finally {
    await pool.end()
  }
}

async function leerJournal() {
  const crudo = await readFile(resolve(CARPETA, 'meta/_journal.json'), 'utf8')
  const journal = JSON.parse(crudo)
  return [...journal.entries].sort((a, b) => a.idx - b.idx)
}

/**
 * Si la base ya tenía migraciones aplicadas con el migrador de Drizzle, se
 * adoptan en el registro propio para no volver a correrlas.
 */
async function adoptarRegistroDeDrizzle(pool) {
  const existe = await pool.query(`
    select count(*)::int as n from information_schema.tables
     where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
  `)
  if ((existe.rows[0]?.n ?? 0) === 0) return

  const vacio = await pool.query('select count(*)::int as n from _migrations')
  if ((vacio.rows[0]?.n ?? 0) > 0) return

  const previas = await pool.query(
    'select created_at from drizzle.__drizzle_migrations order by created_at asc',
  )
  const entradas = (await leerJournal()).slice(0, previas.rows.length)

  for (const entrada of entradas) {
    const contenido = await readFile(resolve(CARPETA, `${entrada.tag}.sql`), 'utf8')
    const hash = createHash('sha256').update(contenido).digest('hex')
    await pool.query('insert into _migrations (tag, hash) values ($1, $2) on conflict do nothing', [
      entrada.tag,
      hash,
    ])
  }
  if (entradas.length > 0) {
    console.log(`Adoptadas ${entradas.length} migraciones del registro anterior de Drizzle.`)
  }
}

class ErrorDeMigracion extends Error {
  constructor(tag, causa) {
    const pg = desenvolver(causa)
    super(
      `La migración ${tag} falló: ${pg.message ?? String(causa)}` +
        (pg.detail ? `\n  detalle: ${pg.detail}` : '') +
        (pg.hint ? `\n  sugerencia: ${pg.hint}` : ''),
    )
    this.name = 'ErrorDeMigracion'
    this.causa = causa
  }
}

function desenvolver(err) {
  let actual = err
  for (let i = 0; i < 5 && actual; i++) {
    if (actual.detail || actual.hint) return actual
    if (!actual.cause) return actual
    actual = actual.cause
  }
  return err ?? {}
}

// Corrido directo (`node scripts/migrar.mjs`), como hace el contenedor.
if (process.argv[1] && process.argv[1].endsWith('migrar.mjs')) {
  migrar().catch((err) => {
    console.error('\n' + (err instanceof Error ? err.message : String(err)))
    process.exit(1)
  })
}
