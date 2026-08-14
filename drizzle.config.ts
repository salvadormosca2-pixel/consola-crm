import './scripts/load-env'

import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL
if (!url) throw new Error('Falta DATABASE_URL. Copiá .env.example a .env.local.')

export default defineConfig({
  schema: ['./src/db/enums.ts', './src/db/schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  verbose: true,
  strict: true,
})
