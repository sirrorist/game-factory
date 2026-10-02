// Пререлизы (lib/prerelease.ts): до 1.0.0 и с суффиксом - только владельцу (D-060).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrerelease } from '../src/lib/prerelease.ts';

test('0.x.y и суффикс semver - пререлиз, с 1.0.0 - нет', () => {
  for (const v of ['0.1.0', '0.2.0', '0.99.99', '1.0.0-rc.1', '2.1.0-beta']) assert.equal(isPrerelease(v), true, v);
  for (const v of ['1.0.0', '1.0.3', '10.2.1']) assert.equal(isPrerelease(v), false, v);
});

test('непонятная версия - не показываем гостю', () => {
  for (const v of ['', '1', '1.0', 'v1.0.0', '1.0.0-', 'latest']) assert.equal(isPrerelease(v), true, v);
});
