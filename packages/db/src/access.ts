import { retryTransaction } from './transaction.ts';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { AnyDb } from './index.ts';
import { accessLock, passkey, session, user } from './schema.ts';
import { can, isUserRole, isUserStatus, type UserRole, type UserStatus } from './access-policy.ts';

type AccessDb = Pick<AnyDb, 'select' | 'execute' | 'update'>;
export type AccessActor = { kind: 'operator' } | { kind: 'user'; userId: string };

export async function readUserAccess(db: Pick<AnyDb, 'select'>, userId: string) {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  if (!row || !isUserRole(row.role) || !isUserStatus(row.status)) return null;
  return { ...row, role: row.role, status: row.status };
}

export async function readEmailAccess(db: Pick<AnyDb, 'select'>, email: string) {
  const [row] = await db.select().from(user).where(eq(user.email, email.toLowerCase()));
  return row ?? null;
}

export async function readPasskeyAccess(db: Pick<AnyDb, 'select'>, credentialID: string) {
  const [row] = await db.select({ user, passkey }).from(passkey).innerJoin(user, eq(user.id, passkey.userId))
    .where(and(eq(passkey.credentialID, credentialID), eq(user.status, 'active')));
  return row ?? null;
}

/** Вызывается только в транзакции записи, до захвата строк credentials/session. */
export async function lockAuthAccess(db: Pick<AnyDb, 'select'>, proof: { userId: string; generation: number; sessionId?: string; passkeyId?: string },
  allowExpiredSessionDeletion = false) {
  const [current] = await db.select().from(user).where(eq(user.id, proof.userId)).for('update');
  if (!current || current.status !== 'active' || current.securityGeneration !== proof.generation) return false;
  if (proof.passkeyId) {
    const [key] = await db.select({ id: passkey.id }).from(passkey).where(and(eq(passkey.id, proof.passkeyId), eq(passkey.userId, proof.userId)));
    if (!key) return false;
  }
  if (!proof.sessionId) return true;
  const [original] = await db.select().from(session).where(eq(session.id, proof.sessionId));
  return !!original && original.userId === proof.userId && original.securityGeneration === proof.generation
    && (allowExpiredSessionDeletion || original.expiresAt.getTime() > Date.now());
}

/** Повторная проверка БД не доверяет роли/поколению из cookie или старого getSession. */
export async function readSessionAccess(db: Pick<AnyDb, 'select'>, sessionId: string) {
  const [row] = await db.select({ user }).from(session).innerJoin(user, eq(session.userId, user.id)).where(and(
    eq(session.id, sessionId), eq(user.status, 'active'),
    eq(session.securityGeneration, user.securityGeneration), gt(session.expiresAt, new Date()),
  ));
  if (!row || !isUserRole(row.user.role) || !isUserStatus(row.user.status)) return null;
  return { ...row.user, role: row.user.role, status: row.user.status };
}

export async function lockAccessChanges(db: AccessDb): Promise<void> {
  // UPDATE создаёт конфликт версий и в REPEATABLE READ; одного advisory lock недостаточно.
  const rows = await db.update(accessLock).set({ id: 1 }).where(eq(accessLock.id, 1)).returning();
  if (rows.length !== 1) throw new Error('не готова блокировка изменений доступа');
}

export async function accessActorContext(db: AccessDb, actor: AccessActor, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 1000 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error('нужна причина длиной 1–1000 символов без управляющих знаков');
  }
  if (actor.kind !== 'operator' && actor.kind !== 'user') throw new Error('неизвестный источник изменения доступа');
  await db.execute(sql`select
    set_config('gf.access_actor_kind', ${actor.kind}, true),
    set_config('gf.access_actor_id', ${actor.kind === 'user' ? actor.userId : ''}, true),
    set_config('gf.access_reason', ${trimmed}, true)`);
}

export async function changeUserAccess(db: AnyDb, input: {
  actor: AccessActor; targetUserId: string; role?: UserRole; status?: UserStatus; reason: string;
}) {
  if (input.role === undefined && input.status === undefined) throw new Error('нужно указать роль или статус');
  if (input.role !== undefined && !isUserRole(input.role)) throw new Error('неизвестная роль');
  if (input.status !== undefined && !isUserStatus(input.status)) throw new Error('неизвестный статус');
  return retryTransaction(db, async (tx) => {
    await lockAccessChanges(tx);
    const [target] = await tx.select().from(user).where(eq(user.id, input.targetUserId)).for('update');
    if (!target) throw new Error('учётка не найдена');
    if (input.actor.kind === 'user') {
      const actor = await readUserAccess(tx, input.actor.userId);
      // Новые веб-действия до step-up не подключены; будущий вызывающий проверяет и его.
      const allowed = can(actor, 'roles.assign') || (input.role === undefined && isUserRole(target.role)
        && can(actor, 'users.suspend', { ownerUserId: target.id, ownerRole: target.role }));
      if (!allowed) throw new Error('недостаточно прав для изменения доступа');
    }
    await accessActorContext(tx, input.actor, input.reason);
    const [updated] = await tx.update(user).set({
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.status === undefined ? {} : { status: input.status }),
      updatedAt: new Date(),
    }).where(eq(user.id, target.id)).returning();
    return updated!;
  });
}

/** После миграции все старые учётки — user; первый owner выбирается только явно. */
export async function bootstrapOwner(db: AnyDb, userId: string, reason: string) {
  return retryTransaction(db, async (tx) => {
    await lockAccessChanges(tx);
    const owners = await tx.select({ id: user.id }).from(user).where(eq(user.role, 'owner'));
    if (owners.length) throw new Error('owner уже назначен: используйте изменение доступа');
    await accessActorContext(tx, { kind: 'operator' }, reason);
    const [updated] = await tx.update(user).set({ role: 'owner', status: 'active', updatedAt: new Date() })
      .where(eq(user.id, userId)).returning();
    if (!updated) throw new Error('учётка не найдена');
    return updated;
  });
}
