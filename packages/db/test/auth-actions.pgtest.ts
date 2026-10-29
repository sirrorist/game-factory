import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { account, authActions, authMailCounters, authMailKeys, authMailOperations, authMailStore, authRecoveryGuards,
  consumeAuthAction, tokenHash, schema, session, user, passkey, type AuthPurpose } from '../src/index.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { hashPassword, setPassword } from '../src/admin.ts';
import { ensureHubRole } from '../src/roles.ts';
import { createHubAuth } from '../../../apps/hub/src/lib/auth-core.ts';
import { authActionHttp, AUTH_BROWSER_COOKIE } from '../../../apps/hub/src/lib/auth-actions-http.ts';
import { authMailDispatcher } from '../../../apps/hub/src/lib/auth-mail-dispatcher.ts';
import { CSRF_COOKIE, CSRF_HEADER } from '../../../apps/hub/src/lib/csrf-names.ts';

const client = new PGlite(), db = drizzle(client, { schema });
const origin = 'https://hub.example', keys = authMailKeys([Buffer.alloc(32, 11)]);
let now = Date.now();
const store = authMailStore(db, keys, origin, () => now);
const password = 'Synthetic password only 2026';
let hash: string;
before(async () => { await migrate(db, { migrationsFolder: MIGRATIONS_DIR }); hash = await hashPassword(password); });
after(() => client.close());
async function fixture(role = 'user', verified = false) {
  const id = 'u-' + randomUUID();
  await db.insert(user).values({ id, name: 'Тест', email: `${id}@example.test`, role, emailVerified: verified });
  await db.insert(account).values({ id, userId: id, accountId: id, providerId: 'credential', password: hash });
  return { id, email: `${id}@example.test` };
}
async function issue(u: { email: string }, purpose: AuthPurpose = 'reset') {
  now = Date.now();
  const browser = randomUUID(), ip = randomUUID();
  await store.request({ email: u.email, purpose, intent: randomUUID(), browser, ip });
  const claim = await store.claim(); assert.ok(claim);
  const body = JSON.parse(claim.mail.body) as { url: string };
  return { token: new URL(body.url).searchParams.get('token')!, claim };
}
async function cleanupQueue() {
  await db.delete(authMailOperations); await db.delete(authActions); await db.delete(authMailCounters);
}

