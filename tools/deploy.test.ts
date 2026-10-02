// Прод-конфиг (deploy/compose.prod.yml) и CI держатся вместе: то, что легко разъехать молча.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const compose = readFileSync(new URL('deploy/compose.prod.yml', ROOT), 'utf8');
const ci = readFileSync(new URL('.github/workflows/ci.yml', ROOT), 'utf8');

/** Блок сервиса compose: от "  имя:" до следующего сервиса того же отступа. */
function service(name: string): string {
  const m = compose.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z]+:\\n|\\nvolumes:)`));
  assert.ok(m, `сервис ${name} не найден`);
  return m[1]!;
}

test('Postgres в CI - тот же образ по digest, что db на проде (Dependabot обновляет только compose)', () => {
  const prod = compose.match(/image: (postgres:[^\s]+@sha256:[0-9a-f]{64})/)?.[1];
  assert.ok(prod, 'нет образа db по digest');
  assert.ok(ci.includes(`image: ${prod}`), `в ci.yml другой образ Postgres - поставить ${prod}`);
});

test('хаб ходит в базу ролью gf_hub, пароля владельца базы у него нет (D-051)', () => {
  const hub = service('hub');
  assert.match(hub, /GF_DB_USER: gf_hub/);
  assert.match(hub, /GF_DB_PASSWORD_FILE: \/run\/secrets\/gf_db_hub_password/);
  assert.doesNotMatch(hub, /gf_db_password\b/);
  assert.match(hub, /GF_AUTH_SECRET_FILE: \/run\/secrets\/gf_auth_secret/);
  assert.match(hub, /GF_HUB_ORIGIN: https:\/\/games\.youranus\.ru\n/);
});

test('роль хаба заводит migrate: у него пароль роли хаба, у play и games секретов нет', () => {
  assert.match(service('migrate'), /GF_DB_HUB_PASSWORD_FILE: \/run\/secrets\/gf_db_hub_password/);
  for (const name of ['play', 'games']) assert.doesNotMatch(service(name), /secrets/, name);
});
