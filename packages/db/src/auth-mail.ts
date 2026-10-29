// Все переходы очереди сериализуются до user; HTTP никогда не находится в транзакции.
import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, count, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { authActions, authMailCounters, authMailOperations, authRecoveryGuards, retryTransaction, tokenHash, user,
  type AnyDb, type AuthPurpose } from './index.ts';
type PreparedMail = Readonly<{ body: string; createdAt: number }>;
const restorePreparedMail = (mail: PreparedMail, _origin: string) => Object.freeze(mail);
import type { AuthMailKeys } from './auth-crypto.ts';

export const AUTH_MAIL_LIMITS = Object.freeze({ cooldown: 60_000, hour: 3_600_000, day: 86_400_000,
  emailHour: 3, emailDay: 5, browserHour: 10, ipHour: 50, daily: 70, monthly: 2000,
  counters: 10_000, operations: 5000, cleanup: 100, sendReserve: 30_000 });
export const AUTH_MAIL_PROFILE = 'auth-mail.v1';
type Tx = Parameters<Parameters<AnyDb['transaction']>[0]>[0];
type Operation = typeof authMailOperations.$inferSelect;
const aad = (op: Pick<Operation, 'id' | 'purpose' | 'createdAt' | 'profile'>, stage: string) =>
  JSON.stringify([op.id, op.purpose, op.createdAt.getTime(), op.profile, stage]);
