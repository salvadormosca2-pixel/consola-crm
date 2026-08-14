/**
 * Reemplazo de `server-only` para los tests.
 *
 * El paquete real solo resuelve dentro del build de Next, y explota al
 * importarlo desde Vitest. Su función es impedir que un módulo de servidor se
 * cuele en el bundle del navegador; en los tests eso no aplica, así que alcanza
 * con un módulo vacío. El alias está en vitest.config.ts.
 */
export {}
