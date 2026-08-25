import { migrar } from './migrar.mjs'

/**
 * Lo que corre el contenedor: migrar y recién ahí levantar el servidor.
 *
 * Va en este orden a propósito. Desplegar código nuevo contra una base sin
 * migrar es la forma más fácil de tumbar el sistema entero: la app arranca
 * bien, pasa el chequeo de salud si el chequeo no mira nada, y falla en cada
 * pantalla que toque una tabla que todavía no existe.
 *
 * Con esto no hay forma de que pase: **o la base queda al día, o el proceso no
 * arranca**. Si la migración falla, el contenedor muere, Coolify no lo pone en
 * servicio y sigue andando la versión anterior. Un despliegue que no sale es
 * mucho mejor que uno que sale roto.
 *
 * Migrar dos veces no hace nada: cada archivo se aplica una sola vez y queda
 * anotado en `_migrations`, así que reiniciar el contenedor es gratis.
 */
try {
  console.log('Migrando la base antes de arrancar…')
  await migrar()
} catch (err) {
  console.error('\nNo se pudo migrar. El servidor NO arranca.')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

console.log('Base al día. Levantando el servidor.\n')
await import('../server.js')
