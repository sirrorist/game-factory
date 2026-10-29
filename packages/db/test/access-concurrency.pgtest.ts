// Только собственный временный кластер. URL рабочей/внешней БД здесь не принимается.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { accessEvents, changeUserAccess, lockAccessChanges, retryTransaction, schema, session, user, passkey, type Db, type AnyDb } from '../src/index.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { createOwner, setPassword } from '../src/admin.ts';
import { ensureHubRole, HUB_ROLE } from '../src/roles.ts';
import { createHubAuth } from '../../../apps/hub/src/lib/auth-core.ts';
import type { BetterAuthPlugin } from '../../../apps/hub/node_modules/better-auth/dist/index.mjs';
import { authenticator, barrier, cookies, pauseAdapter, pausePassword } from './auth-race-fixtures.ts';

// Например: GF_TEST_PG_BIN=/usr/lib/postgresql/17/bin node --test <этот файл>.
const bin = process.env.GF_TEST_PG_BIN;
const clients: ReturnType<typeof postgres>[] = [];
let server: ChildProcess | undefined;
let first: Db;
let second: Db;
let secondPid: number;
let socketPath: string;

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function observe(connection: AnyDb, codes: string[]): AnyDb {
  return new Proxy(connection, { get(target, key) {
    if (key === 'transaction') return async (...args: unknown[]) => {
      try { return await Reflect.apply(target.transaction, target, args); }
      catch (error) {
        let cause: unknown = error;
        while (cause && typeof cause === 'object') {
          if ('code' in cause && typeof cause.code === 'string') { codes.push(cause.code); break; }
          cause = 'cause' in cause ? cause.cause : undefined;
        }
        throw error;
      }
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

before(async () => {
  if (!bin) return;
  const root = mkdtempSync(join(tmpdir(), 'gf-access-native-pg-'));
  const socket = join(root, 'socket');
  socketPath = socket;
  mkdirSync(socket);
  execFileSync(join(bin, 'initdb'), ['-D', join(root, 'data'), '-A', 'trust', '-U', 'gf_test', '--no-locale'], { timeout: 15_000, stdio: 'pipe' });
  const logPath = join(root, 'postgres.log');
  const log = openSync(logPath, 'w', 0o600);
  server = spawn(join(bin, 'postgres'), ['-D', join(root, 'data'), '-k', socket, '-p', '5444',
    '-c', 'listen_addresses=', '-c', 'shared_buffers=16MB', '-c', 'max_connections=6'], { stdio: ['ignore', log, log] });
  closeSync(log);
  // Две независимые backend-сессии, без чтения окружения подключения приложения.
  for (let i = 0; i < 2; i++) clients.push(postgres({ host: socket, port: 5444, user: 'gf_test', database: 'postgres',
    max: 1, connect_timeout: 1, onnotice: () => {} }));
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { await clients[0]!`select 1`; ready = true; break; } catch { await delay(100); }
  }
  assert.ok(ready, `временный PostgreSQL должен запуститься: ${readFileSync(logPath, 'utf8')}`);
  first = drizzle(clients[0]!, { schema }); second = drizzle(clients[1]!, { schema });
  await migrate(first, { migrationsFolder: MIGRATIONS_DIR });
  secondPid = (await clients[1]!<{ pid: number }[]>`select pg_backend_pid() as pid`)[0]!.pid;
});

after(async () => {
  await Promise.all(clients.map((c) => c.end({ timeout: 1 })));
  if (server && server.exitCode === null) {
    const exited = new Promise<void>((resolve) => server!.once('exit', () => resolve()));
    server.kill('SIGTERM'); await exited;
  }
});

for (const isolationLevel of ['read committed', 'repeatable read'] as const) {
  const config = { isolationLevel };
  const suffix = isolationLevel.replaceAll(' ', '-');
  const options = { skip: !bin && 'нужны локальные initdb/postgres и GF_TEST_PG_BIN; PGlite не заменяет два backend', timeout: 15_000 };

  test(`F3: прямой refresh и отзыв без session→user цикла (${isolationLevel})`, options, async () => {
    const id = `refresh-${suffix}`;
    await first.insert(user).values({ id, email: `${id}@example.test`, name: id });
    await first.insert(session).values({ id, userId: id, token: id, expiresAt: new Date(Date.now() + 60_000) });
    const sessionLocked = signal(); const userLocked = signal();
    const codes: string[] = [];
    const refresh = retryTransaction(observe(first, codes), async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      await tx.select().from(session).where(eq(session.id, id)).for('update');
      sessionLocked.resolve(); await userLocked.promise;
      await tx.update(session).set({ updatedAt: new Date() }).where(eq(session.id, id));
    }, config);
    const revoke = retryTransaction(observe(second, codes), async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      await sessionLocked.promise;
      await lockAccessChanges(tx);
      await tx.select().from(user).where(eq(user.id, id)).for('update');
      userLocked.resolve();
      await tx.update(user).set({ securityGeneration: sql`${user.securityGeneration} + 1` }).where(eq(user.id, id));
    }, config);
    const result = await Promise.allSettled([refresh, revoke]);
    for (const r of result) assert.equal(r.status, 'fulfilled', r.status === 'rejected' ? String(r.reason) : '');
    assert.equal(codes.includes('40P01'), false, 'повтор не должен скрывать обратный порядок блокировок');
    assert.equal((await first.select().from(session).where(eq(session.id, id))).length, 0);
  });

  test(`F3: оператор и прямой UPDATE user берут access_lock первыми (${isolationLevel})`, options, async () => {
    const id = `direct-${suffix}`;
    await first.insert(user).values({ id, email: `${id}@example.test`, name: id });
    const locked = signal();
    const codes: string[] = [];
    const operator = retryTransaction(observe(first, codes), async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      await lockAccessChanges(tx); locked.resolve();
      // Барьер подтверждает, что второй backend уже ждёт блокировку этого statement.
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        await tx.execute(sql`select pg_stat_clear_snapshot()`);
        const activity = await tx.select({ wait: sql<string>`wait_event_type` }).from(sql`pg_stat_activity`).where(sql`pid = ${secondPid}`);
        if (activity[0]?.wait === 'Lock') { waiting = true; break; }
        await delay(10);
      }
      assert.ok(waiting, 'прямой UPDATE должен дойти до ожидаемой блокировки');
      await tx.select().from(user).where(eq(user.id, id)).for('update');
      await tx.update(user).set({ securityGeneration: sql`${user.securityGeneration} + 1` }).where(eq(user.id, id));
    }, config);
    const direct = retryTransaction(observe(second, codes), async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      await locked.promise;
      await tx.update(user).set({ status: 'suspended' }).where(eq(user.id, id));
    }, config);
    const result = await Promise.allSettled([operator, direct]);
    for (const r of result) assert.equal(r.status, 'fulfilled', r.status === 'rejected' ? String(r.reason) : '');
    assert.equal(codes.includes('40P01'), false, 'повтор не должен скрывать обратный порядок блокировок');
    const [current] = await first.select().from(user).where(eq(user.id, id));
    assert.equal(current?.status, 'suspended');
    assert.equal(current?.securityGeneration, 2);
  });
}

