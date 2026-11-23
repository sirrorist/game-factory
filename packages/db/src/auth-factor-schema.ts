// Закрытая схема B: обычный gf_hub не получает даже USAGE этой схемы.
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { session, user } from './schema.ts';

export const authPrivate = pgSchema('auth_private');
const time = (name: string) => timestamp(name, { withTimezone: true }).notNull();
export const authFactors = authPrivate.table('factors', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), state: text('state').notNull(),
  keyId: text('key_id'), ciphertext: text('ciphertext'),
  credentialId: text('credential_id'), fingerprint: text('fingerprint'),
  lastStep: bigint('last_step', { mode: 'number' }).notNull().default(-1),
  createdAt: time('created_at'), expiresAt: timestamp('expires_at', { withTimezone: true }),
}, t => [check('factor_kind', sql`${t.kind} in ('totp', 'uv')`),
  check('factor_state', sql`${t.state} in ('pending', 'active')`),
  check('factor_material', sql`(${t.kind} = 'totp' and ${t.keyId} is not null and ${t.ciphertext} is not null and ${t.credentialId} is null)
    or (${t.kind} = 'uv' and ${t.credentialId} is not null and ${t.fingerprint} is not null and ${t.ciphertext} is null)`),
  index('factor_user_idx').on(t.userId, t.kind, t.state)]);

export const authContexts = authPrivate.table('contexts', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  generation: integer('generation'), purpose: text('purpose').notNull(),
  credentialId: text('credential_id'), credentialHash: text('credential_hash'),
  sessionId: text('session_id'), sessionBearerHash: text('session_bearer_hash'),
  state: text('state').notNull().default('active'), attempts: integer('attempts').notNull().default(0),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: time('created_at'), expiresAt: time('expires_at'),
}, t => [check('context_hash', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check('context_state', sql`${t.state} in ('active', 'spent')`),
  check('context_purpose', sql`${t.purpose} in ('login','reauth','password','enrol-token','enrol-cookie','setup','backup')`),
  check('context_attempts', sql`${t.attempts} between 0 and 5`),
  index('context_expiry_idx').on(t.expiresAt), index('context_user_idx').on(t.userId)]);

export const authProofs = authPrivate.table('proofs', {
  sessionId: text('session_id').primaryKey().references(() => session.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  generation: integer('generation').notNull(), bearerHash: text('bearer_hash').notNull(),
  issuanceId: text('issuance_id').notNull().unique(), method: text('method').notNull(),
  factorId: text('factor_id'), verifiedAt: time('verified_at'),
}, t => [check('proof_method', sql`${t.method} in ('password', 'totp', 'uv')`),
  check('proof_bearer_hash', sql`${t.bearerHash} ~ '^[a-f0-9]{64}$'`)]);

export const authReservations = authPrivate.table('reservations', {
  id: text('id').primaryKey(), contextHash: text('context_hash').notNull().references(() => authContexts.tokenHash, { onDelete: 'cascade' }),
  createdAt: time('created_at'), finishedAt: timestamp('finished_at', { withTimezone: true }),
}, t => [index('reservation_context_idx').on(t.contextHash)]);

export const authFactorCounters = authPrivate.table('counters', {
  key: text('key').primaryKey(), domain: text('domain').notNull(),
  hits: jsonb('hits').$type<number[]>().notNull(), expiresAt: time('expires_at'),
}, t => [check('factor_counter_domain', sql`${t.domain} in ('mfa', 'backup', 'issue', 'enrol')`),
  check('factor_counter_bounded', sql`jsonb_typeof(${t.hits}) = 'array' and jsonb_array_length(${t.hits}) <= 20`),
  index('factor_counter_expiry_idx').on(t.expiresAt)]);

export const authBackupCodes = authPrivate.table('backup_codes', {
  codeHash: text('code_hash').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  setId: text('set_id').notNull(), createdAt: time('created_at'),
}, t => [check('backup_hash', sql`${t.codeHash} ~ '^[a-f0-9]{64}$'`), index('backup_user_idx').on(t.userId)]);
