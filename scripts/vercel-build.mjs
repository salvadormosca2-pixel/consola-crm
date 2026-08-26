import { spawnSync } from 'node:child_process'

/**
 * El build de Vercel: migrar y después compilar.
 *
 * En un servidor propio las migraciones las corre el contenedor antes de
 * levantar el servidor. En Vercel no hay contenedor —cada pedido entra a una
 * función que ya está compilada— así que el único momento seguro para migrar
 * es el build.
 *
 * Va **antes** de compilar a propósito. Si la migración falla, el build falla,
 * Vercel descarta el despliegue y sigue sirviendo la versión anterior. Un
 * despliegue que no sale es mucho mejor que uno que sale contra una base a la
 * que le faltan tablas.
 *
 * **Solo migra en producción.** Una vista previa de una rama compila contra la
 * misma base, y si migrara, cualquier rama a medio hacer podría cambiarle el
 * esquema a la aplicación que está en uso.
 */

const enProduccion = process.env.VERCEL_ENV === 'production'
const hayBase = Boolean(process.env.DATABASE_URL)

if (enProduccion && hayBase) {
  console.log('\n── Migrando la base antes de compilar ──\n')
  const { migrar } = await import('./migrar.mjs')
  try {
    await migrar()
  } catch (err) {
    console.error('\nLa migración falló. El despliegue NO sale.')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  console.log('')
} else if (!enProduccion) {
  console.log('Vista previa: no se migra la base de producción.')
} else {
  console.log('Sin DATABASE_URL: no hay nada que migrar.')
}

// Por `npx` y no `next` a secas: al lanzarlo desde un script, el binario local
// de node_modules no siempre está en el PATH y falla con "no se reconoce el
// comando", que no dice nada sobre la causa real.
const build = spawnSync('npx', ['--no-install', 'next', 'build'], {
  stdio: 'inherit',
  shell: true,
})
process.exit(build.status ?? 1)
