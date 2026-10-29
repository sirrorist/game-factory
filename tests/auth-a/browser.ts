import { chromium, type BrowserContext, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { cleanEnvironment, requireCheck, until } from './guards.ts';
import type { Stand } from './standalone.ts';
import type { Fixture } from '../../packages/db/test/auth-integration-fixtures.ts';

export const actionPath = (purpose: 'verify' | 'reset') => purpose === 'verify' ? '/account/verify-email' : '/account/reset-password';
export const apiPath = (purpose: 'verify' | 'reset', action = 'request') =>
  `/api/account/${purpose === 'verify' ? 'email-confirmation' : 'password-reset'}/${action}`;

export async function withBrowser(stand: Stand, run: (context: BrowserContext, page: Page) => Promise<void>) {
  const server = await chromium.launchServer({ host: '127.0.0.1', headless: true, timeout: 10_000,
    env: cleanEnvironment() as Record<string, string> });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([server.close(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('browser shutdown timeout')), 5000);
      })]);
    } catch { await server.kill(); }
    finally { clearTimeout(timer); }
  })();
  stand.browserClosers.add(close);
  let external = false;
  try {
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: 5000 });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
    context.setDefaultTimeout(8000); context.setDefaultNavigationTimeout(10_000);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (![stand.origin, stand.probe.origin].includes(url.origin)) { external = true; await route.abort(); }
      else await route.continue();
    });
    await run(context, await context.newPage());
    requireCheck(!external, 'страница запросила внешний ресурс');
  } finally { await close(); stand.browserClosers.delete(close); }
}
export async function csrf(context: BrowserContext, origin: string) {
  const cookie = (await context.cookies(origin)).find(c => c.name === '__Host-gf-csrf');
  requireCheck(cookie?.secure && cookie.path === '/' && cookie.sameSite === 'Strict', 'нет настоящей Secure CSRF-cookie');
  return cookie.value;
}
export async function post(context: BrowserContext, stand: Stand, path: string, data: object,
  variant: 'valid' | 'no-origin' | 'foreign-origin' | 'no-csrf' | 'bad-csrf' = 'valid') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (variant !== 'no-origin') headers.origin = variant === 'foreign-origin' ? stand.probe.origin : stand.origin;
  if (variant !== 'no-csrf') headers['x-gf-csrf'] = variant === 'bad-csrf' ? 'bad-synthetic-csrf' : await csrf(context, stand.origin);
  return context.request.post(stand.origin + path, { headers, data, timeout: 8000, maxRedirects: 0 });
}
export async function login(context: BrowserContext, stand: Stand, fixture: Fixture, password = fixture.password) {
  await context.request.get(stand.origin + '/login');
  return post(context, stand, '/api/auth/sign-in/email', { email: fixture.email, password });
}
export async function requestLink(page: Page, stand: Stand, purpose: 'verify' | 'reset', email: string) {
  const response = await page.goto(stand.origin + actionPath(purpose));
  requireCheck(response?.status() === 200, 'нет SSR-страницы запроса');
  // Поле присутствует в исходном HTML, а не появляется только после hydration.
  requireCheck((await response.text()).includes('name="email"'), 'нет SSR email формы');
  await page.getByRole('textbox', { name: 'Почта', exact: true }).fill(email);
  const [sent, received] = await Promise.all([
    page.waitForRequest(req => new URL(req.url()).pathname === apiPath(purpose) && req.method() === 'POST'),
    page.waitForResponse(res => new URL(res.url()).pathname === apiPath(purpose) && res.request().method() === 'POST'),
    page.getByRole('button', { name: 'Запросить письмо', exact: true }).click(),
  ]);
  requireCheck(received.status() === 202 && (await received.json()).code === 'request_received', 'форма не получила независимый публичный ответ');
  await page.getByRole('status').filter({ hasText: 'Если действие доступно' }).waitFor();
  return JSON.parse(sent.postData()!) as { email: string; intent: string };
}
export async function consume(page: Page, purpose: 'verify' | 'reset', password?: string) {
  if (purpose === 'reset') await page.getByLabel('Новый пароль', { exact: true }).fill(password!);
  await page.getByRole('button', { name: purpose === 'verify' ? 'Подтвердить почту' : 'Сохранить пароль', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Готово.' }).waitFor();
}
export function checkNoSessionCookies(cookies: { name: string }[]) {
  requireCheck(!cookies.some(c => c.name === '__Host-gf-session' || c.name.startsWith('__Host-gf-session.')), 'действие выдало сессию');
}
export async function noSession(context: BrowserContext, stand: Stand) {
  checkNoSessionCookies(await context.cookies());
  requireCheck(!await sessionUser(context, stand), 'consume оставил действующую сессию');
}
export async function sessionUser(context: BrowserContext, stand: Stand): Promise<string | undefined> {
  const response = await context.request.get(stand.origin + '/api/auth/get-session');
  requireCheck(response.status() === 200, 'не удалось проверить текущую сессию');
  const value = await response.json();
  return value?.user?.id;
}

export function checkObserved(requests: { path: string; referer?: string; status: number }[], expectedPath: string, expectedReferer?: string) {
  const matching = requests.filter(item => item.path === expectedPath && item.status === 200);
  requireCheck(matching.length > 0, 'ожидаемый запрос не поступил сборщику');
  requireCheck(matching.every(item => item.referer === expectedReferer), 'неожиданный Referer');
}
type ResourceObservation = { path: string; referer?: string; status: number };
export type FontSource = { font: string; stylesheet: string };
export function checkBearerReferers(requests: ResourceObservation[], tokenUrl: string) {
  const token = new URL(tokenUrl).searchParams.get('token');
  requireCheck(token, 'нет token у проверяемой ссылки');
  for (const item of requests) {
    if (!item.referer) continue;
    let url: URL;
    try { url = new URL(item.referer); } catch { throw new Error('неверный Referer'); }
    requireCheck(!item.referer.includes(token) && !url.searchParams.has('token') &&
      !['/account/verify-email', '/account/reset-password'].includes(url.pathname), 'Referer содержит token/страницу bearer');
  }
}
export function checkAutomaticReferers(requests: ResourceObservation[], tokenUrl: string,
  loadedStylesheets: ReadonlySet<string>, sources: FontSource[]) {
  checkBearerReferers(requests, tokenUrl);
  const origin = new URL(tokenUrl).origin;
  for (const item of requests) {
    if (!item.referer) continue;
    // У CSS-зависимого шрифта referrer — stylesheet, а не документ. Разрешён
    // только точный реально загруженный CSS, в котором объявлен этот font URL.
    const allowed = item.path.endsWith('.woff2') && sources.some(source => {
      const style = new URL(source.stylesheet), font = new URL(source.font);
      return style.origin === origin && font.origin === origin && font.pathname === item.path &&
        style.pathname.endsWith('.css') && !style.hash && source.stylesheet === item.referer &&
        loadedStylesheets.has(source.stylesheet);
    });
    requireCheck(allowed, 'неожиданный Referer автоматического ресурса');
  }
}
export async function refererScenario(stand: Stand, tokenUrl: string) {
  await withBrowser(stand, async (_context, page) => {
    // Наблюдение и route установлены до navigation, browser context всегда новый.
    const start = stand.proxy.observations.length, probeStart = stand.probe.observations.length;
    const resources = new Set<string>(), stylesheets = new Set<string>();
    page.on('response', response => {
      const url = new URL(response.url());
      if (response.ok() && url.origin === stand.origin) {
        if (url.pathname.endsWith('.css')) { resources.add('css'); stylesheets.add(url.href); }
        if (url.pathname.endsWith('.js')) resources.add('js');
        if (url.pathname.endsWith('.woff2')) resources.add('font');
      }
    });
    const response = await page.goto(tokenUrl, { waitUntil: 'networkidle' });
    requireCheck(response?.status() === 200, 'token страница не открылась');
    const headers = response.headers();
    requireCheck(headers['referrer-policy'] === 'no-referrer' && headers['cache-control']?.includes('no-store') &&
      headers['x-robots-tag']?.includes('noindex'), 'неверные итоговые HTTP headers');
    checkObserved(stand.proxy.observations.slice(start), new URL(tokenUrl).pathname);
    await page.evaluate(async () => { await document.fonts.ready; });
    await until(async () => ['css', 'js', 'font'].every(type => resources.has(type)), 'не загружены реальные CSS/JS/fonts');
    const auto = stand.proxy.observations.slice(start).filter(item => /\.(css|js|woff2)$/.test(item.path));
    requireCheck(['css', 'js', 'woff2'].every(ext => auto.some(item => item.path.endsWith('.' + ext) && item.status === 200)), 'нет серверного наблюдения автоматических ресурсов');
    const sources = await page.evaluate(() => {
      const result: { font: string; stylesheet: string }[] = [];
      function rules(list: CSSRuleList, stylesheet: string) {
        for (const rule of list) {
          if (rule instanceof CSSFontFaceRule) {
            for (const match of rule.style.getPropertyValue('src').matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
              result.push({ font: new URL(match[1]!, stylesheet).href, stylesheet });
            }
          } else if (rule instanceof CSSImportRule && rule.styleSheet?.href) rules(rule.styleSheet.cssRules, rule.styleSheet.href);
          else if ('cssRules' in rule) rules((rule as CSSGroupingRule).cssRules, stylesheet);
        }
      }
      for (const sheet of document.styleSheets) if (sheet.href) rules(sheet.cssRules, sheet.href);
      return result;
    });
    checkAutomaticReferers(auto, tokenUrl, stylesheets, sources);
    const samePath = '/__probe/' + randomUUID(), crossPath = '/__probe/' + randomUUID();
    await page.evaluate(async ([same, cross]) => {
      for (const url of [same!, cross!]) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('probe'); }
    }, [stand.origin + samePath, stand.probe.origin + crossPath]);
    checkObserved(stand.proxy.observations.slice(start), samePath);
    checkObserved(stand.probe.observations.slice(probeStart), crossPath);
    checkBearerReferers([...stand.proxy.observations.slice(start), ...stand.probe.observations.slice(probeStart)], tokenUrl);
    // Контроль канала: другая страница обязана передать известный НЕсекретный Referer.
    const control = stand.origin + '/__control', positive = '/__probe/' + randomUUID();
    await page.goto(control);
    await page.evaluate(async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('control'); }, stand.probe.origin + positive);
    checkObserved(stand.probe.observations.slice(probeStart), positive, control);
  });
}
