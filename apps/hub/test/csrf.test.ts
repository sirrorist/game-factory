// CSRF хаба (lib/csrf.ts): изменяющий запрос - только с Origin хаба и совпавшим токеном.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCsrf, logSafe, newCsrfToken } from '../src/lib/csrf.ts';

const HUB = 'https://games.youranus.ru';
const TOKEN = newCsrfToken();
const ok = { method: 'POST', origin: HUB, cookie: TOKEN, header: TOKEN };

test('безопасные методы проходят без проверок', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
    assert.deepEqual(checkCsrf({ method, origin: null, cookie: undefined, header: null }, HUB), { ok: true });
  }
});

test('изменяющий запрос с Origin хаба и тем же токеном - проходит', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.deepEqual(checkCsrf({ ...ok, method }, HUB), { ok: true });
});

test('без Origin, с Origin игры или чужим - отказ, даже с верным токеном', () => {
  for (const origin of [null, 'https://snake.play.youranus.ru', 'https://evil.example', `${HUB}.evil.example`, 'null', 'http://games.youranus.ru']) {
    assert.equal(checkCsrf({ ...ok, origin }, HUB).ok, false, String(origin));
  }
});

test('без Origin - отказ с причиной "нет Origin": в журнале видно, что пришло не из браузера', () => {
  assert.deepEqual(checkCsrf({ ...ok, origin: null }, HUB), { ok: false, reason: 'нет Origin' });
});

test('токен: нет куки, нет заголовка, не совпал, другой длины - отказ', () => {
  assert.equal(checkCsrf({ ...ok, cookie: undefined }, HUB).ok, false);
  assert.equal(checkCsrf({ ...ok, header: null }, HUB).ok, false);
  assert.equal(checkCsrf({ ...ok, header: newCsrfToken() }, HUB).ok, false);
  assert.equal(checkCsrf({ ...ok, header: TOKEN.slice(1) }, HUB).ok, false);
  // Короткий токен в куке - не наш (наш - 43 символа base64url), даже если совпал с заголовком.
  assert.equal(checkCsrf({ ...ok, cookie: 'x', header: 'x' }, HUB).ok, false);
});

test('origin хаба не настроен - изменяющие запросы закрыты', () => {
  assert.equal(checkCsrf(ok, null).ok, false);
});

test('токены случайные и не короче 32 байт', () => {
  const a = newCsrfToken();
  assert.notEqual(a, newCsrfToken());
  assert.ok(Buffer.from(a, 'base64url').length >= 32);
});

test('Origin в журнал - без пробелов и кириллицы: чужая строка gf-auth: в журнал хаба не пролезет', () => {
  const evil = 'x gf-auth: вход отклонён ip=192.0.2.9 причина=пароль';
  const v = checkCsrf({ ...ok, origin: evil }, HUB);
  assert.equal(v.ok, false);
  assert.doesNotMatch(v.ok ? '' : v.reason, /gf-auth: |вход отклонён ip=/);
  assert.equal(logSafe('https://snake.play.youranus.ru:443'), 'https://snake.play.youranus.ru:443');
  assert.equal(logSafe('a'.repeat(500)).length, 80);
});
