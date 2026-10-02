// Схема базы хаба (этап 1, D-047): учётки Better Auth (слайс 1.2) и то, что игры пишут через мост. Проверки в базе дублируют проверки моста и API: мост и API - в коде,
// который меняется, а ограничение в базе переживает любую их правку.

import { sql } from 'drizzle-orm';
import { bigint, boolean, check, doublePrecision, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** Лимиты и форматы - те же, что у моста и манифеста (hub-bridge: KEY_RE, MAX_VALUE_BYTES; manifest: ID_RE). */
export const MAX_VALUE_BYTES = 64 * 1024;
const KEY_SQL_RE = '^[a-zA-Z0-9_.-]{1,64}$';
const GAME_ID_SQL_RE = '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$';

// --- Учётки (Better Auth, D-058) ---
// Имена свойств - имена полей Better Auth (адаптер drizzle ищет их по ключам), колонки - snake_case.
// Состав - core-схема better-auth 1.7 и плагина @better-auth/passkey; новое поле при обновлении -
// новая расширяющая миграция (D-051).

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

/** Способ входа: у владельца - providerId "credential" с хешем пароля (scrypt, admin.ts). */
export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const passkey = pgTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at', { withTimezone: true }),
    aaguid: text('aaguid'),
  },
  (t) => [index('passkey_user_id_idx').on(t.userId), index('passkey_credential_id_idx').on(t.credentialID)],
);

// --- Данные игр ---

/** Сохранения вошедшего игрока: одна строка на (игрок, игра, ключ). */
export const gameSaves = pgTable(
  'game_saves',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    gameId: text('game_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.gameId, t.key] }),
    check('game_saves_key_format', sql`${t.key} ~ ${sql.raw(`'${KEY_SQL_RE}'`)}`),
    check('game_saves_game_id_format', sql`${t.gameId} ~ ${sql.raw(`'${GAME_ID_SQL_RE}'`)}`),
    check('game_saves_value_size', sql`octet_length(${t.value}) <= ${sql.raw(String(MAX_VALUE_BYTES))}`),
  ],
);

/** Результаты партий. Лидерборд - по индексу (игра, очки), Valkey не нужен (D-047, Р2). */
export const scores = pgTable(
  'scores',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    gameId: text('game_id').notNull(),
    score: doublePrecision('score').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('scores_game_score_idx').on(t.gameId, t.score.desc()),
    check('scores_game_id_format', sql`${t.gameId} ~ ${sql.raw(`'${GAME_ID_SQL_RE}'`)}`),
    // double precision принимает NaN и бесконечности - очко из них бессмысленно и ломает сортировку.
    check('scores_finite', sql`${t.score} not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`),
  ],
);