const lock = (tx: Tx) => tx.execute(sql`select public.gf_auth_mail_lock()`);
const hour = AUTH_MAIL_LIMITS.hour;
export const normalizeEmail = (s: string) => s.trim().toLowerCase();
export function validAuthEmail(email: string) {
  return email.length <= 254 && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) && email.split('@')[0]!.length <= 64;
}
async function hits(tx: Tx, key: string, since: number) {
  const row = (await tx.select().from(authMailCounters).where(eq(authMailCounters.key, key)))[0];
  return row ? (JSON.parse(row.hits) as number[]).filter(t => t > since) : [];
}
async function saveHits(tx: Tx, key: string, list: number[], expiresAt: number) {
  await tx.insert(authMailCounters).values({ key, hits: JSON.stringify(list), expiresAt: new Date(expiresAt) })
    .onConflictDoUpdate({ target: authMailCounters.key, set: { hits: JSON.stringify(list), expiresAt: new Date(expiresAt) } });
}
async function cleanup(tx: Tx, now: number) {
  // Удаляем только ограниченную порцию; проверка сроков не зависит от очистки.
  const old = await tx.select({ id: authMailOperations.id }).from(authMailOperations)
    .where(lt(authMailOperations.expiresAt, new Date(now))).limit(AUTH_MAIL_LIMITS.cleanup);
  for (const row of old) await tx.delete(authMailOperations).where(eq(authMailOperations.id, row.id));
  const counters = await tx.select({ key: authMailCounters.key }).from(authMailCounters)
    .where(lt(authMailCounters.expiresAt, new Date(now))).limit(AUTH_MAIL_LIMITS.cleanup);
  for (const row of counters) await tx.delete(authMailCounters).where(eq(authMailCounters.key, row.key));
  const actions = await tx.select({ id: authActions.id }).from(authActions)
    .where(lt(authActions.expiresAt, new Date(now))).limit(AUTH_MAIL_LIMITS.cleanup);
  for (const row of actions) await tx.delete(authActions).where(eq(authActions.id, row.id));
  const stale = await tx.select({ id: authMailOperations.id }).from(authMailOperations)
    .where(and(eq(authMailOperations.state, 'started'), lt(authMailOperations.startedAt, new Date(now - 60_000)))).limit(AUTH_MAIL_LIMITS.cleanup);
  for (const row of stale) await tx.update(authMailOperations).set({ state: 'unknown', ciphertext: null, finishedAt: new Date(now) })
    .where(eq(authMailOperations.id, row.id));
}
export function authMailStore(db: AnyDb, keys: AuthMailKeys, origin: string, clock = Date.now) {
  return {
    /** Не обращается к user и не ждёт транспорта. ID намерения не зависит от потери первой browser-cookie. */
    async request(input: { email: string; purpose: AuthPurpose; intent: string; browser: string; ip: string }) {
      const now = clock(), email = normalizeEmail(input.email);
      return retryTransaction(db, async tx => {
        await lock(tx); await cleanup(tx, now);
        const intentKey = keys.digest('intent', input.intent);
        if ((await tx.select({ id: authMailOperations.id }).from(authMailOperations).where(eq(authMailOperations.intentKey, intentKey)))[0]) return { retryAfter: 0 };
        const browserKey = keys.digest('browser', input.browser), ipKey = keys.digest('ip', input.ip);
        const browserHits = await hits(tx, browserKey, now - hour), ipHits = await hits(tx, ipKey, now - hour);
        if (browserHits.length >= 10 || ipHits.length >= 50) {
          const until = Math.max(browserHits.length >= 10 ? browserHits[0]! + hour : 0, ipHits.length >= 50 ? ipHits[0]! + hour : 0);
          return { retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) };
        }
        const size = (await tx.select({ n: count() }).from(authMailCounters))[0]!.n;
        // Переполнение одинаково для всех источников и адресов, без вытеснения живого лимита.
        if (size + 3 > AUTH_MAIL_LIMITS.counters) return { retryAfter: 60 };
        await saveHits(tx, browserKey, [...browserHits, now], now + hour);
        await saveHits(tx, ipKey, [...ipHits, now], now + hour);
        if ((await tx.select({ n: count() }).from(authMailOperations))[0]!.n >= AUTH_MAIL_LIMITS.operations) return { retryAfter: 0 };
        const op = { id: randomUUID(), intentKey, purpose: input.purpose, state: 'suppressed', keyId: keys.currentId,
          profile: AUTH_MAIL_PROFILE, createdAt: new Date(now), expiresAt: new Date(now + AUTH_MAIL_LIMITS.day) };
        // Receipt сохраняется даже при подавлении доставки. Потеря первой Set-Cookie
        // и повтор с тем же намерением не создают другое письмо после cooldown.
        await tx.insert(authMailOperations).values({ ...op, ciphertext: null });
        if (!validAuthEmail(email)) return { retryAfter: 0 };
        const emailKey = keys.digest('email', email), emailHits = await hits(tx, emailKey, now - AUTH_MAIL_LIMITS.day);
        if ((emailHits.at(-1) ?? -Infinity) + AUTH_MAIL_LIMITS.cooldown > now ||
          emailHits.filter(t => t > now - hour).length >= 3 ||
          emailHits.filter(t => new Date(t).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)).length >= 5) return { retryAfter: 0 };
        await saveHits(tx, emailKey, [...emailHits, now], now + AUTH_MAIL_LIMITS.day);
        await tx.update(authMailOperations).set({ state: 'pending', ciphertext: keys.seal({ email }, aad(op, 'intent')) })
          .where(eq(authMailOperations.id, op.id));
        return { retryAfter: 0 };
      });
    },
    /** Захват, выдача token и фиксация начала — одна транзакция, никакого повторного захвата started. */
    async claim(): Promise<{ id: string; mail: PreparedMail } | null> {
      // Обслуживание не держит mail/action-lock, когда следующая транзакция берёт user.
      await retryTransaction(db, async tx => { await lock(tx); await cleanup(tx, clock()); });
      const now = clock();
      // Случайные исходные значения сохраняются при повторе транзакции.
      const token = randomBytes(32).toString('base64url'), actionId = randomUUID();
      return retryTransaction(db, async tx => {
        await lock(tx);
        const op = (await tx.select().from(authMailOperations).where(and(eq(authMailOperations.state, 'pending'),
          gt(authMailOperations.expiresAt, new Date(now + AUTH_MAIL_LIMITS.sendReserve)))).orderBy(asc(authMailOperations.createdAt)).limit(1))[0];
        if (!op) return null;
        const finish = async () => { await tx.update(authMailOperations).set({ state: 'suppressed', ciphertext: null,
          finishedAt: new Date(now) }).where(eq(authMailOperations.id, op.id)); return null; };
        let intent: { email: string };
        try {
          const raw = keys.open(op.ciphertext!, op.keyId, aad(op, 'intent')) as { email: string };
          if (typeof raw?.email !== 'string' || !validAuthEmail(raw.email) || op.profile !== AUTH_MAIL_PROFILE) throw new Error('снимок почты недоступен');
          intent = raw;
        } catch {
          // До начала HTTP сохраняем исходное намерение для восстановления ключа.
          // Ошибка не пересоздаёт ID и не уничтожает ciphertext.
          throw new Error('снимок почты недоступен');
        }
        const matches = await tx.select().from(user).where(sql`lower(btrim(${user.email}))=${intent.email}`).limit(2);
        if (matches.length !== 1) return finish();
        const u = (await tx.select().from(user).where(eq(user.id, matches[0]!.id)).for('update'))[0]!;
        if (normalizeEmail(u.email) !== intent.email || u.status !== 'active' || op.createdAt <= u.authActionsNotBefore) return finish();
        if (op.purpose === 'verify' && u.emailVerified) return finish();
        if (op.purpose === 'reset' && (!['user', 'developer'].includes(u.role) ||
          (await tx.select().from(authRecoveryGuards).where(and(eq(authRecoveryGuards.userId, u.id), eq(authRecoveryGuards.enhancedRequired, true))))[0])) return finish();
        const month = new Date(now).toISOString().slice(0, 7), day = new Date(now).toISOString().slice(0, 10);
        const budgetKey = 'global-auth', budget = await hits(tx, budgetKey, Date.parse(month + '-01T00:00:00Z') - 1);
        if (budget.length >= 2000 || budget.filter(t => new Date(t).toISOString().slice(0, 10) === day).length >= 70) return finish();
        await saveHits(tx, budgetKey, [...budget, now], Date.parse(month + '-01T00:00:00Z') + 32 * AUTH_MAIL_LIMITS.day);
        await tx.update(authActions).set({ revokedAt: new Date(now) }).where(and(eq(authActions.userId, u.id),
          eq(authActions.purpose, op.purpose), isNull(authActions.revokedAt), isNull(authActions.consumedAt)));
        const previous = tx.select({ id: authActions.id }).from(authActions).where(and(eq(authActions.userId, u.id), eq(authActions.purpose, op.purpose)));
        await tx.update(authMailOperations).set({ state: 'suppressed', ciphertext: null, finishedAt: new Date(now) })
          .where(and(eq(authMailOperations.state, 'pending'), sql`${authMailOperations.actionId} in (${previous})`));
        const expiresAt = new Date(now + (op.purpose === 'verify' ? AUTH_MAIL_LIMITS.day : 30 * 60_000));
        await tx.insert(authActions).values({ id: actionId, tokenHash: tokenHash(token), purpose: op.purpose,
          userId: u.id, email: intent.email, generation: u.securityGeneration, createdAt: new Date(now), expiresAt });
        const url = new URL(op.purpose === 'verify' ? '/account/verify-email' : '/account/reset-password', origin);
        url.searchParams.set('token', token);
        const mail = restorePreparedMail({ body: JSON.stringify({ kind: op.purpose === 'verify' ? 'verify-email.v1' : 'reset-password.v1',
          to: intent.email, url: url.href, operationId: op.id }), createdAt: op.createdAt.getTime() }, origin);
        await tx.update(authMailOperations).set({ state: 'started', actionId, startedAt: new Date(now),
          ciphertext: keys.seal(mail, aad(op, 'prepared'), op.keyId) }).where(eq(authMailOperations.id, op.id));
        return { id: op.id, mail };
      });
    },
    async finish(id: string, outcome: 'accepted' | 'not_accepted' | 'unknown') {
      await db.update(authMailOperations).set({ state: outcome, ciphertext: null, finishedAt: new Date(clock()) })
        .where(and(eq(authMailOperations.id, id), eq(authMailOperations.state, 'started')));
    },
  };
}
export type AuthMailStore = ReturnType<typeof authMailStore>;
