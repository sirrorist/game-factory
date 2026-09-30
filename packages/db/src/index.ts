// База хаба: подключение из окружения, миграции, проверка связи. Не ядро (CLAUDE.md, "Язык
// и код"): зависимости - drizzle-orm и postgres (D-051). Сервер игр и `gf` сюда не ходят.

import { readFileSync } from 'node:fs';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export * from './schema.ts';
export { schema };

/** Каталог SQL-миграций - общий для прода (postgres) и тестов (PGlite). */
export const MIGRATIONS_DIR = new URL('../migrations', import.meta.url).pathname;

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Адрес базы из окружения или null, если база не настроена.
 *
 * Пароль - только файлом (`GF_DB_PASSWORD_FILE`, секрет compose), не переменной: переменные
 * окружения видны в `docker inspect` и в /proc. `GF_DATABASE_URL` - для локальной работы.
 */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.GF_DATABASE_URL) return env.GF_DATABASE_URL;
  if (!env.GF_DB_HOST) return null;
  const file = env.GF_DB_PASSWORD_FILE;
  if (!file) throw new Error('GF_DB_HOST задан, а GF_DB_PASSWORD_FILE - нет: пароль базы берётся только из файла');
  const password = readFileSync(file, 'utf8').trim();
  if (!password) throw new Error(`GF_DB_PASSWORD_FILE: файл ${file} пуст`);
  const url = new URL('postgres://');
  url.hostname = env.GF_DB_HOST;
  url.port = env.GF_DB_PORT || '5432';
  url.username = env.GF_DB_USER || 'gf';
  url.password = password; // URL сам кодирует спецсимволы
  url.pathname = `/${env.GF_DB_NAME || 'gf'}`;
  return url.toString();
}

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  // Хаб - один процесс на маленьком сервере: соединений немного, простаивающие закрываются.
  const client = postgres(url, { max: 5, idle_timeout: 30, connect_timeout: 5 });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

/** Живая ли база: для `/healthz` хаба. Принимает и postgres-js, и PGlite (тесты). */
export async function ping(db: { execute(query: SQL): PromiseLike<unknown> }): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
