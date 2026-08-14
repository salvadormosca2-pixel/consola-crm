import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import dotenv from 'dotenv'

/**
 * Carga el entorno antes de cualquier test.
 *
 * Varios módulos del servidor validan el entorno al importarse (la conexión a
 * la base, la clave de cifrado), así que sin esto un test que solo quiere
 * probar un esquema de Zod falla al resolver los imports.
 */
for (const archivo of ['.env.local', '.env']) {
  const ruta = resolve(process.cwd(), archivo)
  if (existsSync(ruta)) dotenv.config({ path: ruta, override: false })
}
