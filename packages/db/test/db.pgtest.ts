// Отдельно от `pnpm test` (`pnpm test:db`): PGlite держит ~1,3 ГБ на пике, рядом с продом
// на сервере это гоняется только при свободной памяти (П-043); CI гоняет всегда.
//
// Миграции и ограничения схемы - на PGlite (Postgres в WASM, D-049): тот же SQL, что уйдёт
// в прод, без Docker. Ограничения проверяются отказом базы, а не кодом приложения.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { databaseUrl, gameSaves, MAX_VALUE_BYTES, MIGRATIONS_DIR, ping, schema, scores } from '../src/index.ts';

const client = new PGlite();
const db = drizzle(client, { schema });

before(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

after(() => client.close());

/** Код ошибки Postgres: 23514 - check, 23505 - unique. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.code ?? err.cause?.code ?? 'без кода';
  }
  return 'нет ошибки';
}

test('миграции накатываются, повторный запуск ничего не ломает', async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const r = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_name in ('game_saves', 'scores')`);
  assert.equal((r.rows[0] as { n: number }).n, 2);
  assert.equal(await ping(db), true);
});

test('сохранение: одна строка на игрока, игру и ключ', async () => {
  const row = { userId: 'u1', gameId: 'snake', key: 'progress', value: '{"level":1}' };
  await db.insert(gameSaves).values(row);
  assert.equal(await pgError(db.insert(gameSaves).values({ ...row, value: '{}' })), '23505');
  // Тот же ключ у другой игры и у другого игрока - разные сохранения.
  await db.insert(gameSaves).values({ ...row, gameId: 'phaser-2d' });
  await db.insert(gameSaves).values({ ...row, userId: 'u2' });
});

test('сохранение: размер - в байтах, как у моста; ключ - алфавит и длина моста', async () => {
  const base = { userId: 'u3', gameId: 'snake' };
  await db.insert(gameSaves).values({ ...base, key: 'ok', value: 'x'.repeat(MAX_VALUE_BYTES) });
  assert.equal(await pgError(db.insert(gameSaves).values({ ...base, key: 'big', value: 'x'.repeat(MAX_VALUE_BYTES + 1) })), '23514');
  // Кириллица - 2 байта на символ: предел по байтам, а не по символам.
  assert.equal(await pgError(db.insert(gameSaves).values({ ...base, key: 'ru', value: 'ж'.repeat(MAX_VALUE_BYTES / 2 + 1) })), '23514');
  assert.equal(await pgError(db.insert(gameSaves).values({ ...base, key: '', value: '1' })), '23514');
  assert.equal(await pgError(db.insert(gameSaves).values({ ...base, key: 'k'.repeat(65), value: '1' })), '23514');
  for (const key of ['a b', 'a/b', 'ключ', 'a\u202eb']) {
    assert.equal(await pgError(db.insert(gameSaves).values({ ...base, key, value: '1' })), '23514', key);
  }
});

test('id игры - формат манифеста, в обеих таблицах', async () => {
  for (const gameId of ['Snake', '-snake', 'snake-', 'sn ake', 'a'.repeat(41), '']) {
    assert.equal(await pgError(db.insert(gameSaves).values({ userId: 'u4', gameId, key: 'k', value: '1' })), '23514', gameId);
    assert.equal(await pgError(db.insert(scores).values({ userId: 'u4', gameId, score: 1 })), '23514', gameId);
  }
});

test('ping на недоступной базе - false, а не исключение', async () => {
  const dead = new PGlite();
  await dead.close();
  assert.equal(await ping(drizzle(dead)), false);
});

test('очки: только конечные числа', async () => {
  await db.insert(scores).values({ userId: 'u1', gameId: 'snake', score: 42 });
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(await pgError(db.insert(scores).values({ userId: 'u1', gameId: 'snake', score: bad })), '23514', String(bad));
  }
});

test('лидерборд идёт по индексу (игра, очки)', async () => {
  const r = await db.execute(sql`select indexdef from pg_indexes where indexname = 'scores_game_score_idx'`);
  const def = String((r.rows[0] as { indexdef: string } | undefined)?.indexdef);
  assert.match(def, /\(game_id, score DESC( NULLS LAST)?\)/, def);
});

test('адрес базы: пароль только из файла, спецсимволы кодируются', () => {
  assert.equal(databaseUrl({}), null);
  assert.equal(databaseUrl({ GF_DATABASE_URL: 'postgres://a@b/c' }), 'postgres://a@b/c');
  assert.throws(() => databaseUrl({ GF_DB_HOST: 'db' }), /GF_DB_PASSWORD_FILE/);

  const dir = mkdtempSync(join(tmpdir(), 'gf-db-'));
  const file = join(dir, 'password');
  writeFileSync(file, 'p@ss/w:rd#1\n');
  const url = new URL(databaseUrl({ GF_DB_HOST: 'db', GF_DB_PASSWORD_FILE: file })!);
  assert.equal(decodeURIComponent(url.password), 'p@ss/w:rd#1');
  assert.equal(url.hostname, 'db');
  assert.equal(url.pathname, '/gf');

  writeFileSync(file, '  \n');
  assert.throws(() => databaseUrl({ GF_DB_HOST: 'db', GF_DB_PASSWORD_FILE: file }), /пуст/);
});
