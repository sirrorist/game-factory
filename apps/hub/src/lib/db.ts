// База хаба - один пул на процесс, создаётся при первом обращении: сборка (`next build`)
// и страницы, которым база не нужна, работают и без неё.

import { createDb, databaseUrl, type Db } from '@gf/db';

let cached: { db: Db } | null | undefined;

/** База хаба или null, если она не настроена (нет GF_DATABASE_URL / GF_DB_HOST). */
export function hubDb(): Db | null {
  if (cached === undefined) {
    const url = databaseUrl();
    cached = url ? createDb(url) : null;
  }
  return cached?.db ?? null;
}
