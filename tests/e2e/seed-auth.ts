// Учётки e2e входа (B): developer без второго фактора - для формы, кук, CSRF, лимита и passkey;
// активный TOTP владельца - заводится прямо в базе, экрана включения TOTP ещё нет. Запускается
// ролью-владельцем базы (GF_DATABASE_URL), повторный запуск обновляет то же самое.
// Аргументы: email и имя developer, файлы его пароля, ключа факторов и секрета TOTP, email владельца.

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
// drizzle-orm - зависимость packages/db, из корня тестов не резолвится по имени.
import { eq } from '../../packages/db/node_modules/drizzle-orm/index.js';
import { accessActorContext, lockAccessChanges } from '../../packages/db/src/access.ts';
import { hashPassword } from '../../packages/db/src/admin.ts';
import { factorKeys } from '../../packages/db/src/auth-factor-crypto.ts';
import { authFactors } from '../../packages/db/src/auth-factor-schema.ts';
import { account, createDb, user } from '../../packages/db/src/index.ts';
import { retryTransaction } from '../../packages/db/src/transaction.ts';

const [memberEmail, memberName, passwordFile, keyFile, totpFile, ownerEmail] = process.argv.slice(2);
const url = process.env.GF_DATABASE_URL;
if (!memberEmail || !memberName || !passwordFile || !keyFile || !totpFile || !ownerEmail || !url) throw new Error('seed-auth: не хватает аргументов');

const { db, close } = createDb(url);
try {
  const hash = await hashPassword(readFileSync(passwordFile, 'utf8'));
  await retryTransaction(db, async (tx) => {
    await lockAccessChanges(tx);
    await accessActorContext(tx, { kind: 'operator' }, 'e2e: учётка developer без второго фактора');
    const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.email, memberEmail));
    if (taken) return;
    const id = randomBytes(24).toString('base64url');
    await tx.insert(user).values({ id, email: memberEmail, name: memberName, emailVerified: true, role: 'developer' });
    await tx.insert(account).values({ id: randomBytes(24).toString('base64url'), accountId: id, providerId: 'credential', userId: id, password: hash });
  });
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, ownerEmail));
  if (!owner) throw new Error('seed-auth: владельца нет');
  const keys = factorKeys([readFileSync(keyFile)]), factorId = randomUUID();
  await db.delete(authFactors).where(eq(authFactors.userId, owner.id));
  await db.insert(authFactors).values({ id: factorId, userId: owner.id, kind: 'totp', state: 'active',
    ...keys.seal(readFileSync(totpFile, 'utf8'), owner.id, factorId), createdAt: new Date() });
} finally {
  await close();
}
