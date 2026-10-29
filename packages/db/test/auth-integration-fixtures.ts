// Этот модуль импортирует только harness; никогда не входит в хаб/standalone.
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { account, authActions, authMailCounters, authMailKeys, authMailOperations, authMailStore,
  authRecoveryGuards, gameSaves, passkey, schema, scores, session, user } from '../src/index.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { ensureHubRole } from '../src/roles.ts';
import { hashPassword } from '../src/admin.ts';
import { requireCheck, testDatabaseUrl } from '../../../tests/auth-a/guards.ts';

export async function integrationDatabase(raw: string, key: Buffer, origin: string) {
  const ownerUrl = testDatabaseUrl(raw);
  const owner = postgres(ownerUrl, { max: 2, onnotice() {}, connect_timeout: 3 });
  const observer = postgres(ownerUrl, { max: 1, onnotice() {}, connect_timeout: 3 });
  const db = drizzle(owner, { schema }), second = drizzle(observer, { schema });
  try {
    // Не допускаем повторного применения к заполненной базе под тем же именем.
    const tables = await owner`select 1 from information_schema.tables where table_schema='public' limit 1`;
    requireCheck(tables.length === 0, 'интеграционной проверке нужна пустая отдельная БД');
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const hubPassword = randomBytes(24).toString('base64url');
    await ensureHubRole(db, hubPassword);
    const hubUrl = new URL(ownerUrl); hubUrl.username = 'gf_hub'; hubUrl.password = hubPassword;
    const hub = postgres(hubUrl.href, { max: 1, onnotice() {}, connect_timeout: 3 });
    try {
      const [identity] = await hub`select current_user as name`;
      requireCheck(identity?.name === 'gf_hub', 'Next должен подключаться как gf_hub');
    } finally { await hub.end({ timeout: 2 }); }
    const keys = authMailKeys([key]);
    return {
      hubUrl: hubUrl.href,
      keys,
      async close() { await Promise.all([owner.end({ timeout: 2 }), observer.end({ timeout: 2 })]); },
      async clear() {
        // Пользователи сохраняются: последний owner защищён и в тестовой БД.
        await db.delete(authMailOperations); await db.delete(authActions); await db.delete(authMailCounters);
      },
      async fixture(options: { role?: 'user' | 'developer' | 'admin' | 'owner'; guard?: boolean; verified?: boolean } = {}) {
        const id = randomUUID(), email = `${id}@example.test`, password = randomBytes(24).toString('base64url');
        await db.insert(user).values({ id, name: 'Искусственный игрок', email, role: options.role ?? 'user', emailVerified: options.verified ?? false });
        const credentialHash = await hashPassword(password);
        await db.insert(account).values({ id, userId: id, accountId: id, providerId: 'credential', password: credentialHash });
        if (options.guard) await db.insert(authRecoveryGuards).values({ userId: id });
        await db.insert(gameSaves).values({ userId: id, gameId: 'fixture-game', key: 'progress', value: '{"level":3}' });
        await db.insert(scores).values({ userId: id, gameId: 'fixture-game', score: 42 });
        return { id, email, password, credentialHash };
      },
      async seed(email: string, purpose: 'verify' | 'reset') {
        const intent = keys.intent();
        await authMailStore(db, keys, origin).request({ email, purpose, intent, browser: randomUUID(), ip: randomUUID() });
        const rows = await db.select().from(authMailOperations).where(eq(authMailOperations.intentKey, keys.digest('intent', intent)));
        requireCheck(rows.length === 1 && rows[0]!.state === 'pending', 'fixture pending не создана');
        return rows[0]!;
      },
      async committed(body: string, expiresAt: number) {
        const parsed = JSON.parse(body) as { operationId: string; kind: string };
        const [row] = await second.select().from(authMailOperations).where(eq(authMailOperations.id, parsed.operationId));
        requireCheck(row?.state === 'started' && row.ciphertext && row.startedAt && row.actionId, 'нет committed prepared перед HTTP');
        const aad = JSON.stringify([row.id, row.purpose, row.createdAt.getTime(), row.profile, 'prepared']);
        const prepared = keys.open(row.ciphertext, row.keyId, aad) as { body: string; createdAt: number };
        requireCheck(prepared.body === body && prepared.createdAt === row.createdAt.getTime() &&
          expiresAt === prepared.createdAt + 86_400_000, 'сохранённый prepared отличается от HTTP');
      },
      async operation(id: string) { return (await db.select().from(authMailOperations).where(eq(authMailOperations.id, id)))[0]; },
      async operations() { return db.select().from(authMailOperations); },
      async action(id: string) { return (await db.select().from(authActions).where(eq(authActions.id, id)))[0]; },
      async member(id: string) { return (await db.select().from(user).where(eq(user.id, id)))[0]!; },
      async expired(id: string) { await db.update(authActions).set({ expiresAt: new Date(0) }).where(eq(authActions.id, id)); },
      async revoked(id: string) { await db.update(authActions).set({ revokedAt: new Date() }).where(eq(authActions.id, id)); },
      async stale(id: string) { await db.update(authMailOperations).set({ startedAt: new Date(Date.now() - 61_000) }).where(eq(authMailOperations.id, id)); },
      async strengthen(id: string, kind: 'admin' | 'owner' | 'guard') {
        if (kind === 'guard') await db.insert(authRecoveryGuards).values({ userId: id });
        else await db.update(user).set({ role: kind }).where(eq(user.id, id));
      },
      async oldCredentials(id: string) {
        const value = randomUUID();
        await db.insert(session).values({ id: value, token: value, userId: id, expiresAt: new Date(Date.now() + 3600_000) });
        await db.insert(passkey).values({ id: value, userId: id, publicKey: 'synthetic-unused-key', credentialID: value,
          counter: 0, deviceType: 'singleDevice', backedUp: false });
      },
      async credentialsGone(id: string) {
        return (await db.select().from(session).where(eq(session.userId, id))).length === 0 &&
          (await db.select().from(passkey).where(eq(passkey.userId, id))).length === 0;
      },
      async passwordUnchanged(fixture: { id: string; credentialHash: string }) {
        return (await db.select().from(account).where(eq(account.userId, fixture.id)))[0]?.password === fixture.credentialHash;
      },
      async gameDataIntact(id: string) {
        const [save] = await db.select().from(gameSaves).where(eq(gameSaves.userId, id));
        const [score] = await db.select().from(scores).where(eq(scores.userId, id));
        return save?.value === '{"level":3}' && score?.score === 42;
      },
      async fingerprint() {
        // Только сравнение в памяти; содержимое не попадает в сообщения assert.
        return JSON.stringify(await owner`select (select coalesce(jsonb_agg(t order by id),'[]') from auth_actions t) as actions,
          (select coalesce(jsonb_agg(t order by id),'[]') from auth_mail_operations t) as operations,
          (select coalesce(jsonb_agg(t order by id),'[]') from "user" t) as users`);
      },
    };
  } catch {
    await Promise.all([owner.end({ timeout: 2 }), observer.end({ timeout: 2 })]);
    throw new Error('подготовка отдельной БД не выполнена');
  }
}
export type IntegrationDatabase = Awaited<ReturnType<typeof integrationDatabase>>;
export type Fixture = Awaited<ReturnType<IntegrationDatabase['fixture']>>;
