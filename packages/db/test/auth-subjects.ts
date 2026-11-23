// Учётка с паролем без обязательного второго фактора - для тестов механики Better Auth.
// owner и admin одним паролем больше не входят: им сессию выдают только процедуры B.
import { randomBytes } from 'node:crypto';
import { accessActorContext, lockAccessChanges } from '../src/access.ts';
import { hashPassword } from '../src/admin.ts';
import { account, user, type AnyDb } from '../src/index.ts';
import { retryTransaction } from '../src/transaction.ts';

export async function createMember(db: AnyDb, email: string, name: string, password: string,
  role: 'user' | 'developer' = 'developer'): Promise<string> {
  const id = randomBytes(24).toString('base64url'), hash = await hashPassword(password);
  await retryTransaction(db, async (tx) => {
    await lockAccessChanges(tx);
    await accessActorContext(tx, { kind: 'operator' }, 'Тестовая учётка без второго фактора');
    await tx.insert(user).values({ id, email, name, emailVerified: true, role });
    await tx.insert(account).values({ id: randomBytes(24).toString('base64url'), accountId: id, providerId: 'credential', userId: id, password: hash });
  });
  return id;
}
