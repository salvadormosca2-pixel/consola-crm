import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // next-env.d.ts lo genera Next en cada build y usa triple-slash a propósito.
  {
    ignores: [
      '.next/**',
      '.next-verify/**', // salida de `npm run build:check`
      'node_modules/**',
      'drizzle/**',
      '.pgdev/**',
      'next-env.d.ts',
    ],
  },
]

export default config
