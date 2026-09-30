// drizzle-kit: `pnpm --filter @gf/db generate` пишет SQL-миграцию из схемы. Базы не нужно.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
