import { createHash } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { AnyDb } from './index.ts';
import { authActions } from './auth-schema.ts';
import { retryTransaction } from './transaction.ts';
export type AuthPurpose = 'verify' | 'reset';
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export type ConsumeResult = 'ok' | 'invalid' | 'conflict';
/** SQL перепроверяет исходный bearer после блокировок. Хеш из таблицы не является bearer. */
export async function consumeAuthAction(db: AnyDb, input: {
  token: string; purpose: AuthPurpose; passwordHash?: string; sessionId?: string;
}): Promise<ConsumeResult> {
  if (!TOKEN_RE.test(input.token)) return 'invalid';
  return retryTransaction(db, async tx => {
    const result = await tx.execute(sql`select public.gf_consume_auth_action(
      ${input.token}, ${input.purpose}, ${input.passwordHash ?? null}, ${input.sessionId ?? null}) as outcome`);
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { outcome: ConsumeResult }[];
    return rows[0]?.outcome ?? 'invalid';
  });
}

export async function hasPendingAuthAction(db: AnyDb, token: string, purpose: AuthPurpose) {
  if (!TOKEN_RE.test(token)) return false;
  return Boolean((await db.select({ id: authActions.id }).from(authActions).where(and(
    eq(authActions.tokenHash, tokenHash(token)), eq(authActions.purpose, purpose),
    isNull(authActions.consumedAt), isNull(authActions.revokedAt), gt(authActions.expiresAt, new Date()),
  )).limit(1))[0]);
}
