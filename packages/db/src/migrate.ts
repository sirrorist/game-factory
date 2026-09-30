// Миграции - отдельным одноразовым запуском до старта хаба, как публикация игр (`games`):
// хаб их при старте не накатывает, чтобы упавшая миграция не оставила полуживой хаб.
//
//   GF_DATABASE_URL=postgres://… node packages/db/src/migrate.ts

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, databaseUrl } from './index.ts';
import { MIGRATIONS_DIR } from './migrations.ts';

const url = databaseUrl();
if (!url) {
  console.error('база не настроена: нужен GF_DATABASE_URL или GF_DB_HOST + GF_DB_PASSWORD_FILE');
  process.exit(1);
}
const { db, close } = createDb(url);
try {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log('миграции применены');
} finally {
  await close();
}
