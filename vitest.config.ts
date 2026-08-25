import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // `server-only` solo resuelve dentro del build de Next.
      'server-only': resolve(__dirname, './src/test/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    /*
     * Los tests de integración corren contra una única base de Postgres y cada
     * uno la vacía antes de empezar. En paralelo se truncan la base entre
     * ellos y fallan por turnos, sin que haya nada roto en el código.
     */
    fileParallelism: false,
  },
})