test('миграция повторяется; reset одноразовый, отзывает сессии/passkey, сохраняет emailVerified и данные', async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const u = await fixture();
  await db.insert(session).values({ id: u.id, userId: u.id, token: u.id, expiresAt: new Date(Date.now() + 60_000) });
  await db.insert(passkey).values({ id: u.id, userId: u.id, publicKey: 'test', credentialID: u.id, counter: 0, deviceType: 'singleDevice', backedUp: false });
  const { token } = await issue(u);
  assert.equal(await consumeAuthAction(db, { token, purpose: 'reset', passwordHash: hash }), 'ok');
  assert.equal(await consumeAuthAction(db, { token, purpose: 'reset', passwordHash: hash }), 'invalid');
  assert.equal((await db.select().from(user).where(eq(user.id, u.id)))[0]?.securityGeneration, 1);
  assert.equal((await db.select().from(user).where(eq(user.id, u.id)))[0]?.emailVerified, false);
  assert.equal((await db.select().from(session).where(eq(session.userId, u.id))).length, 0);
  assert.equal((await db.select().from(passkey).where(eq(passkey.userId, u.id))).length, 0);
});
test('verification: wrong purpose/hash-as-bearer/чужая сессия не потребляют; GET не нужен; нет входа', async () => {
  const u = await fixture(), other = await fixture();
  await db.insert(session).values({ id: other.id, userId: other.id, token: other.id, expiresAt: new Date(Date.now() + 60_000) });
  const { token } = await issue(u, 'verify');
  const row = (await db.select().from(authActions).where(eq(authActions.userId, u.id)))[0]!;
  assert.equal(row.tokenHash.includes(token), false);
  assert.equal(await consumeAuthAction(db, { token: row.tokenHash, purpose: 'verify' }), 'invalid');
  assert.equal(await consumeAuthAction(db, { token, purpose: 'reset', passwordHash: hash }), 'invalid');
  assert.equal(await consumeAuthAction(db, { token, purpose: 'verify', sessionId: other.id }), 'conflict');
  assert.equal(await consumeAuthAction(db, { token, purpose: 'verify' }), 'ok');
  assert.equal(await consumeAuthAction(db, { token, purpose: 'verify' }), 'invalid');
  assert.equal((await db.select().from(user).where(eq(user.id, u.id)))[0]?.emailVerified, true);
  assert.equal((await db.select().from(session).where(eq(session.userId, u.id))).length, 0);
});
test('просроченный, отозванный, изменённый email и CLI-reset закрывают исходное доказательство', async () => {
  for (const action of ['expire', 'revoke', 'email', 'cli']) {
    const u = await fixture(), { token } = await issue(u);
    if (action === 'expire') await db.update(authActions).set({ expiresAt: new Date(0) }).where(eq(authActions.userId, u.id));
    if (action === 'revoke') await db.update(authActions).set({ revokedAt: new Date() }).where(eq(authActions.userId, u.id));
    if (action === 'email') await db.update(user).set({ email: `${randomUUID()}@example.test` }).where(eq(user.id, u.id));
    if (action === 'cli') await setPassword(db, u.email, password);
    assert.equal(await consumeAuthAction(db, { token, purpose: 'reset', passwordHash: hash }), 'invalid', action);
  }
});
test('owner/admin/suspended/MFA не получают reset; повышение или включение фактора после выдачи отзывает', async () => {
  for (const role of ['owner', 'admin']) {
    const u = await fixture(role);
    await store.request({ email: u.email, purpose: 'reset', intent: randomUUID(), browser: randomUUID(), ip: randomUUID() });
    assert.equal(await store.claim(), null);
  }
  for (const mode of ['admin', 'suspended', 'mfa']) {
    const u = await fixture(), { token } = await issue(u);
    if (mode === 'admin') await db.update(user).set({ role: 'admin' }).where(eq(user.id, u.id));
    if (mode === 'suspended') await db.update(user).set({ status: 'suspended' }).where(eq(user.id, u.id));
    if (mode === 'mfa') await db.insert(authRecoveryGuards).values({ userId: u.id });
    assert.equal(await consumeAuthAction(db, { token, purpose: 'reset', passwordHash: hash }), 'invalid', mode);
  }
});
test('gf_hub не назначает фактор/поколение и не подделывает operator; узкий EXECUTE принимает bearer', async () => {
  await ensureHubRole(db, 'synthetic-db-password-only');
  const u = await fixture(), { token } = await issue(u);
  await db.execute(sql.raw('set role gf_hub'));
  try {
    await assert.rejects(db.update(user).set({ securityGeneration: 99 }).where(eq(user.id, u.id)));
    await assert.rejects(db.insert(authRecoveryGuards).values({ userId: u.id }));
    assert.equal(await consumeAuthAction(db, { token, purpose: 'reset', passwordHash: hash }), 'ok');
  } finally { await db.execute(sql.raw('reset role')); }
});
test('сломанная запись откатывает пароль/token/generation целиком', async () => {
  const u = await fixture(), { token } = await issue(u);
  await client.exec(`create function gf_test_fail_reset() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$;
    create trigger gf_test_fail_reset before update of security_generation on "user" for each row execute function gf_test_fail_reset();`);
  try { await assert.rejects(consumeAuthAction(db, { token, purpose: 'reset', passwordHash: hash })); }
  finally { await client.exec('drop trigger gf_test_fail_reset on "user"; drop function gf_test_fail_reset();'); }
  assert.equal((await db.select().from(user).where(eq(user.id, u.id)))[0]?.securityGeneration, 0);
  assert.equal((await db.select().from(authActions).where(eq(authActions.userId, u.id)))[0]?.consumedAt, null);
  assert.equal(await consumeAuthAction(db, { token, purpose: 'reset', passwordHash: hash }), 'ok');
});
test('AES-GCM скрывает адрес/token, отвергает подмену metadata/ключа, сохраняет старый ключ при ротации', () => {
  const value = { token: randomBytes(32).toString('base64url'), email: 'synthetic@example.test' };
  const encrypted = keys.seal(value, 'metadata');
  assert.equal(encrypted.includes(value.token), false); assert.equal(encrypted.includes(value.email), false);
  assert.deepEqual(keys.open(encrypted, keys.currentId, 'metadata'), value);
  assert.throws(() => keys.open(encrypted, keys.currentId, 'other'));
  assert.throws(() => authMailKeys([Buffer.alloc(32, 12)]).open(encrypted, keys.currentId, 'metadata'));
  const rotated = authMailKeys([Buffer.alloc(32, 12), Buffer.alloc(32, 11)]);
  assert.deepEqual(rotated.open(encrypted, keys.currentId, 'metadata'), value);
  assert.throws(() => authMailKeys([Buffer.alloc(31)]));
  const browser = keys.browser(); assert.equal(keys.browser(browser.cookie).id, browser.id);
  assert.notEqual(keys.browser(browser.cookie + 'bad').id, browser.id);
});
test('намерения устойчивы, один claim, crash -> unknown без resend; plaintext отсутствует в очереди', async () => {
  await cleanupQueue();
  const u = await fixture();
  const input = { email: u.email, purpose: 'reset' as const, intent: randomUUID(), browser: randomUUID(), ip: randomUUID() };
  await store.request(input); await store.request(input);
  const pending = await db.select().from(authMailOperations); assert.equal(pending.length, 1);
  assert.equal(JSON.stringify(pending).includes(u.email), false);
  const restarted = authMailStore(db, keys, origin, () => now);
  const claim = await restarted.claim(); assert.ok(claim); assert.equal(await store.claim(), null);
  const persisted = await db.select().from(authMailOperations);
  assert.equal(JSON.stringify(persisted).includes(new URL(JSON.parse(claim.mail.body).url).searchParams.get('token')!), false);
  now += 61_000; assert.equal(await restarted.claim(), null);
  assert.equal((await db.select().from(authMailOperations))[0]?.state, 'unknown');
  assert.equal((await db.select().from(authMailOperations))[0]?.ciphertext, null);
});
test('диспетчер: один send, unknown без повтора, максимум два параллельно, отмена', async () => {
  await cleanupQueue(); now = Date.now();
  for (let i=0;i<3;i++) { const u=await fixture(); await store.request({ email:u.email, purpose:'verify', intent:randomUUID(), browser:randomUUID(), ip:randomUUID() }); }
  let calls = 0; const waiting: (() => void)[] = [];
  const dispatcher = authMailDispatcher(store, async (_mail, signal) => { calls++;
    await new Promise<void>(resolve => { waiting.push(resolve); signal.addEventListener('abort', () => resolve(), { once:true }); });
    return { outcome: 'unknown', code: 'transport_error' }; });
  const a=dispatcher.tick(), b=dispatcher.tick(), c=dispatcher.tick();
  while (calls<2) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls,2); dispatcher.stop(); waiting.forEach(resolve => resolve()); await Promise.all([a,b,c]);
  await dispatcher.tick(); assert.equal(calls,2);
  assert.equal((await db.select().from(authMailOperations).where(eq(authMailOperations.state,'unknown'))).length,2);
  await cleanupQueue();
});
test('email/browser/IP лимиты постоянны и независимы от существования адреса; дедупликация', async () => {
  await cleanupQueue(); now = Date.now();
  const input = { email:'missing@example.test', purpose:'reset' as const, browser:randomUUID(), ip:randomUUID(), intent:randomUUID() };
  await store.request(input); await store.request(input);
  assert.equal((await db.select().from(authMailOperations)).length,1);
  await store.request({...input,intent:randomUUID(),browser:randomUUID()});
  assert.equal((await db.select().from(authMailOperations).where(eq(authMailOperations.state,'pending'))).length,1);
  now+=60_001; await store.request({...input,intent:randomUUID(),browser:randomUUID()});
  now+=60_001; await store.request({...input,intent:randomUUID(),browser:randomUUID()});
  now+=60_001; await store.request({...input,intent:randomUUID(),browser:randomUUID()});
  assert.equal((await db.select().from(authMailOperations).where(eq(authMailOperations.state,'pending'))).length,3);
  const browser=randomUUID(), ip=randomUUID();
  for(let i=0;i<10;i++) assert.equal((await store.request({...input, email:`missing${i}@example.test`,browser,ip,intent:randomUUID()})).retryAfter,0);
  assert.ok((await authMailStore(db,keys,origin,()=>now).request({...input,email:'owner@example.test',browser,ip,intent:randomUUID()})).retryAfter>0);
  await cleanupQueue();
});
test('глобальные бюджеты сохраняются и не отправляют сверх 70/сутки и 2000/месяц', async () => {
  for(const n of [70,2000]) {
    await cleanupQueue();now=Date.UTC(2030,0,15,12);const u=await fixture();
    const values=Array.from({length:n},()=>n===70?now-1:Date.UTC(2030,0,2,12));
    await db.insert(authMailCounters).values({key:'global-auth',hits:JSON.stringify(values),expiresAt:new Date(now+32*86_400_000)});
    await store.request({email:u.email,purpose:'reset',intent:randomUUID(),browser:randomUUID(),ip:randomUUID()});
    assert.equal(await store.claim(),null);
  }
  await cleanupQueue();
});
const csrf='x'.repeat(43);
function request(body:object, method='POST', extra:Record<string,string>={}) {
  return new Request(origin+'/api/account/password-reset/request',{method,headers:{origin,'content-type':'application/json',cookie:`${CSRF_COOKIE}=${csrf}`,[CSRF_HEADER]:csrf,...extra},
    ...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
test('HTTP: GET/CSRF/закрытый флаг; единый 202 без lookup/provider, чужая сессия 409', async () => {
  await cleanupQueue();now=Date.now();
  const handle=authActionHttp({db,origin,keys,store,enabled:true,session:async()=>null});
  assert.equal((await handle(request({},'GET'),'reset','consume')).status,405);
  assert.equal((await handle(request({},'POST',{origin:'https://game.example'}),'reset','consume')).status,403);
  const disabled=authActionHttp({db,origin,keys,store,enabled:false,session:async()=>null});
  assert.equal((await disabled(request({}),'reset','request')).status,404);
  for(const email of ['unknown@example.test',(await fixture('admin')).email,(await fixture()).email]) {
    const response=await handle(request({email,intent:keys.intent()}),'reset','request');
    assert.equal(response.status,202); assert.deepEqual(await response.json(),{code:'request_received'});
    assert.match(response.headers.get('set-cookie')!,new RegExp(AUTH_BROWSER_COOKIE));
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
  await cleanupQueue();
  const u=await fixture(), other=await fixture(), {token}=await issue(u,'verify');
  await db.insert(session).values({id:other.id,userId:other.id,token:other.id,expiresAt:new Date(Date.now()+60_000)});
  const conflict=authActionHttp({db,origin,keys,store,enabled:true,session:async()=>({id:other.id})});
  assert.equal((await conflict(request({token}),'verify','consume')).status,409);
  assert.equal(await consumeAuthAction(db,{token,purpose:'verify'}),'ok');
  await cleanupQueue();
});
test('Better Auth альтернативные POST/GET и server API закрыты; обычный вход остаётся', async () => {
  const auth=createHubAuth(db,origin,'synthetic auth secret with at least 32 chars');
  for (const [path,method,body] of [
    ['/send-verification-email','POST',{email:'synthetic@example.test'}],
    ['/request-password-reset','POST',{email:'synthetic@example.test'}],
    ['/reset-password','POST',{token:'invalid',newPassword:password}],
    ['/reset-password/invalid?callbackURL=https://evil.example','GET',null],
    ['/verify-email?token=invalid','GET',null],
  ] as const) {
    const response=await auth.handler(new Request(origin+'/api/auth'+path,{method,headers:{origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
    assert.ok(response.status>=400,path);
  }
  await assert.rejects(auth.api.requestPasswordReset({body:{email:'synthetic@example.test'}}));
  await assert.rejects(auth.api.resetPassword({body:{token:'invalid',newPassword:password}}));
  await assert.rejects(auth.api.sendVerificationEmail({body:{email:'synthetic@example.test'}}));
  const u=await fixture();
  const result=await auth.api.signInEmail({body:{email:`  ${u.email.toUpperCase()}  `,password}});
  assert.ok(result.token);
});

test('consume самостоятельно запрещает admin/owner/MFA даже для искусственно выданного актуального токена', async () => {
  for (const mode of ['owner','admin','mfa']) {
    const u = await fixture(mode === 'mfa' ? 'user' : mode);
    if (mode === 'mfa') await db.insert(authRecoveryGuards).values({ userId: u.id });
    const current = (await db.select().from(user).where(eq(user.id,u.id)))[0]!;
    const token = randomBytes(32).toString('base64url');
    await db.insert(authActions).values({id:randomUUID(),tokenHash:tokenHash(token),purpose:'reset',userId:u.id,email:u.email,
      generation:current.securityGeneration,createdAt:new Date(),expiresAt:new Date(Date.now()+60_000)});
    assert.equal(await consumeAuthAction(db,{token,purpose:'reset',passwordHash:hash}),'invalid',mode);
  }
});
test('потеря browser-cookie и изменение payload с прежним intent не создают новое письмо', async () => {
  await cleanupQueue();now=Date.now();const u=await fixture();const intent=randomUUID();
  await store.request({email:u.email,purpose:'reset',intent,browser:randomUUID(),ip:randomUUID()});
  now+=61_000;
  await store.request({email:'different@example.test',purpose:'verify',intent,browser:randomUUID(),ip:randomUUID()});
  assert.equal((await db.select().from(authMailOperations)).length,1);
  const claim=await store.claim();assert.ok(claim);
  const body=JSON.parse(claim.mail.body);assert.equal(body.to,u.email);assert.equal(body.kind,'reset-password.v1');
  await cleanupQueue();
});
test('неизвестный ключ/повреждённый ciphertext закрывает операцию, без plaintext fallback/нового ID', async () => {
  await cleanupQueue();now=Date.now();const u=await fixture();
  await store.request({email:u.email,purpose:'reset',intent:randomUUID(),browser:randomUUID(),ip:randomUUID()});
  const bad=authMailStore(db,authMailKeys([Buffer.alloc(32,99)]),origin,()=>now);
  await assert.rejects(bad.claim(),/снимок почты недоступен/);
  const rows=await db.select().from(authMailOperations);assert.equal(rows.length,1);assert.equal(rows[0]?.state,'pending');assert.ok(rows[0]?.ciphertext);
  const restored=await store.claim();assert.equal(restored?.id,rows[0]?.id);
  await cleanupQueue();
});

test('CLI/смена доступа отзывает даже намерение, ещё не получившее userId/token', async () => {
  for (const mode of ['cli','generation','email']) {
    await cleanupQueue();now=Date.now();const u=await fixture();
    await store.request({email:u.email,purpose:'reset',intent:randomUUID(),browser:randomUUID(),ip:randomUUID()});
    if(mode==='cli') await setPassword(db,u.email,password);
    if(mode==='generation') await db.update(user).set({securityGeneration:1}).where(eq(user.id,u.id));
    if(mode==='email') await db.update(user).set({email:`changed-${u.email}`}).where(eq(user.id,u.id));
    assert.equal(await store.claim(),null,mode);
  }
  await cleanupQueue();
});
test('предел таблиц и очистка не вытесняют активные счётчики', async () => {
  await cleanupQueue();now=Date.now();
  await client.exec(`insert into auth_mail_counters(key,hits,expires_at) select 'synthetic-'||n,'[]',now()+interval '1 hour' from generate_series(1,10000) n`);
  const input={email:'synthetic@example.test',purpose:'verify' as const,intent:randomUUID(),browser:randomUUID(),ip:randomUUID()};
  assert.equal((await store.request(input)).retryAfter,60);
  assert.equal((await db.select().from(authMailOperations)).length,0);
  assert.equal((await db.select().from(authMailCounters)).length,10000);
  await cleanupQueue();
});

test('consume перепроверяет поколение/email/назначение независимо от отзыва триггером', async () => {
  for(const mode of ['generation','email','purpose']) {
    const u=await fixture(), token=randomBytes(32).toString('base64url');
    await db.insert(authActions).values({id:randomUUID(),tokenHash:tokenHash(token),purpose:mode==='purpose'?'verify':'reset',
      userId:u.id,email:mode==='email'?'other@example.test':u.email,generation:mode==='generation'?1:0,
      createdAt:new Date(),expiresAt:new Date(Date.now()+60_000)});
    assert.equal(await consumeAuthAction(db,{token,purpose:'reset',passwordHash:hash}),'invalid',mode);
    const raw=await client.query<{result:string}>(`select gf_consume_auth_action($1,NULL,NULL,NULL) as result`,[token]);
    assert.equal(raw.rows[0]?.result,'invalid');
  }
});

test('серверное намерение подписано, ограничено сутками; старый ID нельзя превратить в новую отправку', () => {
  const now=Date.now(), intent=keys.intent(now);
  assert.equal(keys.validIntent(intent,now),true);
  assert.equal(keys.validIntent(intent,now+86_400_000),false);
  assert.equal(keys.validIntent(intent,now-1),false);
  assert.equal(keys.validIntent(intent.slice(0,-1)+(intent.endsWith('0')?'1':'0'),now),false);
  assert.equal(authMailKeys([Buffer.alloc(32,98)]).validIntent(intent,now),false);
});
test('граница диспетчера не допускает третий send даже при готовых заданиях', async () => {
  let calls=0,finished=0;
  const fake={ claim:async()=>({id:randomUUID(),mail:{body:'{}',createdAt:Date.now()}}),finish:async()=>{finished++;} } as unknown as Parameters<typeof authMailDispatcher>[0];
  const dispatcher=authMailDispatcher(fake,async (_mail,signal)=>{calls++;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return {outcome:'unknown',code:'cancelled'};});
  const tasks=Array.from({length:5},()=>dispatcher.tick());
  try {await Promise.resolve();await Promise.resolve();assert.equal(calls,2);}
  finally {dispatcher.stop();await Promise.all(tasks);}
  assert.equal(finished,2);
});

test('email: пять за UTC-сутки независимо от часового окна, следующие сутки открываются', async () => {
  await cleanupQueue();now=Date.UTC(2030,0,15,12);
  const input={email:'daily@example.test',purpose:'verify' as const};
  async function ask(){return store.request({...input,intent:randomUUID(),browser:randomUUID(),ip:randomUUID()});}
  for(let i=0;i<3;i++){await ask();now+=61_000;}
  now+=3_600_001;await ask();now+=61_000;await ask();now+=61_000;await ask();
  assert.equal((await db.select().from(authMailOperations).where(eq(authMailOperations.state,'pending'))).length,5);
  now=Date.UTC(2030,0,16,0,1);await ask();
  assert.equal((await db.select().from(authMailOperations).where(eq(authMailOperations.state,'pending'))).length,6);
  await cleanupQueue();
});
test('IP: смена browser/email не обнуляет 50 запросов в час', async () => {
  await cleanupQueue();now=Date.now();const ip='192.0.2.20';
  for(let i=0;i<50;i++)assert.equal((await store.request({email:`ip-${i}@example.test`,purpose:'verify',intent:randomUUID(),browser:randomUUID(),ip})).retryAfter,0);
  assert.ok((await store.request({email:'last@example.test',purpose:'verify',intent:randomUUID(),browser:randomUUID(),ip})).retryAfter>0);
  await cleanupQueue();
});
test('операции: предел 5000 не вытесняет существующие записи', async () => {
  await cleanupQueue();now=Date.now();
  await client.exec(`insert into auth_mail_operations(id,intent_key,purpose,state,key_id,profile,created_at,expires_at)
    select 'synthetic-'||n,'synthetic-'||n,'verify','suppressed','test','test',now(),now()+interval '1 day' from generate_series(1,5000) n`);
  await store.request({email:'capacity@example.test',purpose:'verify',intent:randomUUID(),browser:randomUUID(),ip:randomUUID()});
  assert.equal((await db.select().from(authMailOperations)).length,5000);
  await cleanupQueue();
});
