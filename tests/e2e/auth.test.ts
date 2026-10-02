// Вход владельца (слайс 1.2, критерии спецификации этапа 1): вход и выход, атрибуты куки,
// CSRF в proxy.ts, кука без `__Host-` не принимается, лимит пароля, passkey.
// Хаб - настоящая сборка с настоящим Postgres (GF_E2E_PG) и ролью gf_hub.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import { buildData, close, freePort, launchBrowser, OWNER, prepareAuthDb, startHub, startPlay, type Hub } from './helpers.ts';

let hub: Hub;
let play: { server: Server; port: number };
let browser: Browser;
let hubOrigin: string;

before(async () => {
  const data = buildData();
  const hubPort = await freePort();
  hubOrigin = `http://localhost:${hubPort}`;
  play = await startPlay(data, [hubOrigin]);
  hub = await startHub({ port: hubPort, dataDir: data, playPort: play.port, env: prepareAuthDb(hubOrigin) });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await hub?.stop();
  if (play) await close(play.server);
});

/** Куки из ответа: имя → вся строка Set-Cookie. */
function setCookies(r: Response): Map<string, string> {
  return new Map(r.headers.getSetCookie().map((c) => [c.slice(0, c.indexOf('=')), c]));
}

function value(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
}

/** Вход "как браузер хаба", но из Node: тут можно подставить любой Origin и любые куки. */
let nextIp = 1;
/** Каждому входу - свой адрес: лимиты считаются по адресу, тесты не должны делить счёт. */
async function apiSignIn(password = OWNER.password, ip = `198.51.100.${nextIp++}`): Promise<{ status: number; csrf: string; session?: string; raw?: string }> {
  const csrf = value(setCookies(await fetch(`${hub.origin}/`)).get('__Host-gf-csrf')!);
  const r = await fetch(`${hub.origin}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: hubOrigin, cookie: `__Host-gf-csrf=${csrf}`, 'x-gf-csrf': csrf, 'x-real-ip': ip },
    body: JSON.stringify({ email: OWNER.email, password }),
  });
  const raw = setCookies(r).get('__Host-gf-session');
  return { status: r.status, csrf, session: raw ? value(raw) : undefined, raw };
}

async function whoAmI(cookie: string): Promise<string | null> {
  const r = await fetch(`${hub.origin}/api/auth/get-session`, { headers: { cookie } });
  const body = (await r.json()) as { user?: { email: string } } | null;
  return body?.user?.email ?? null;
}

test('вход и выход через форму: имя в шапке, страница учётки, после выхода - снова "Войти"', async () => {
  const page = await browser.newPage();
  await page.goto(`${hub.origin}/`);
  await page.getByTestId('sign-in-link').click();
  await page.waitForURL(`${hub.origin}/login`);
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль').fill(OWNER.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL(`${hub.origin}/account`);
  assert.equal(await page.getByTestId('account-email').textContent(), OWNER.email);
  assert.equal(await page.getByTestId('user-name').textContent(), OWNER.name);

  await page.getByTestId('sign-out').click();
  await page.waitForURL(`${hub.origin}/`);
  await page.getByTestId('sign-in-link').waitFor();
  await page.goto(`${hub.origin}/account`);
  await page.waitForURL(`${hub.origin}/login`);
  await page.close();
});

test('неверный пароль - сообщение, а не вход', async () => {
  const page = await browser.newPage();
  await page.goto(`${hub.origin}/login`);
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль').fill('совсем не тот пароль');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  assert.match((await page.getByTestId('login-error').textContent()) ?? '', /Неверная почта или пароль/);
  assert.equal(new URL(page.url()).pathname, '/login');
  await page.close();
});

test('кука сессии: __Host-, Secure, HttpOnly, Path=/, SameSite=Lax, без Domain', async () => {
  const r = await apiSignIn();
  assert.equal(r.status, 200);
  const raw = r.raw!;
  assert.match(raw, /^__Host-gf-session=/);
  assert.match(raw, /;\s*Secure/i);
  assert.match(raw, /;\s*HttpOnly/i);
  assert.match(raw, /;\s*Path=\//i);
  assert.match(raw, /;\s*SameSite=Lax/i);
  assert.doesNotMatch(raw, /;\s*Domain=/i);
  assert.equal(await whoAmI(`__Host-gf-session=${r.session}`), OWNER.email);
});

test('кука с тем же значением, но без __Host- (её может поставить поддомен игры), не принимается', async () => {
  const { session } = await apiSignIn();
  for (const name of ['gf-session', '__Secure-gf-session', 'better-auth.session_token', '__Secure-__Host-gf-session']) {
    assert.equal(await whoAmI(`${name}=${session}`), null, name);
  }
});

/** Отказ именно proxy.ts (тело его ответа), а не второго рубежа - проверки Origin в Better Auth. */
async function proxyRejected(r: Response): Promise<boolean> {
  return r.status === 403 && ((await r.json()) as { message?: string }).message === 'запрос отклонён: проверка CSRF';
}

test('CSRF: Origin игры или без Origin - 403 от proxy даже с верными кукой и токеном; Origin хаба - проходит', async () => {
  const { csrf, session } = await apiSignIn();
  const cookie = `__Host-gf-csrf=${csrf}; __Host-gf-session=${session}`;
  const post = (headers: Record<string, string>): Promise<Response> =>
    fetch(`${hub.origin}/api/auth/update-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, ...headers },
      body: JSON.stringify({ name: OWNER.name }),
    });
  const game = `http://snake.play.localhost:${play.port}`;
  assert.ok(await proxyRejected(await post({ origin: game, 'x-gf-csrf': csrf })), 'Origin игры');
  assert.ok(await proxyRejected(await post({ 'x-gf-csrf': csrf })), 'без Origin');
  assert.ok(await proxyRejected(await post({ origin: hubOrigin })), 'без токена');
  assert.ok(await proxyRejected(await post({ origin: hubOrigin, 'x-gf-csrf': 'x'.repeat(43) })), 'чужой токен');
  assert.equal((await post({ origin: hubOrigin, 'x-gf-csrf': csrf })).status, 200, 'свой Origin и токен');
});

