/**
 * Tipos de `migrar.mjs`.
 *
 * El migrador está en JavaScript pelado porque lo corre el contenedor de
 * producción, que no tiene `tsx`. Esto es lo único que hace falta para que
 * `db:migrate` lo pueda importar desde TypeScript sin perder el chequeo.
 */
export declare function migrar(): Promise<void>
