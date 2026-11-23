// Лимит перебора на штатных маршрутах Better Auth (lib/guarded-auth.ts) - с подставным обработчиком.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_PASSWORD_PATH, guardedAuthRequest, SIGN_IN_PATH } from '../src/lib/guarded-auth.ts';
import { LoginGuard } from '../src/lib/login-guard.ts';

const origin = 'https://hub.example';
const ip = '192.0.2.60';

function json(path: string, body: Record<string, string>): Request {
  return new Request(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body) });
}
function form(path: string, body: Record<string, string>): Request {
  return new Request(origin + path, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: new URLSearchParams(body),
  });
}

/** Подставной Better Auth: верный пароль только у своей учётки; тело читает сам, как настоящий. */
async function signIn(request: Request): Promise<Response> {
  const type = request.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await request.json() : Object.fromEntries(await request.formData());
  return body.email === 'mine@example.test' && body.password === 'right' ? Response.json({ ok: true }) : Response.json({}, { status: 401 });
}

for (const [kind, make] of [['JSON', json], ['urlencoded', form]] as const) {
  test(`вход к себе (${kind}) не обнуляет перебор чужой учётки; обработчик получает тело целым`, async () => {
    const guard = new LoginGuard(), warn = console.warn;
    console.warn = () => {};
    try {
      for (let i = 0; i < 4; i++) {
        assert.equal((await guardedAuthRequest(make(SIGN_IN_PATH, { email: 'owner@example.test', password: 'x' + i }), signIn, guard)).status, 401);
      }
      assert.equal((await guardedAuthRequest(make(SIGN_IN_PATH, { email: 'mine@example.test', password: 'right' }), signIn, guard)).status, 200);
      assert.equal((await guardedAuthRequest(make(SIGN_IN_PATH, { email: 'owner@example.test', password: 'x' }), signIn, guard)).status, 401);
      assert.equal(guard.check(ip).banned, true, 'пятый неверный на чужую учётку - бан');
      assert.equal((await guardedAuthRequest(make(SIGN_IN_PATH, { email: 'owner@example.test', password: 'x' }), signIn, guard)).status, 429);
    } finally { console.warn = warn; }
  });

  test(`свой верный пароль (${kind}) снимает свои ошибки`, async () => {
    const guard = new LoginGuard(), warn = console.warn;
    console.warn = () => {};
    try {
      for (let i = 0; i < 4; i++) await guardedAuthRequest(make(SIGN_IN_PATH, { email: 'mine@example.test', password: 'x' + i }), signIn, guard);
      assert.equal((await guardedAuthRequest(make(SIGN_IN_PATH, { email: 'mine@example.test', password: 'right' }), signIn, guard)).status, 200);
      assert.equal((await guardedAuthRequest(make(SIGN_IN_PATH, { email: 'mine@example.test', password: 'x' }), signIn, guard)).status, 401);
      assert.equal(guard.check(ip).banned, false);
    } finally { console.warn = warn; }
  });
}

test('вход к себе после чужих неудач: чужие остаются, пятая - бан', async () => {
  const guard = new LoginGuard(), warn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 4; i++) await guardedAuthRequest(form(SIGN_IN_PATH, { email: 'owner@example.test', password: 'x' + i }), signIn, guard);
    assert.equal((await guardedAuthRequest(json(SIGN_IN_PATH, { email: 'mine@example.test', password: 'right' }), signIn, guard)).status, 200);
    assert.equal((await guardedAuthRequest(form(SIGN_IN_PATH, { email: 'owner@example.test', password: 'x' }), signIn, guard)).status, 401);
    assert.equal(guard.check(ip).banned, true);
  } finally { console.warn = warn; }
});

test('/change-password: неверный текущий пароль считается, пятый - бан; прочие 400 не считаются', async () => {
  const guard = new LoginGuard(), lines: string[] = [], warn = console.warn;
  console.warn = (...args: unknown[]) => { lines.push(args.join(' ')); };
  const wrong = async () => Response.json({ code: 'INVALID_PASSWORD' }, { status: 400 });
  const other = async () => Response.json({ code: 'PASSWORD_TOO_SHORT' }, { status: 400 });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await guardedAuthRequest(json(CHANGE_PASSWORD_PATH, {}), other, guard)).status, 400);
    assert.equal(guard.check(ip).banned, false);
    for (let i = 0; i < 5; i++) assert.equal((await guardedAuthRequest(json(CHANGE_PASSWORD_PATH, {}), wrong, guard)).status, 400);
    assert.equal(guard.check(ip).banned, true);
    assert.equal((await guardedAuthRequest(json(CHANGE_PASSWORD_PATH, {}), wrong, guard)).status, 429);
    assert.ok(lines.some((l) => l.startsWith(`gf-auth: смена пароля отклонена ip=${ip} причина=пароль бан=`)));
  } finally { console.warn = warn; }
});

test('прочие маршруты Better Auth идут мимо лимита', async () => {
  const guard = new LoginGuard();
  for (let i = 0; i < 10; i++) guard.fail(ip);
  const res = await guardedAuthRequest(json('/api/auth/get-session', {}), async () => Response.json({ ok: true }), guard);
  assert.equal(res.status, 200);
});
