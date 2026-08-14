import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import dotenv from 'dotenv'

/**
 * Next carga .env.local solo; los scripts de CLI (drizzle-kit, migrate,
 * user:create) corren fuera de Next y necesitan cargarlo a mano.
 * Mismo orden de precedencia que usa Next: .env.local pisa a .env.
 */
for (const file of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), file)
  if (existsSync(path)) dotenv.config({ path, override: false })
}