// Оба снимка создаются до попытки сериализации, также на первой попытке RR.
for (const isolationLevel of ['read committed', 'repeatable read'] as const) {
  test(`последний active owner при двух переходах (${isolationLevel})`, { skip: !bin, timeout: 15_000 }, async () => {
    const suffix = isolationLevel.replaceAll(' ', '-');
    const ids = [`owner-a-${suffix}`, `owner-b-${suffix}`];
    await first.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@example.test`, role: 'owner' })));
    // Предыдущий сценарий оставляет одного owner; новые два позволяют убрать его из состава.
    await first.update(user).set({ role: 'user' }).where(sql`${user.role} = 'owner' and ${user.id} not in (${ids[0]}, ${ids[1]})`);
    const ready = signal(); let snapshots = 0;
    const codes: string[] = [];
    function synchronized(connection: AnyDb): AnyDb {
      const tracked = observe(connection, codes);
      return new Proxy(tracked, { get(target, key) {
        if (key === 'transaction') return <T>(fn: (tx: AnyDb) => Promise<T>) => target.transaction(async (tx) => {
          await tx.execute(sql`set local statement_timeout = '5s'`);
          await tx.select({ id: user.id }).from(user).where(eq(user.role, 'owner'));
          if (++snapshots >= 2) ready.resolve();
          await ready.promise;
          return fn(tx);
        }, { isolationLevel });
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
    const attempts = await Promise.allSettled([first, second].map((connection, i) => changeUserAccess(synchronized(connection), {
      actor: { kind: 'operator' }, targetUserId: ids[i]!, role: 'user', reason: 'Конкурентная проверка последнего owner',
    })));
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    const denied = attempts.find((r) => r.status === 'rejected');
    assert.ok(denied?.status === 'rejected');
    const error = denied.reason instanceof Error && denied.reason.cause instanceof Error ? denied.reason.cause : denied.reason;
    assert.match(String(error), /последнего активного owner/);
    assert.equal((await first.select().from(user).where(sql`${user.role} = 'owner' and ${user.status} = 'active'`)).length, 1);
    assert.equal(codes.includes('40P01'), false);
    if (isolationLevel === 'repeatable read') assert.ok(codes.includes('40001'), 'старый snapshot должен вызвать полный повтор');
  });
}

const origin = 'https://hub.example';
const password = 'Тестовый пароль только для отдельного PostgreSQL';
const replacement = 'Новый пароль оператора для отдельного PostgreSQL';
let nextIp = 200;
const fixtureIps = new WeakMap<object, string>();
function auth(db: AnyDb, plugin?: BetterAuthPlugin) {
  const service = createHubAuth(db, origin, 'temporary-native-pg-auth-secret-012345678901234567890123456789', plugin ? [plugin] : []);
  fixtureIps.set(service, `192.0.2.${nextIp++}`);
  return service;
}
function request(service: ReturnType<typeof auth>, path: string, body?: Record<string, unknown>, cookie = '') {
  return service.handler(new Request(`${origin}/api/auth/${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', cookie, 'x-real-ip': fixtureIps.get(service)! },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? errorCode(error.cause) : undefined;
}

test('отдельное подключение gf_hub: права SQL, F4 и штатный auth', { skip: !bin, timeout: 15_000 }, async () => {
  await ensureHubRole(first, 'only-native-test-role-password');
  const hub = postgres({ host: socketPath, port: 5444, user: HUB_ROLE, database: 'postgres', max: 1, connect_timeout: 1, onnotice: () => {} });
  clients.push(hub);
  const hubDb = drizzle(hub, { schema });
  const [identity] = await hub`select session_user, current_user, pg_backend_pid() as pid`;
  assert.equal(identity!.session_user, HUB_ROLE);
  assert.equal(identity!.current_user, HUB_ROLE);
  assert.notEqual(identity!.pid, secondPid);
  const [owner] = await first.select({ name: sql<string>`pg_get_userbyid(relowner)` }).from(sql`pg_class`)
    .where(sql`oid = 'public.access_events'::regclass`);
  await assert.rejects(hubDb.execute(sql`set role ${sql.identifier(owner!.name)}`), (error) => errorCode(error) === '42501');
  await hubDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('gf.access_actor_kind', 'operator', true),
      set_config('gf.access_actor_id', 'forged-owner', true), set_config('gf.access_reason', 'Подставленная причина', true)`);
    await tx.insert(user).values({ id: 'native-hub-user', name: 'Тест', email: 'native-hub-user@example.test' });
    const [event] = await tx.select().from(accessEvents).where(eq(accessEvents.targetUserId, 'native-hub-user'));
    assert.equal(event!.actorKind, 'system'); assert.equal(event!.actorId, null);
    assert.equal(event!.reason, 'Изменение через подключение БД');
  });
  await hubDb.update(user).set({ name: 'Профиль' }).where(eq(user.id, 'native-hub-user'));
  await assert.rejects(hubDb.update(user).set({ role: 'owner' }).where(eq(user.id, 'native-hub-user')), (error) => errorCode(error) === '42501');
  await assert.rejects(hubDb.delete(user).where(eq(user.id, 'native-hub-user')), (error) => errorCode(error) === '42501');
  await assert.rejects(hubDb.insert(user).values({ id: 'native-hub-forged-owner', name: 'Тест', email: 'native-hub-forged-owner@example.test', role: 'owner' }),
    (error) => errorCode(error) === '23514');
  await assert.rejects(hubDb.insert(accessEvents).values({ actorKind: 'operator', targetUserId: 'native-hub-user',
    action: 'forged', securityGeneration: 0, reason: 'Подмена' }), (error) => errorCode(error) === '42501');
  await assert.rejects(hubDb.delete(accessEvents), (error) => errorCode(error) === '42501');
  const email = 'native-hub-login@example.test';
  await createOwner(first, email, 'Вход', password);
  const service = auth(hubDb);
  const login = await request(service, 'sign-in/email', { email, password });
  assert.equal(login.status, 200, await login.clone().text());
  assert.equal((await request(service, 'update-user', { name: 'Новый профиль' }, cookies(login))).status, 200);
});

test('F2: passkey createSession=true через transaction callback после сброса отклоняется', { skip: !bin, timeout: 15_000 }, async () => {
  const email = 'native-passkey-race@example.test';
  const id = await createOwner(second, email, 'Гонка callback', password);
  const gate = barrier(); const key = authenticator(); let throughTransaction = false;
  const service = auth(first, pauseAdapter('/passkey/verify-registration', 'create', gate, (inside) => { throughTransaction = inside; }));
  const login = await request(service, 'sign-in/email', { email, password });
  assert.equal(login.status, 200);
  const options = await request(service, 'passkey/generate-register-options', undefined, cookies(login));
  assert.equal(options.status, 200);
  const inflight = request(service, 'passkey/verify-registration', {
    response: key.registration((await options.json()).challenge), createSession: true,
  }, `${cookies(login)}; ${cookies(options)}`);
  await Promise.race([gate.entered, inflight.then(async (response) => {
    throw new Error(`запрос завершился до барьера: ${response.status} ${await response.text()}`);
  })]);
  try {
    assert.equal(throughTransaction, true, 'барьер должен стоять внутри настоящего callback транзакции');
    await setPassword(second, email, replacement);
  } finally { gate.release(); }
  assert.equal((await inflight).status, 401);
  assert.equal((await second.select().from(passkey).where(eq(passkey.userId, id))).length, 0);
  assert.equal((await second.select().from(session).where(eq(session.userId, id))).length, 0);
});

test('F2: server API changePassword после сброса не перезаписывает пароль оператора', { skip: !bin, timeout: 15_000 }, async () => {
  const email = 'native-api-race@example.test';
  const id = await createOwner(second, email, 'Гонка server API', password);
  const gate = barrier();
  const service = auth(first, pausePassword('/change-password', gate));
  const login = await request(service, 'sign-in/email', { email, password });
  assert.equal(login.status, 200);
  const attackerPassword = 'Другой тестовый пароль из начатого server API';
  const inflight = service.api.changePassword({ headers: new Headers({ origin, cookie: cookies(login) }),
    body: { currentPassword: password, newPassword: attackerPassword } })
    .then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  await Promise.race([gate.entered, inflight.then(() => { throw new Error('API завершился до барьера'); })]);
  try { await setPassword(second, email, replacement); } finally { gate.release(); }
  const result = await inflight;
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error instanceof Error && /доступ изменён/.test(result.error.message));
  assert.equal((await second.select().from(session).where(eq(session.userId, id))).length, 0);
  assert.equal((await request(service, 'sign-in/email', { email, password: replacement })).status, 200);
  assert.equal((await request(service, 'sign-in/email', { email, password: attackerPassword })).status, 401);
});

// Закрытый A: новые функции испытываются теми же независимыми backend, без рабочей БД.
async function authActionFixture(purpose: 'verify' | 'reset' = 'reset') {
  const { randomBytes, randomUUID } = await import('node:crypto');
  const { account, authActions, tokenHash } = await import('../src/index.ts');
  const id = `action-${randomUUID()}`, token = randomBytes(32).toString('base64url');
  await first.insert(user).values({ id, name: id, email: `${id}@example.test` });
  await first.insert(account).values({ id, userId: id, accountId: id, providerId: 'credential', password: await (await import('../src/admin.ts')).hashPassword('Synthetic original password') });
  await first.insert(authActions).values({ id, tokenHash: tokenHash(token), purpose, userId: id, email: `${id}@example.test`,
    generation: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
  return { id, token };
}
for (const isolationLevel of ['read committed', 'repeatable read'] as const) {
  const options = { skip: !bin && 'нужен временный PostgreSQL', timeout: 15_000 };
  const { consumeAuthAction, authMailKeys, authMailStore } = await import('../src/index.ts');
  const { hashPassword } = await import('../src/admin.ts');
  function isolated(connection: AnyDb): AnyDb {
    return new Proxy(connection, { get(target, key) {
      if (key === 'transaction') return (fn: Parameters<AnyDb['transaction']>[0]) => connection.transaction(fn, { isolationLevel });
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  test(`A: два потребления одного bearer дают один успех (${isolationLevel})`, options, async () => {
    const { token } = await authActionFixture();
    const passwordHash = await hashPassword('Synthetic replacement password');
    const outcomes = await Promise.all([first, second].map(db => consumeAuthAction(isolated(db), { token, purpose: 'reset', passwordHash })));
    assert.deepEqual(outcomes.sort(), ['invalid', 'ok']);
  });
  test(`A: CLI завершает отзыв раньше начатого consume (${isolationLevel})`, options, async () => {
    const { id, token } = await authActionFixture();
    const passwordHash = await hashPassword('Synthetic attacker password');
    let blocked: Promise<unknown> | undefined;
    await first.transaction(async tx => {
      await lockAccessChanges(tx);
      blocked = consumeAuthAction(isolated(second), { token, purpose: 'reset', passwordHash });
      let waiting = false;
      for (let n=0;n<100;n++) {
        const status = await tx.execute(sql`select wait_event_type from pg_stat_activity where pid=${secondPid}`);
        if ((status as unknown as {wait_event_type:string}[])[0]?.wait_event_type === 'Lock') { waiting=true; break; }
        await delay(5);
      }
      assert.ok(waiting, 'второй backend должен действительно ждать access_lock');
      const within = new Proxy(first, { get(target, key) {
        if (key === 'transaction') return (fn: Parameters<AnyDb['transaction']>[0]) => fn(tx);
        const value=Reflect.get(target,key); return typeof value==='function'?value.bind(target):value;
      } });
      await setPassword(within, `${id}@example.test`, 'Synthetic operator password');
    });
    assert.equal(await blocked, 'invalid');
    const { account } = await import('../src/index.ts');
    assert.notEqual((await first.select().from(account).where(eq(account.userId,id)))[0]?.password,passwordHash);
  });
  test(`A: несколько диспетчеров захватывают запись только один раз (${isolationLevel})`, options, async () => {
    const { randomUUID } = await import('node:crypto');
    const { authMailOperations } = await import('../src/index.ts');
    await first.delete(authMailOperations);
    const { id } = await authActionFixture('verify');
    const keys = authMailKeys([Buffer.alloc(32, 23)]);
    const a=authMailStore(isolated(first),keys,'https://hub.example'), b=authMailStore(isolated(second),keys,'https://hub.example');
    await a.request({email:`${id}@example.test`,purpose:'verify',intent:randomUUID(),browser:randomUUID(),ip:randomUUID()});
    const claims=await Promise.all([a.claim(),b.claim()]);
    assert.equal(claims.filter(Boolean).length,1);
    assert.equal((await first.select().from(authMailOperations))[0]?.state,'started');
  });
}

test('A/F1: начатый парольный вход не переживает почтовый reset', {skip:!bin,timeout:15_000}, async()=>{
  const {consumeAuthAction}=await import('../src/index.ts');const {hashPassword}=await import('../src/admin.ts');
  const {id,token}=await authActionFixture(), gate=barrier();
  const service=auth(first,pausePassword('/sign-in/email',gate));
  const inflight=request(service,'sign-in/email',{email:`${id}@example.test`,password:'Synthetic original password'});
  await Promise.race([gate.entered,inflight.then(()=>{throw new Error('вход завершился до барьера');})]);
  try {assert.equal(await consumeAuthAction(second,{token,purpose:'reset',passwordHash:await hashPassword(replacement)}),'ok');}
  finally {gate.release();}
  assert.equal((await inflight).status,401);
  assert.equal((await second.select().from(session).where(eq(session.userId,id))).length,0);
  assert.equal((await request(auth(second),'sign-in/email',{email:`${id}@example.test`,password:replacement})).status,200);
});
test('A/F2: начатая смена пароля server API не перезаписывает почтовый reset', {skip:!bin,timeout:15_000}, async()=>{
  const {consumeAuthAction,account}=await import('../src/index.ts');const {hashPassword}=await import('../src/admin.ts');
  const {id,token}=await authActionFixture(), gate=barrier(), service=auth(first,pausePassword('/change-password',gate));
  const login=await request(service,'sign-in/email',{email:`${id}@example.test`,password:'Synthetic original password'});assert.equal(login.status,200);
  const inflight=service.api.changePassword({headers:new Headers({origin,cookie:cookies(login)}),body:{currentPassword:'Synthetic original password',newPassword:'Synthetic delayed attacker password'}})
    .then(()=>true,()=>false);
  await Promise.race([gate.entered,inflight.then(()=>{throw new Error('запись завершилась до барьера');})]);
  const passwordHash=await hashPassword(replacement);
  try {assert.equal(await consumeAuthAction(second,{token,purpose:'reset',passwordHash}),'ok');}finally{gate.release();}
  assert.equal(await inflight,false);
  assert.equal((await second.select().from(account).where(eq(account.userId,id)))[0]?.password,passwordHash);
});
test('A/F2: регистрация passkey в transaction callback не переживает почтовый reset', {skip:!bin,timeout:15_000}, async()=>{
  const {consumeAuthAction}=await import('../src/index.ts');const {hashPassword}=await import('../src/admin.ts');
  const {id,token}=await authActionFixture(), gate=barrier(), key=authenticator();let inside=false;
  const service=auth(first,pauseAdapter('/passkey/verify-registration','create',gate,value=>{inside=value;}));
  const login=await request(service,'sign-in/email',{email:`${id}@example.test`,password:'Synthetic original password'});assert.equal(login.status,200);
  const options=await request(service,'passkey/generate-register-options',undefined,cookies(login));assert.equal(options.status,200);
  const inflight=request(service,'passkey/verify-registration',{response:key.registration((await options.json()).challenge),createSession:true},`${cookies(login)}; ${cookies(options)}`);
  await Promise.race([gate.entered,inflight.then(()=>{throw new Error('регистрация завершилась до барьера');})]);
  try {assert.equal(inside,true);assert.equal(await consumeAuthAction(second,{token,purpose:'reset',passwordHash:await hashPassword(replacement)}),'ok');}finally{gate.release();}
  assert.equal((await inflight).status,401);
  assert.equal((await second.select().from(passkey).where(eq(passkey.userId,id))).length,0);
  assert.equal((await second.select().from(session).where(eq(session.userId,id))).length,0);
});
for (const isolationLevel of ['read committed','repeatable read'] as const) {
  test(`A: роль/блокировка/фактор опережают consume (${isolationLevel})`, {skip:!bin,timeout:15_000}, async()=>{
    const {consumeAuthAction,authRecoveryGuards}=await import('../src/index.ts');const {hashPassword}=await import('../src/admin.ts');
    for(const mode of ['role','status','factor']) {
      const {id,token}=await authActionFixture();const passwordHash=await hashPassword(replacement);let pending:Promise<unknown>|undefined;
      const isolated=new Proxy(second,{get(target,key){if(key==='transaction')return(fn:Parameters<AnyDb['transaction']>[0])=>second.transaction(fn,{isolationLevel});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
      await first.transaction(async tx=>{
        await lockAccessChanges(tx);
        pending=consumeAuthAction(isolated,{token,purpose:'reset',passwordHash});
        let waiting=false;
        for(let n=0;n<100;n++) {const status=await tx.execute(sql`select wait_event_type from pg_stat_activity where pid=${secondPid}`);
          if((status as unknown as {wait_event_type:string}[])[0]?.wait_event_type==='Lock'){waiting=true;break;}await delay(5);}
        assert.ok(waiting);
        if(mode==='role')await tx.update(user).set({role:'admin'}).where(eq(user.id,id));
        if(mode==='status')await tx.update(user).set({status:'suspended'}).where(eq(user.id,id));
        if(mode==='factor')await tx.insert(authRecoveryGuards).values({userId:id});
      });
      assert.equal(await pending,'invalid',mode);
    }
  });
}
test('A: реальное подключение gf_hub выполняет только узкий consume', {skip:!bin,timeout:15_000}, async()=>{
  const {consumeAuthAction,authRecoveryGuards}=await import('../src/index.ts');const {hashPassword}=await import('../src/admin.ts');
  const {id,token}=await authActionFixture(), hub=drizzle(clients[2]!,{schema});
  await assert.rejects(hub.update(user).set({authActionsNotBefore:new Date(0)}).where(eq(user.id,id)));
  await assert.rejects(hub.insert(authRecoveryGuards).values({userId:id}));
  await hub.execute(sql`select set_config('gf.access_actor_kind','operator',false),set_config('gf.access_actor_id','forged',false)`);
  assert.equal(await consumeAuthAction(hub,{token,purpose:'reset',passwordHash:await hashPassword(replacement)}),'ok');
  const events=await first.select().from(accessEvents).where(eq(accessEvents.targetUserId,id));
  assert.equal(events.at(-1)?.actorKind,'system');assert.equal(events.at(-1)?.actorId,null);
});

for (const purpose of ['verify', 'reset'] as const) {
  test(`A: committed PreparedMail точно совпадает с send (${purpose})`, { skip: !bin, timeout: 15_000 }, async () => {
    const { randomUUID } = await import('node:crypto');
    const { authMailKeys, authMailOperations, authMailStore } = await import('../src/index.ts');
    const { authMailDispatcher } = await import('../../../apps/hub/src/lib/auth-mail-dispatcher.ts');
    await first.delete(authMailOperations);
    const { id } = await authActionFixture(purpose), keys = authMailKeys([Buffer.alloc(32, 61)]);
    const createdAt = Date.now() - 1234;
    const store = authMailStore(first, keys, origin, () => createdAt);
    await store.request({ email: `${id}@example.test`, purpose, intent: randomUUID(), browser: randomUUID(), ip: '192.0.2.61' });
    const [pending] = await first.select().from(authMailOperations);
    assert.ok(pending); assert.equal(pending.state, 'pending');
    let sendError: unknown, checked = false, calls = 0;
    const dispatcher = authMailDispatcher(store, async mail => {
      calls++;
      try {
        // Обычный MVCC SELECT другого backend видит только committed-состояние.
        // Открытая транзакция claim или запоздалое сохранение не пройдут эту проверку.
        const [record] = await second.select().from(authMailOperations).where(eq(authMailOperations.id, pending.id));
        const identity = await second.execute(sql`select pg_backend_pid() as pid`);
        assert.equal((identity as unknown as { pid: number }[])[0]?.pid, secondPid);
        assert.ok(record); assert.equal(record.state, 'started');
        assert.ok(record.actionId); assert.ok(record.startedAt); assert.ok(record.ciphertext);
        const context = JSON.stringify([record.id, record.purpose, record.createdAt.getTime(), record.profile, 'prepared']);
        const saved = keys.open(record.ciphertext, record.keyId, context);
        assert.deepEqual(saved, mail, 'точные body/createdAt должны быть сохранены до первого send');
        assert.equal(mail.createdAt, createdAt);
        assert.equal(JSON.parse(mail.body).operationId, record.id);
        assert.equal(JSON.parse(mail.body).kind, purpose === 'verify' ? 'verify-email.v1' : 'reset-password.v1');
        checked = true;
        return { outcome: 'accepted', code: 'accepted_by_provider' };
      } catch (error) { sendError = error; throw error; }
    });
    try { await dispatcher.tick(); } finally { dispatcher.stop(); }
    // Dispatcher скрывает ошибки send; тест обязан вынести ошибку проверки наружу.
    assert.ifError(sendError); assert.equal(checked, true); assert.equal(calls, 1);
    const [finished] = await second.select().from(authMailOperations).where(eq(authMailOperations.id, pending.id));
    assert.equal(finished?.state, 'accepted'); assert.equal(finished?.ciphertext, null);
  });
}
