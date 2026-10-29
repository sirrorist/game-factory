// Отдельные области: bearer-доказательство, зашифрованная доставка и ограниченные счётчики.
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './schema.ts';
const time = (name: string) => timestamp(name, { withTimezone: true }).notNull();
export const authActions = pgTable('auth_actions', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').notNull().unique(),
  purpose: text('purpose').notNull(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  email: text('email').notNull(), generation: integer('generation').notNull(),
  expiresAt: time('expires_at'), createdAt: time('created_at'),
  consumedAt: timestamp('consumed_at', { withTimezone: true }), revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, t => [check('auth_token_hash_format', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`), check('auth_action_purpose', sql`${t.purpose} in ('verify', 'reset')`),
  index('auth_action_user_idx').on(t.userId, t.purpose), index('auth_action_expiry_idx').on(t.expiresAt)]);
export const authMailOperations = pgTable('auth_mail_operations', {
  id: text('id').primaryKey(), intentKey: text('intent_key').notNull().unique(), purpose: text('purpose').notNull(),
  state: text('state').notNull(), keyId: text('key_id').notNull(), ciphertext: text('ciphertext'),
  actionId: text('action_id').references(() => authActions.id, { onDelete: 'set null' }),
  profile: text('profile').notNull(), createdAt: time('created_at'), expiresAt: time('expires_at'),
  startedAt: timestamp('started_at', { withTimezone: true }), finishedAt: timestamp('finished_at', { withTimezone: true }),
}, t => [check('auth_mail_state', sql`${t.state} in ('pending','started','accepted','not_accepted','unknown','suppressed')`),
  check('auth_mail_purpose', sql`${t.purpose} in ('verify','reset')`),
  index('auth_mail_pending_idx').on(t.state, t.createdAt), index('auth_mail_action_idx').on(t.actionId)]);
export const authMailCounters = pgTable('auth_mail_counters', {
  key: text('key').primaryKey(), hits: text('hits').notNull(), expiresAt: time('expires_at'),
}, t => [check('auth_counter_bounded', sql`octet_length(${t.hits}) <= 65536`), index('auth_counter_expiry_idx').on(t.expiresAt)]);
// Подготовка будущего B: только оператор/миграция может включать обязательный фактор.
export const authRecoveryGuards = pgTable('auth_recovery_guards', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  enhancedRequired: boolean('enhanced_required').notNull().default(true),
});
