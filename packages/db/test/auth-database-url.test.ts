// Адрес базы для процедур B: только роль gf_auth, пароль только файлом, без отката на адрес хаба -
// иначе B молча пошёл бы ролью gf_hub или владельцем базы (находка роли "Безопасность" 2026-11-23).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authDatabaseUrl } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'gf-auth-url-'));

test('authDatabaseUrl: без настроек - null, а не адрес хаба', () => {
  assert.equal(authDatabaseUrl({}), null);
  assert.equal(authDatabaseUrl({ GF_DATABASE_URL: 'postgres://gf_hub:x@db/gf' }), null);
});

test('authDatabaseUrl: хост без файла пароля или с пустым файлом - отказ, без отката на пароль хаба', () => {
  const hub = join(dir, 'hub');
  writeFileSync(hub, 'пароль хаба не для gf_auth');
  assert.throws(() => authDatabaseUrl({ GF_DB_HOST: 'db', GF_DB_PASSWORD_FILE: hub }), /GF_DB_AUTH_PASSWORD_FILE/);
  const empty = join(dir, 'empty');
  writeFileSync(empty, '\n');
  assert.throws(() => authDatabaseUrl({ GF_DB_HOST: 'db', GF_DB_AUTH_PASSWORD_FILE: empty }), /пуст/);
});

test('authDatabaseUrl: пользователь всегда gf_auth, пароль из файла кодируется', () => {
  const file = join(dir, 'auth');
  writeFileSync(file, 'p@ss:w/rd#1 со спецсимволами\n');
  const url = new URL(authDatabaseUrl({ GF_DB_HOST: 'db', GF_DB_PORT: '5433', GF_DB_NAME: 'hub', GF_DB_USER: 'gf_hub',
    GF_DB_AUTH_PASSWORD_FILE: file })!);
  assert.equal(url.username, 'gf_auth');
  assert.equal(decodeURIComponent(url.password), 'p@ss:w/rd#1 со спецсимволами');
  assert.equal(url.host, 'db:5433');
  assert.equal(url.pathname, '/hub');
});
