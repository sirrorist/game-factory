// Все потребители прав видят доказательство B (план B, раздел 2): старый вход Better Auth не
// выдаёт сессию по одному паролю тому, кому второй фактор обязателен, а SSR (sessionAccess),
// хук Better Auth и маршрут B не пускают сессию owner без TOTP/UV.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { account, passkey, schema, session, user } from '../src/index.ts';
import { authFactors } from '../src/auth-factor-schema.ts';
import { factorKeys, randomBearer, totpCode, totpSecret } from '../src/auth-factor-crypto.ts';
import { factorStore } from '../src/auth-factor-store.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { hashPassword } from '../src/admin.ts';
import { factorController } from '../../../apps/hub/src/lib/auth-factor-core.ts';
import { factorHttp } from '../../../apps/hub/src/lib/auth-factor-http.ts';
import { createHubAuth } from '../../../apps/hub/src/lib/auth-core.ts';
import { sessionAccess } from '../../../apps/hub/src/lib/session-access.ts';
import { SESSION_COOKIE, signedSessionCookie } from '../../../apps/hub/src/lib/session-bearer.ts';
import { LoginGuard } from '../../../apps/hub/src/lib/login-guard.ts';
import { authenticator } from './auth-race-fixtures.ts';
import type { BetterAuthPlugin } from '../../../apps/hub/node_modules/better-auth/dist/index.mjs';
import { createAuthMiddleware } from '../../../apps/hub/node_modules/better-auth/dist/api/index.mjs';
import { CSRF_COOKIE, CSRF_HEADER } from '../../../apps/hub/src/lib/csrf-names.ts';

const pg = new PGlite(), db = drizzle(pg, { schema }), keys = factorKeys([Buffer.alloc(32, 34)]);
const origin = 'https://hub.example', secret = 'Synthetic B consumers cookie secret, 32+ chars';
const password = 'Synthetic consumers correct password', csrf = 'd'.repeat(43);
let hash: string, auth: ReturnType<typeof createHubAuth>;
before(async () => { await migrate(db, { migrationsFolder: MIGRATIONS_DIR }); hash = await hashPassword(password); auth = createHubAuth(db, origin, secret); });
after(() => pg.close());

