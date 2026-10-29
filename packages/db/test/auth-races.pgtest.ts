import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { BetterAuthPlugin } from '../../../apps/hub/node_modules/better-auth/dist/index.mjs';
import { createHubAuth, SESSION_COOKIE } from '../../../apps/hub/src/lib/auth-core.ts';
import { createOwner, setPassword } from '../src/admin.ts';
import { schema, session, passkey, account, retryTransaction, user } from '../src/index.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { authenticator, barrier, cookies, pauseAdapter, pausePassword } from './auth-race-fixtures.ts';

const client = new PGlite();
const db = drizzle(client, { schema });
const origin = 'https://hub.example';
const password = 'Исходный тестовый пароль для временной БД';
const replacement = 'Новый пароль оператора для временной БД';
before(() => migrate(db, { migrationsFolder: MIGRATIONS_DIR }));
after(() => client.close());

const fixtureIps = new WeakMap<object, string>();
let fixtureNumber = 0;
function service(plugin?: BetterAuthPlugin) {
  const auth = createHubAuth(db, origin, 'temporary-race-test-secret-012345678901234567890123456789', plugin ? [plugin] : []);
  // В isolation=none memory limiter библиотеки общий; независимые сценарии имеют разные IP.
  fixtureIps.set(auth, `192.0.2.${++fixtureNumber}`);
  return auth;
}

async function request(auth: ReturnType<typeof service>, path: string, body?: Record<string, unknown>, cookie = '') {
  return auth.handler(new Request(`${origin}/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { origin, 'content-type': 'application/json', 'x-real-ip': fixtureIps.get(auth)!, cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}

test('F1: вход со старым хешем после аварийного сброса не создаёт сессию', { timeout: 20_000 }, async () => {
  const email = 'race-login@example.test';
  const id = await createOwner(db, email, 'Гонка входа', password);
  const gate = barrier();
  const auth = service(pausePassword('/sign-in/email', gate));
  const inflight = request(auth, 'sign-in/email', { email, password });
  await Promise.race([gate.entered, inflight.then(async (response) => {
    throw new Error(`запрос завершился до барьера: ${response.status} ${await response.text()}`);
  })]);
  try { await setPassword(db, email, replacement); } finally { gate.release(); }
  const response = await inflight;
  assert.notEqual(response.status, 200, 'старое доказательство входа не получает новое поколение');
  assert.equal((await db.select().from(session).where(eq(session.userId, id))).length, 0);
  assert.equal(response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`)), false);
});

test('F2: начатая смена пароля не перезаписывает пароль аварийного сброса', { timeout: 20_000 }, async () => {
  const email = 'race-password@example.test';
  const id = await createOwner(db, email, 'Гонка пароля', password);
  const gate = barrier();
  const auth = service(pausePassword('/change-password', gate));
  const login = await request(auth, 'sign-in/email', { email, password });
  assert.equal(login.status, 200);
  const inflight = request(auth, 'change-password', { currentPassword: password,
    newPassword: 'Пароль атакующего только для временной БД' }, cookies(login));
  await Promise.race([gate.entered, inflight.then(async (response) => {
    throw new Error(`запрос завершился до барьера: ${response.status} ${await response.text()}`);
  })]);
  try { await setPassword(db, email, replacement); } finally { gate.release(); }
  const response = await inflight;
  assert.notEqual(response.status, 200);
  assert.equal((await request(auth, 'sign-in/email', { email, password: replacement })).status, 200);
  assert.notEqual((await request(auth, 'sign-in/email', { email, password: 'Пароль атакующего только для временной БД' })).status, 200);
  assert.equal((await db.select().from(account).where(eq(account.userId, id))).length, 1);
});

test('F1: прочитанный перед сбросом passkey не создаёт новую сессию', { timeout: 20_000 }, async () => {
  const email = 'race-passkey-login@example.test';
  const id = await createOwner(db, email, 'Гонка ключа', password);
  const key = authenticator();
  await db.insert(passkey).values({ id: 'race-key', userId: id, credentialID: key.id,
    publicKey: key.publicKey.toString('base64'), counter: 0, deviceType: 'singleDevice', backedUp: false });
  const gate = barrier();
  const auth = service(pauseAdapter('/passkey/verify-authentication', 'findOne', gate));
  const options = await request(auth, 'passkey/generate-authenticate-options');
  assert.equal(options.status, 200);
  const { challenge } = await options.json();
  const inflight = request(auth, 'passkey/verify-authentication', { response: key.authentication(challenge) }, cookies(options));
  await Promise.race([gate.entered, inflight.then(async (response) => {
    throw new Error(`запрос завершился до барьера: ${response.status} ${await response.text()}`);
  })]);
  try { await setPassword(db, email, replacement); } finally { gate.release(); }
  assert.notEqual((await inflight).status, 200);
  assert.equal((await db.select().from(session).where(eq(session.userId, id))).length, 0);
});