test('CSRF без сессии: вход с Origin игры отбивает proxy, до Better Auth запрос не доходит', async () => {
  const csrf = value(setCookies(await fetch(`${hub.origin}/`)).get('__Host-gf-csrf')!);
  const r = await fetch(`${hub.origin}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://snake.play.localhost:${play.port}`, 'x-gf-csrf': csrf, cookie: `__Host-gf-csrf=${csrf}` },
    body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
  });
  assert.ok(await proxyRejected(r));
});

test('CSRF-кука: __Host-, Secure, Path=/, SameSite=Strict, без Domain; не HttpOnly - её читает клиент хаба', async () => {
  const raw = setCookies(await fetch(`${hub.origin}/`)).get('__Host-gf-csrf')!;
  assert.match(raw, /;\s*Secure/i);
  assert.match(raw, /;\s*Path=\//i);
  assert.match(raw, /;\s*SameSite=Strict/i);
  assert.doesNotMatch(raw, /;\s*Domain=/i);
  assert.doesNotMatch(raw, /;\s*HttpOnly/i);
});

test('регистрации нет: sign-up отказывает и с верными Origin и токеном', async () => {
  const { csrf } = await apiSignIn();
  const r = await fetch(`${hub.origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: hubOrigin, cookie: `__Host-gf-csrf=${csrf}`, 'x-gf-csrf': csrf },
    body: JSON.stringify({ email: 'intruder@e2e.test', password: 'intruder password 1', name: 'x' }),
  });
  // Отказ Better Auth (4xx), а не падение хаба (5xx) и не успех.
  assert.ok(r.status >= 400 && r.status < 500, `статус ${r.status}`);
  assert.equal(setCookies(r).has('__Host-gf-session'), false);
});

test('перебор пароля: после пяти неверных - 429, и с этого адреса верный пароль тоже не пускает', async () => {
  const ip = '203.0.113.77';
  for (let i = 0; i < 5; i++) assert.equal((await apiSignIn('неверный пароль', ip)).status, 401, `попытка ${i + 1}`);
  assert.equal((await apiSignIn('неверный пароль', ip)).status, 429);
  assert.equal((await apiSignIn(OWNER.password, ip)).status, 429);
  // Другой адрес не задет: бан - адреса, а не учётки (владельца не запереть чужим перебором).
  assert.equal((await apiSignIn(OWNER.password, '203.0.113.78')).status, 200);
});

test('passkey: добавить на странице учётки и войти им без пароля', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Виртуальный ключ Chromium (WebAuthn по CDP): настоящего устройства в CI нет.
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });

  await page.goto(`${hub.origin}/login`);
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль').fill(OWNER.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL(`${hub.origin}/account`);
  await page.getByRole('button', { name: 'Добавить passkey' }).click();
  await page.getByTestId('passkeys').waitFor({ timeout: 10_000 });

  await page.getByTestId('sign-out').click();
  await page.getByTestId('sign-in-link').waitFor();
  await page.goto(`${hub.origin}/login`);
  await page.getByRole('button', { name: 'Войти с passkey' }).click();
  await page.waitForURL(`${hub.origin}/account`, { timeout: 10_000 });
  assert.equal(await page.getByTestId('account-email').textContent(), OWNER.email);
  await context.close();
});
