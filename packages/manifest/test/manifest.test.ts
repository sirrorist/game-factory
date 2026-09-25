import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GAME_KINDS, PERMISSIONS, TOOLCHAINS, isSafeRelativePath, validateManifest,
} from '../src/index.ts';

const valid = {
  id: 'snake',
  title: 'Змейка',
  version: '1.0.0',
  kind: 'static',
  toolchain: 'static',
  entry: 'index.html',
  offline: true,
  permissions: ['saves', 'leaderboard'],
  tags: ['arcade'],
};

function errorsOf(patch: Record<string, unknown>): string[] {
  const r = validateManifest({ ...valid, ...patch });
  return r.ok ? [] : r.errors;
}

test('валидный манифест проходит', () => {
  const r = validateManifest(valid);
  assert.equal(r.ok, true);
});

test('не объект — ошибка', () => {
  for (const v of [null, [], 'x', 1]) assert.equal(validateManifest(v).ok, false);
});

test('неизвестное поле ловится как опечатка', () => {
  assert.match(errorsOf({ permisions: [] }).join(), /неизвестное поле "permisions"/);
});

test('id: формат поддомена и зарезервированные имена', () => {
  for (const bad of ['Snake', '-a', 'a-', 'a_b', 'a.b', '', 'x'.repeat(41)]) {
    assert.ok(errorsOf({ id: bad }).length > 0, `ожидалась ошибка для "${bad}"`);
  }
  for (const good of ['a', 'a1', 'my-game', 'x'.repeat(40)]) {
    assert.deepEqual(errorsOf({ id: good }), [], `не ожидалась ошибка для "${good}"`);
  }
  assert.match(errorsOf({ id: 'admin' }).join(), /зарезервирован/);
});

test('version: только semver', () => {
  assert.ok(errorsOf({ version: '1.0' }).length > 0);
  assert.ok(errorsOf({ version: 'v1.0.0' }).length > 0);
  assert.deepEqual(errorsOf({ version: '1.2.3-beta.1' }), []);
});

test('пути: без выхода наверх, абсолютных и скрытых', () => {
  for (const bad of ['../x.html', '/index.html', 'a/../b.html', 'a\\b.html', 'C:/x.html', '.hidden/x.html', 'a//b.html']) {
    assert.ok(errorsOf({ entry: bad }).length > 0, `ожидалась ошибка для "${bad}"`);
  }
  assert.deepEqual(errorsOf({ entry: 'play/index.html' }), []);
  assert.ok(errorsOf({ entry: 'index.js' }).length > 0);
});

test('offline только для static', () => {
  assert.match(errorsOf({ kind: 'server', toolchain: 'docker' }).join(), /offline/);
  assert.deepEqual(errorsOf({ kind: 'server', toolchain: 'docker', offline: false }), []);
});

test('permissions: неизвестные и повторы', () => {
  assert.ok(errorsOf({ permissions: ['camera'] }).length > 0);
  assert.ok(errorsOf({ permissions: ['saves', 'saves'] }).length > 0);
  assert.ok(errorsOf({ permissions: 'saves' }).length > 0);
});

test('output запрещён для static', () => {
  assert.ok(errorsOf({ output: 'dist' }).length > 0);
});

test('isSafeRelativePath', () => {
  assert.equal(isSafeRelativePath('a/b.png'), true);
  assert.equal(isSafeRelativePath('a/\0b.png'), false);
  assert.equal(isSafeRelativePath(''), false);
});

test('game.schema.json совпадает с валидатором по перечислениям', () => {
  const schema = JSON.parse(readFileSync(new URL('../game.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.kind.enum, [...GAME_KINDS]);
  assert.deepEqual(schema.properties.toolchain.enum, [...TOOLCHAINS]);
  assert.deepEqual(schema.properties.permissions.items.enum, [...PERMISSIONS]);
});
