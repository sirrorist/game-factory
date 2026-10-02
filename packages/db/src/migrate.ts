// Миграции - отдельным одноразовым запуском до старта хаба, как публикация игр (`games`):
// хаб их при старте не накатывает, чтобы упавшая миграция не оставила полуживой хаб.
//
//   GF_DATABASE_URL=postgres://… node packages/db/src/migrate.ts

import { readFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, databaseUrl } from './index.ts';
import { MIGRATIONS_DIR } from './migrations.ts';
import { ensureHubRole, HUB_ROLE } from './roles.ts';

const url = databaseUrl();
if (!url) {
  console.error('база не настроена: нужен GF_DATABASE_URL или GF_DB_HOST + GF_DB_PASSWORD_FILE');
  process.exit(1);
}
const { db, close } = createDb(url);
try {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log('миграции применены');
  // Роль хаба - после миграций: права выдаются и на таблицы, которые миграция только что завела.
  const hubFile = process.env.GF_DB_HUB_PASSWORD_FILE;
  if (hubFile) {
    await ensureHubRole(db, readFileSync(hubFile, 'utf8').trim());
    console.log(`роль ${HUB_ROLE} готова`);
  } else console.warn(`GF_DB_HUB_PASSWORD_FILE не задан: роль ${HUB_ROLE} не обновлена`);
} finally {
  await close();
}
