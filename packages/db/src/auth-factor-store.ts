// Единственный SQL-канал контроллера B: каждая процедура — своя короткая
// транзакция. Между committed-допуском и crypto verifier транзакции нет.
import { sql, type SQL } from 'drizzle-orm';
import type { AnyDb } from './index.ts';
import { retryTransaction } from './transaction.ts';

export interface FactorSnapshot {
  user: { id: string; email: string; name: string; role: string; status: string; security_generation: number };
  account: { id: string; password: string | null } | null;
  context: { token_hash: string; purpose: string; session_id: string | null; session_bearer_hash: string | null } | null;
  factor: { id: string; key_id: string; ciphertext: string; state: string; last_step: number } | null;
  required: boolean;
}
export interface FactorSession { id: string; token: string; user_id: string; security_generation: number;
  expires_at: string; created_at: string; updated_at: string }
export interface SessionProof { userId: string; generation: number; required: boolean;
  method: 'password' | 'totp' | 'uv' | null; verifiedAt: string | null; issuanceId: string | null }
export interface UvSnapshot { userId: string; generation: number; fingerprint: string; factorId: string | null;
  state: 'pending' | 'active' | null; required: boolean;
  key: { id: string; user_id: string; credential_id: string; public_key: string; counter: number } }

export async function factorResult<T>(db: AnyDb, query: SQL): Promise<T> {
  return retryTransaction(db, async tx => {
    const result = await tx.execute(query);
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { value: T }[];
    if (!rows.length) throw new Error('нет результата защищённой auth-процедуры');
    return rows[0]!.value;
  });
}
const array = (values: readonly string[]) => sql`ARRAY[${sql.join(values.map(value => sql`${value}`), sql`, `)}]::text[]`;

export function factorStore(db: AnyDb) {
  return Object.freeze({
    snapshot(email: string | null, hash: string | null): Promise<FactorSnapshot | null> {
      return factorResult(db, sql`select public.gf_b_snapshot(${email},${hash}) as value`);
    },
    access(id: string, bearer: string): Promise<SessionProof | null> {
      return factorResult(db, sql`select public.gf_b_session_access(${id},${bearer}) as value`);
    },
    passwordContext(s: FactorSnapshot, hash: string, purpose: 'login' | 'reauth' | 'password',
      original: { id: string; bearer: string } | null, sourceHash: string): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_password_context(${s.user.id},${s.user.security_generation},
        ${s.account!.id},${s.account!.password},${hash},${purpose},${original?.id ?? null},${original?.bearer ?? null},${sourceHash}) as value`);
    },
    reserve(hash: string, sourceHash: string, attempt: string): Promise<{ attemptId: string; purpose: string; userId: string | null } | null> {
      return factorResult(db, sql`select public.gf_b_reserve(${hash},${sourceHash},${attempt}) as value`);
    },
    totpLogin(hash: string, attempt: string, factor: { id: string; ciphertext: string }, step: number,
      session: { id: string; token: string; issuance: string }): Promise<FactorSession | null> {
      return factorResult(db, sql`select public.gf_b_totp_login(${hash},${attempt},${factor.id},${factor.ciphertext},
        ${step},${session.id},${session.token},${session.issuance}) as value`);
    },
    passwordLogin(hash: string, session: { id: string; token: string; issuance: string }): Promise<FactorSession | null> {
      return factorResult(db, sql`select public.gf_b_password_login(${hash},${session.id},${session.token},${session.issuance}) as value`);
    },
    setup(session: { id: string; bearer: string }, hash: string): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_setup(${session.id},${session.bearer},${hash}) as value`);
    },
    exchange(hash: string, cookieHash: string): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_exchange_enrol(${hash},${cookieHash}) as value`);
    },
    pending(hash: string, id: string, encrypted: { keyId: string; ciphertext: string }): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_totp_pending(${hash},${id},${encrypted.keyId},${encrypted.ciphertext}) as value`);
    },
    complete(hash: string, attempt: string, factor: { id: string; ciphertext: string }, step: number,
      hashes: readonly string[], setId: string, passwordHash: string | null): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_totp_complete(${hash},${attempt},${factor.id},${factor.ciphertext},
        ${step},${array(hashes)},${setId},${passwordHash}) as value`);
    },
    backupContext(hash: string, sourceHash: string): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_backup_context(${hash},${sourceHash}) as value`);
    },
    recover(hash: string, attempt: string, userId: string, codeHash: string, enrolHash: string): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_backup_recover(${hash},${attempt},${userId},${codeHash},${enrolHash}) as value`);
    },
    passwordChange(session: { id: string; bearer: string }, account: { id: string; password: string }, nextHash: string): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_password_change(${session.id},${session.bearer},${account.id},${account.password},${nextHash}) as value`);
    },
    rotate(session: { id: string; bearer: string }, hashes: readonly string[], setId: string): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_backup_rotate(${session.id},${session.bearer},${array(hashes)},${setId}) as value`);
    },
    disable(session: { id: string; bearer: string }): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_disable_optional(${session.id},${session.bearer}) as value`);
    },
    uvSnapshot(credentialId: string): Promise<UvSnapshot | null> {
      return factorResult(db, sql`select public.gf_b_uv_snapshot(${credentialId}) as value`);
    },
    enrolKey(hash: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
      return factorResult(db, sql`select public.gf_b_enrol_key(${hash},${JSON.stringify(data)}::jsonb) as value`);
    },
    uvContext(session: { id: string; bearer: string }, hash: string): Promise<boolean> {
      return factorResult(db, sql`select public.gf_b_uv_context(${session.id},${session.bearer},${hash}) as value`);
    },
    uvFinish(snapshot: UvSnapshot, counter: number, hash: string | null,
      session: { id: string; token: string; issuance: string }, hashes: readonly string[], setId: string): Promise<FactorSession | { enrolled: true } | null> {
      return factorResult(db, sql`select public.gf_b_uv_finish(${snapshot.userId},${snapshot.generation},${snapshot.key.id},
        ${snapshot.fingerprint},${counter},${hash},${session.id},${session.token},${session.issuance},${array(hashes)},${setId}) as value`);
    },
  });
}
export type FactorStore = ReturnType<typeof factorStore>;
