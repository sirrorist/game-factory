// Схема базы хаба (этап 1, D-047): учётки - слайс 1.2 (Better Auth), здесь - то, что игры
// пишут через мост. Проверки в базе дублируют проверки моста и API: мост и API - в коде,
// который меняется, а ограничение в базе переживает любую их правку.

import { sql } from 'drizzle-orm';
import { bigint, check, doublePrecision, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** Лимиты и форматы - те же, что у моста и манифеста (hub-bridge: KEY_RE, MAX_VALUE_BYTES; manifest: ID_RE). */
export const MAX_VALUE_BYTES = 64 * 1024;
const KEY_SQL_RE = '^[a-zA-Z0-9_.-]{1,64}$';
const GAME_ID_SQL_RE = '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$';

/** Сохранения вошедшего игрока: одна строка на (игрок, игра, ключ). */
export const gameSaves = pgTable(
  'game_saves',
  {
    // Внешний ключ на пользователя появится вместе с таблицей учёток (слайс 1.2).
    userId: text('user_id').notNull(),
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
    userId: text('user_id').notNull(),
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
