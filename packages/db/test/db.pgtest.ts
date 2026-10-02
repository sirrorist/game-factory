// Отдельно от `pnpm test` (`pnpm test:db`): PGlite держит ~1,3 ГБ на пике, рядом с продом
// на сервере это гоняется только при свободной памяти (П-043); CI гоняет всегда.
//
// Миграции и ограничения схемы - на PGlite (Postgres в WASM, D-049): тот же SQL, что уйдёт
// в прод, без Docker. Ограничения проверяются отказом базы, а не кодом приложения.

import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { account, databaseUrl, gameSaves, MAX_VALUE_BYTES, passkey, ping, schema, scores, session, user } from '../src/index.ts';
import { createOwner, hashPassword, setPassword } from '../src/admin.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { ensureHubRole, HUB_ROLE, quoteLiteral, scramVerifier } from '../src/roles.ts';

const client = new PGlite();
const db = drizzle(client, { schema });

before(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // Сохранения и очки ссылаются на учётку (внешний ключ, слайс 1.2).
  for (const id of ['u1', 'u2', 'u3', 'u4']) await db.insert(user).values({ id, name: id, email: `${id}@test` });
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
  const r = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_name in ('game_saves', 'scores', 'user', 'session', 'account', 'verification', 'passkey')`);
  assert.equal((r.rows[0] as { n: number }).n, 7);
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

test('сохранение и очки - только у существующей учётки, удаление учётки уносит её данные', async () => {
  assert.equal(await pgError(db.insert(gameSaves).values({ userId: 'nobody', gameId: 'snake', key: 'k', value: '1' })), '23503');
  assert.equal(await pgError(db.insert(scores).values({ userId: 'nobody', gameId: 'snake', score: 1 })), '23503');
  await db.insert(user).values({ id: 'gone', name: 'gone', email: 'gone@test' });
  await db.insert(gameSaves).values({ userId: 'gone', gameId: 'snake', key: 'k', value: '1' });
  await db.delete(user).where(sql`${user.id} = 'gone'`);
  const left = await db.execute(sql`select count(*)::int as n from game_saves where user_id = 'gone'`);
  assert.equal((left.rows[0] as { n: number }).n, 0);
});

test('владелец: заводится с хешем scrypt, второй раз - отказ, смена пароля сбрасывает сессии', async () => {
  const id = await createOwner(db, 'owner@test', 'Владелец', 'correct horse battery');
  const [acc] = await db.select().from(account).where(sql`${account.userId} = ${id}`);
  assert.equal(acc?.providerId, 'credential');
  assert.match(String(acc?.password), /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  // Хеш воспроизводится по соли - это и проверяет хаб при входе.
  const [salt] = String(acc?.password).split(':');
  assert.equal(await hashPassword('correct horse battery', salt), acc?.password);
  assert.notEqual(await hashPassword('correct horse batterY', salt), acc?.password);
  await assert.rejects(createOwner(db, 'owner@test', 'Ещё', 'correct horse battery'), /уже есть/);
  await assert.rejects(createOwner(db, 'short@test', 'Коротко', 'short'), /короче/);

  await db.insert(session).values({ id: 's1', token: 't1', userId: id, expiresAt: new Date(Date.now() + 60_000) });
  await db.insert(passkey).values({ id: 'pk1', publicKey: 'k', userId: id, credentialID: 'c', counter: 0, deviceType: 'singleDevice', backedUp: false });
  await setPassword(db, 'owner@test', 'another long password');
  const [after] = await db.select().from(account).where(sql`${account.userId} = ${id}`);
  assert.notEqual(after?.password, acc?.password);
  const s = await db.execute(sql`select count(*)::int as n from session where user_id = ${id}`);
  assert.equal((s.rows[0] as { n: number }).n, 0);
  // Ключ, добавленный тем, кто знал старый пароль, после смены не пускает.
  const pk = await db.execute(sql`select count(*)::int as n from passkey where user_id = ${id}`);
  assert.equal((pk.rows[0] as { n: number }).n, 0);
  await assert.rejects(setPassword(db, 'nobody@test', 'another long password'), /нет/);
});

test('роль хаба: данные - можно, схему и программы сервера - нельзя', async () => {
  await assert.rejects(ensureHubRole(db, 'short'), /короче 16/);
  await assert.rejects(ensureHubRole(db, 'hub password with spaces'), /ASCII/);
  await ensureHubRole(db, "hub'pass'with'quotes-123");
  await ensureHubRole(db, 'hub password second run'); // повторный запуск - смена пароля, не ошибка
  // В базу уходит SCRAM-верификатор, а не пароль: открытого пароля нет ни в pg_authid, ни в журнале.
  const stored = await db.execute(sql`select rolpassword from pg_authid where rolname = ${HUB_ROLE}`);
  assert.match(String((stored.rows[0] as { rolpassword: string }).rolpassword), /^SCRAM-SHA-256\$4096:/);
  const role = await db.execute(sql`select rolsuper, rolcreatedb, rolcreaterole, rolcanlogin from pg_roles where rolname = ${HUB_ROLE}`);
  assert.deepEqual(role.rows[0], { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true });

  await db.execute(sql.raw(`set role ${HUB_ROLE}`));
  try {
    await db.insert(scores).values({ userId: 'u1', gameId: 'snake', score: 7 }); // identity - нужен usage на последовательность
    await db.select().from(gameSaves);
    await db.update(gameSaves).set({ value: '2' }).where(sql`${gameSaves.userId} = 'u2'`);
    assert.equal(await pgError(db.execute(sql`create table hub_evil (id int)`)), '42501');
    assert.equal(await pgError(db.execute(sql`alter table scores add column evil int`)), '42501');
    assert.equal(await pgError(db.execute(sql`drop table scores`)), '42501');
    assert.equal(await pgError(db.execute(sql`copy scores to program 'id'`)), '42501');
    assert.equal(await pgError(db.execute(sql`create role hub_child`)), '42501');
  } finally {
    await db.execute(sql`reset role`);
  }
});

test('литерал SQL: кавычка удваивается, нулевой байт - отказ', () => {
  assert.equal(quoteLiteral("a'b"), "'a''b'");
  assert.throws(() => quoteLiteral('a\u0000b'), /нулевой/);
});

test('SCRAM-верификатор: формат Postgres и известный вектор RFC 7677', () => {
  // RFC 7677, пример SCRAM-SHA-256: пароль pencil, соль W22ZaJ0SNY7soEsUEjb6gQ==, 4096 итераций.
  const v = scramVerifier('pencil', Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'));
  assert.equal(v, 'SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=');
  // Подпись сервера из того же примера RFC: значит, ServerKey верный, и Postgres примет вход.
  const serverKey = Buffer.from(v.split(':').pop()!, 'base64');
  const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
  const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
  assert.equal(createHmac('sha256', serverKey).update(authMessage).digest('base64'), '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  assert.throws(() => scramVerifier('пароль', Buffer.alloc(16)), /ASCII/);
});
