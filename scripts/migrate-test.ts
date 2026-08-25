import './load-env'

import { spawnSync } from 'node:child_process'

/**
 * Aplica las migraciones a la base de tests.
 *
 *   npm run db:migrate:test
 *
 * Los tests de integración corren contra `<base>_test` para no tocar los datos
 * de desarrollo, así que después de cada migración nueva hay que correr esto o
 * fallan todos con "no existe la tabla".
 */
const base = process.env.DATABASE_URL
if (!base) throw new Error('Falta DATABASE_URL. Copiá .env.example a .env.local.')

const destino = process.env.TEST_DATABASE_URL ?? base.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2')

console.log(`Migrando la base de tests: ${destino.replace(/:[^:@]+@/, ':***@')}`)

const r = spawnSync('tsx', ['scripts/migrate.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: destino },
})

process.exit(r.status ?? 1)
