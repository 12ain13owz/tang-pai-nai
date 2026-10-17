import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs outside the app, so it reads process.env itself. The npm scripts load .env.dev
// first (see package.json `db:*`).
export default defineConfig({
  dialect: 'turso',
  schema: './src/core/database/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./data/local.db',
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
})