async function fixture(role: 'user' | 'owner' | 'admin', totp = false) {
  const id = randomUUID(), email = id + '@example.test', secretTotp = totpSecret(), factorId = randomUUID();
  await db.insert(user).values({ id, name: id, email, role });
  await db.insert(account).values({ id, accountId: id, userId: id, providerId: 'credential', password: hash });
  if (totp) await db.insert(authFactors).values({ id: factorId, userId: id, kind: 'totp', state: 'active', ...keys.seal(secretTotp, id, factorId), createdAt: new Date() });
  return { id, email, totp: secretTotp };
}
function authRequest(path: string, body?: Record<string, unknown>, cookie = '') {
  return auth.handler(new Request(`${origin}/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-real-ip': '192.0.2.70', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
const handle = factorHttp({ enabled: true, origin, secret, guard: new LoginGuard(),
  control: factorController(factorStore(db), keys),
  async session(headers) { const current = await sessionAccess(auth, db, headers); return current ? { id: current.sessionId, email: current.user.email } : null; } });
function factorRequest(body: Record<string, unknown>, cookie = '') {
  return new Request(origin + '/api/account/security/action', { method: 'POST', headers: { origin, 'content-type': 'application/json',
    cookie: `${CSRF_COOKIE}=${csrf}; ${cookie}`, [CSRF_HEADER]: csrf, 'x-real-ip': '192.0.2.71' }, body: JSON.stringify(body) });
}
const cookies = (response: Response) => response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
const sessionSet = (response: Response) => response.headers.getSetCookie().some(c => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`));
/** Сессия, выданная в обход B: строка session без доказательства, как от старого входа. */
async function forged(userId: string) {
  const id = randomUUID(), token = randomBearer();
  await db.insert(session).values({ id, userId, token, securityGeneration: 0, expiresAt: new Date(Date.now() + 3_600_000) });
  return (await signedSessionCookie(token, secret)).split(';')[0]!;
}

test('старый вход: верный пароль owner/admin/TOTP-пользователя без второго фактора неотличим от неверного', async () => {
  for (const [role, totp] of [['owner', false], ['admin', false], ['user', true]] as const) {
    const f = await fixture(role, totp);
    const right = await authRequest('sign-in/email', { email: f.email, password });
    const wrong = await authRequest('sign-in/email', { email: f.email, password: 'Synthetic consumers wrong password' });
    const unknown = await authRequest('sign-in/email', { email: randomUUID() + '@example.test', password });
    assert.equal(right.status, 401, `${role}: ${await right.clone().text()}`);
    // Сырое тело и заголовки, а не разобранный JSON: порядок ключей тоже различим.
    const raw = async (r: Response) => JSON.stringify([r.status, [...r.headers], await r.text()]);
    const expected = await raw(wrong);
    assert.equal(await raw(right), expected, `${role}: ответ не должен подтверждать пароль`);
    assert.equal(await raw(unknown), expected, `${role}: и не отличаться от неизвестного email`);
    assert.equal(sessionSet(right), false);
    assert.equal((await db.select().from(session).where(eq(session.userId, f.id))).length, 0);
  }
});

test('обычный пользователь без TOTP входит старым путём, SSR видит его права', async () => {
  const f = await fixture('user');
  const login = await authRequest('sign-in/email', { email: f.email, password });
  assert.equal(login.status, 200, await login.clone().text());
  const current = await sessionAccess(auth, db, new Headers({ cookie: cookies(login) }));
  assert.equal(current?.user.id, f.id);
  assert.equal(current?.user.role, 'user');
  assert.equal(await sessionAccess(auth, db, new Headers()), null);
});

test('сессия owner без доказательства B: SSR - гость, Better Auth и маршрут B отказывают', async () => {
  const f = await fixture('owner'), cookie = await forged(f.id);
  assert.equal(await sessionAccess(auth, db, new Headers({ cookie })), null);
  const profile = await authRequest('update-user', { name: 'Не должно сохраниться' }, cookie);
  assert.notEqual(profile.status, 200);
  assert.equal((await db.select().from(user).where(eq(user.id, f.id)))[0]?.name, f.id);
  assert.equal((await handle(factorRequest({}, cookie), 'setup')).status, 401);
  assert.equal((await handle(factorRequest({}, cookie), 'backup-rotate')).status, 401);
});

test('owner после пароля и TOTP через B - owner в SSR; пароль и passkey штатными путями Better Auth закрыты', async () => {
  const f = await fixture('owner', true);
  const first = await handle(factorRequest({ email: f.email, password }), 'password');
  assert.deepEqual(await first.json(), { code: 'totp_required' });
  const second = await handle(factorRequest({ code: totpCode(f.totp, Math.floor(Date.now() / 30000)) }, cookies(first)), 'totp');
  assert.equal(second.status, 200);
  const cookie = cookies(second).split('; ').find(c => c.startsWith(`${SESSION_COOKIE}=`))!;
  assert.equal((await sessionAccess(auth, db, new Headers({ cookie })))?.user.role, 'owner');
  assert.equal((await db.select().from(account).where(eq(account.userId, f.id)))[0]?.password, hash);
  // Белый список: всё, что меняет credentials, email или выдаёт сессию, - мимо Better Auth.
  for (const [path, body] of [['change-password', { currentPassword: password, newPassword: 'Synthetic consumers next password' }],
    ['set-password', { newPassword: 'Synthetic consumers next password' }], ['passkey/generate-register-options', undefined],
    ['passkey/verify-registration', { response: {} }], ['passkey/delete-passkey', { id: 'x' }], ['passkey/update-passkey', { id: 'x', name: 'y' }],
    ['change-email', { newEmail: 'other@example.test' }], ['link-social', { provider: 'github' }], ['unlink-account', { providerId: 'credential' }],
    ['passkey/generate-authenticate-options', undefined]] as const) {
    // set-password у Better Auth - только server API, HTTP-маршрута нет.
    assert.equal((await authRequest(path, body, cookie)).status, path === 'set-password' ? 404 : 403, path);
  }
  // Свой профиль владелец по-прежнему меняет.
  assert.equal((await authRequest('update-user', { name: 'Владелец' }, cookie)).status, 200);
});

test('sessionAccess сам сверяет доказательство B, а не полагается на хук Better Auth', async () => {
  const f = await fixture('owner'), id = randomUUID(), token = randomBearer();
  await db.insert(session).values({ id, userId: f.id, token, securityGeneration: 0, expiresAt: new Date(Date.now() + 3_600_000) });
  // getSession без хука: отдаёт строку как есть - так выглядел бы путь, где хук не сработал.
  const bare = { api: { getSession: async () => ({ session: { id, token }, user: { id: f.id } }) } } as unknown as Parameters<typeof sessionAccess>[0];
  assert.equal(await sessionAccess(bare, db, new Headers()), null);
});

test('passkey-вход owner без UV-доказательства B не выдаёт сессию', async () => {
  const f = await fixture('owner', true), key = authenticator();
  await db.insert(passkey).values({ id: randomUUID(), userId: f.id, credentialID: key.id,
    publicKey: key.publicKey.toString('base64'), counter: 0, deviceType: 'singleDevice', backedUp: false });
  const options = await authRequest('passkey/generate-authenticate-options');
  assert.equal(options.status, 200);
  const login = await authRequest('passkey/verify-authentication', { response: key.authentication((await options.json()).challenge) }, cookies(options));
  assert.equal(login.status, 401, await login.clone().text());
  assert.equal(sessionSet(login), false);
  assert.equal((await db.select().from(session).where(eq(session.userId, f.id))).length, 0);
});

test('старый вход owner не проверяет пароль вовсе: работа как у неизвестного email', async () => {
  const f = await fixture('owner'), calls = { verify: 0, hash: 0 };
  const counting: BetterAuthPlugin = { id: 'test-count-password', hooks: { before: [{ matcher: (ctx) => ctx.path === '/sign-in/email',
    handler: createAuthMiddleware(async (ctx) => {
      const original = ctx.context.password;
      ctx.context.password = { ...original,
        verify: async (input) => { calls.verify++; return original.verify(input); },
        hash: async (input) => { calls.hash++; return original.hash(input); } };
    }) }] } };
  const counted = createHubAuth(db, origin, secret, [counting]);
  const response = await counted.handler(new Request(`${origin}/api/auth/sign-in/email`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-real-ip': '192.0.2.72' }, body: JSON.stringify({ email: f.email, password }) }));
  assert.equal(response.status, 401);
  // Хэш считает наш хук раньше подмены плагином - его не видно; важно, что verify не было.
  assert.equal(calls.verify, 0);
});