test('F2: регистрация passkey после сброса не сохраняет новый ключ', { timeout: 20_000 }, async () => {
  const email = 'race-passkey-register@example.test';
  const id = await createOwner(db, email, 'Гонка регистрации', password);
  const key = authenticator();
  const gate = barrier();
  const auth = service(pauseAdapter('/passkey/verify-registration', 'create', gate));
  const login = await request(auth, 'sign-in/email', { email, password });
  assert.equal(login.status, 200);
  const options = await request(auth, 'passkey/generate-register-options', undefined, cookies(login));
  assert.equal(options.status, 200);
  const { challenge } = await options.json();
  const inflight = request(auth, 'passkey/verify-registration', { response: key.registration(challenge) }, `${cookies(login)}; ${cookies(options)}`);
  await Promise.race([gate.entered, inflight.then(async (response) => {
    throw new Error(`запрос завершился до барьера: ${response.status} ${await response.text()}`);
  })]);
  try { await setPassword(db, email, replacement); } finally { gate.release(); }
  assert.notEqual((await inflight).status, 200);
  assert.equal((await db.select().from(passkey).where(eq(passkey.userId, id))).length, 0);
});

test('штатные регистрация/вход passkey, server API и refresh сохраняют работу', async () => {
  const email = 'normal-passkey@example.test';
  const id = await createOwner(db, email, 'Штатный ключ', password);
  const auth = service();
  const login = await request(auth, 'sign-in/email', { email, password });
  assert.equal(login.status, 200);
  const key = authenticator();
  const options = await request(auth, 'passkey/generate-register-options', undefined, cookies(login));
  const { challenge } = await options.json();
  const registration = await request(auth, 'passkey/verify-registration', {
    response: key.registration(challenge), createSession: true,
  }, `${cookies(login)}; ${cookies(options)}`);
  assert.equal(registration.status, 200, await registration.text());
  assert.equal((await db.select().from(passkey).where(eq(passkey.userId, id))).length, 1);
  const authenticationOptions = await request(auth, 'passkey/generate-authenticate-options');
  const authentication = await request(auth, 'passkey/verify-authentication', {
    response: key.authentication((await authenticationOptions.json()).challenge),
  }, cookies(authenticationOptions));
  assert.equal(authentication.status, 200);
  const cookie = cookies(authentication);
  const current = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(current?.user.id, id);
  await db.update(session).set({ expiresAt: new Date(Date.now() + 86_400_000) }).where(eq(session.id, current!.session.id));
  const refreshed = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.ok(refreshed!.session.expiresAt.getTime() > Date.now() + 86_400_000);
  assert.equal((await request(auth, 'sign-out', {}, cookie)).status, 200);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie }) }), null);
  const fresh = await request(auth, 'sign-in/email', { email, password });
  assert.equal(fresh.status, 200);
  const expiredCookie = cookies(fresh);
  const expiring = await auth.api.getSession({ headers: new Headers({ cookie: expiredCookie }) });
  await db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.id, expiring!.session.id));
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: expiredCookie }) }), null);
});

test('штатная смена пароля с revokeOtherSessions выпускает новую сессию', async () => {
  const email = 'normal-password@example.test';
  await createOwner(db, email, 'Штатная смена', password);
  const auth = service();
  const login = await request(auth, 'sign-in/email', { email, password });
  assert.equal(login.status, 200);
  const changed = await request(auth, 'change-password', {
    currentPassword: password, newPassword: replacement, revokeOtherSessions: true,
  }, cookies(login));
  assert.equal(changed.status, 200, await changed.text());
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: cookies(login) }) }), null);
  assert.ok(await auth.api.getSession({ headers: new Headers({ cookie: cookies(changed) }) }));
});

test('40P01/40001 повторяют всю транзакцию, с пределом и без сохранения отменённых записей', async () => {
  for (const code of ['40P01', '40001']) {
    let attempts = 0;
    await retryTransaction(db, async (tx) => {
      attempts++;
      await tx.insert(user).values({ id: `retry-${code}`, name: 'Повтор', email: `retry-${code}@example.test` });
      if (attempts < 3) await tx.execute(sql.raw(`do $$ begin raise exception 'test conflict' using errcode='${code}'; end $$`));
    });
    assert.equal(attempts, 3);
    assert.equal((await db.select().from(user).where(eq(user.id, `retry-${code}`))).length, 1);
  }
  let attempts = 0;
  await assert.rejects(retryTransaction(db, async (tx) => {
    attempts++;
    await tx.insert(user).values({ id: 'retry-limit', name: 'Предел', email: 'retry-limit@example.test' });
    await tx.execute(sql.raw("do $$ begin raise exception 'test conflict' using errcode='40001'; end $$"));
  }));
  assert.equal(attempts, 3);
  assert.equal((await db.select().from(user).where(eq(user.id, 'retry-limit'))).length, 0);
  attempts = 0;
  await assert.rejects(retryTransaction(db, async () => { attempts++; throw new Error('не конфликт транзакций'); }));
  assert.equal(attempts, 1);
});
