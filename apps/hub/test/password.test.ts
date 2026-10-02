// Хеш пароля владельца пишет packages/db (admin.ts, без зависимостей), а проверяет при входе
// Better Auth. Форматы должны совпадать - иначе владелец, заведённый командой, не войдёт.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword as betterAuthHash, verifyPassword } from 'better-auth/crypto';
import { hashPassword } from '../../../packages/db/src/admin.ts';

test('хеш команды admin.ts принимает Better Auth, и наоборот', async () => {
  for (const password of ['correct horse battery', 'пароль с кириллицей и ё', 'ﬁ ligature NFKC']) {
    const ours = await hashPassword(password);
    assert.equal(await verifyPassword({ hash: ours, password }), true, password);
    assert.equal(await verifyPassword({ hash: ours, password: `${password}!` }), false);
    const theirs = await betterAuthHash(password);
    const [salt] = theirs.split(':');
    assert.equal(await hashPassword(password, salt), theirs);
  }
});
