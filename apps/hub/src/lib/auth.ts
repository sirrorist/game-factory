// Вход в хаб - Better Auth (D-047 Р4, D-058, D-062): пароль + passkey, регистрация закрыта.
// Права и блокировка проверяются сервером; owner назначается явно оператором (admin.ts).
//
// Куки - только `__Host-` (П-006): Secure, Path=/, без Domain - поддомен игры их не перезапишет.
// Свой префикс `__Secure-` Better Auth добавил бы перед именем (`__Secure-__Host-…`) - он
// выключен (useSecureCookies: false), а Secure стоит атрибутом.

import { readFileSync } from 'node:fs';
import { nextCookies } from 'better-auth/next-js';
import { hubOrigin } from './config.ts';
import { hubDb } from './db.ts';
import { createHubAuth } from './auth-core.ts';

export { SESSION_COOKIE } from './auth-core.ts';

function createAuth(db: NonNullable<ReturnType<typeof hubDb>>, origin: string, secret: string) {
  return createHubAuth(db, origin, secret, [nextCookies()]);
}

export type HubAuth = ReturnType<typeof createAuth>;

let cached: HubAuth | null | undefined;

/**
 * Вход хаба или null, если база не настроена (сборка, e2e без базы). База есть, а origin или
 * секрета нет - ошибка конфигурации: молча работать без входа хуже, чем упасть громко.
 */
export function hubAuth(): HubAuth | null {
  if (cached !== undefined) return cached;
  const db = hubDb();
  if (!db) return (cached = null);
  const origin = hubOrigin();
  if (!origin) throw new Error('база настроена, а GF_HUB_ORIGIN - нет: вход без origin хаба не включается');
  const file = process.env.GF_AUTH_SECRET_FILE;
  if (!file) throw new Error('база настроена, а GF_AUTH_SECRET_FILE - нет: секрет входа берётся только из файла');
  const secret = readFileSync(file, 'utf8').trim();
  if (secret.length < 32) throw new Error('GF_AUTH_SECRET_FILE: секрет короче 32 символов');
  return (cached = createAuth(db, origin, secret));
}
