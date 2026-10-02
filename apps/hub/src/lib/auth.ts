// Вход в хаб - Better Auth (D-047 Р4, D-058): пароль + passkey, только владелец (Р3).
// Регистрации нет: владелец заводится командой на сервере (packages/db/src/admin.ts).
//
// Куки - только `__Host-` (П-006): Secure, Path=/, без Domain - поддомен игры их не перезапишет.
// Свой префикс `__Secure-` Better Auth добавил бы перед именем (`__Secure-__Host-…`) - он
// выключен (useSecureCookies: false), а Secure стоит атрибутом.

import { readFileSync } from 'node:fs';
import { passkey } from '@better-auth/passkey';
import { MIN_PASSWORD_LENGTH, schema } from '@gf/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { hubOrigin } from './config.ts';
import { hubDb } from './db.ts';

export const SESSION_COOKIE = '__Host-gf-session';

function createAuth(db: NonNullable<ReturnType<typeof hubDb>>, origin: string, secret: string) {
  return betterAuth({
    appName: 'Game Factory',
    baseURL: origin,
    secret,
    // Better Auth сам сверяет Origin изменяющих запросов с этим списком - вторая линия к proxy.ts.
    trustedOrigins: [origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, passkey: schema.passkey },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
    // Кеш сессии в куке - лишняя кука и задержка отзыва сессии; запрос в базу у нас дешёвый.
    session: { cookieCache: { enabled: false } },
    // Общий лимит запросов к /api/auth. Перебор пароля режет LoginGuard (route.ts) - со счётом,
    // банами и строкой для fail2ban; свой лимит Better Auth на вход (3 за 10 с) ему мешал бы считать.
    rateLimit: { enabled: true, storage: 'memory', customRules: { '/sign-in/email': { window: 60, max: 10 } } },
    advanced: {
      useSecureCookies: false,
      cookiePrefix: '__Host-gf',
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      cookies: { session_token: { name: SESSION_COOKIE } },
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    // nextCookies - последним: он переносит Set-Cookie из вызовов auth.api в ответ Next.
    plugins: [passkey({ rpID: new URL(origin).hostname, rpName: 'Game Factory', origin }), nextCookies()],
  });
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
