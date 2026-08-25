import './load-env'

import { migrar } from './migrar.mjs'

/**
 * Migrar desde la línea de comandos, en desarrollo.
 *
 *   npm run db:migrate
 *
 * La lógica vive en `migrar.mjs`, en JavaScript pelado, porque el contenedor
 * de producción la corre antes de arrancar el servidor y esa imagen no tiene
 * `tsx`. Acá solo se le agrega la carga de `.env.local`, que en el servidor no
 * hace falta: las variables llegan del entorno.
 */
migrar().catch((err: unknown) => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
