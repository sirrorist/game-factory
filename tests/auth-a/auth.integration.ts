// Отдельная команда/CI job. Общий pnpm test эти production/browser-сценарии не запускает.
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { setup } from './standalone.ts';
import { ManagedProcess } from './process.ts';
import { cleanEnvironment, requireCheck, safeCase, until } from './guards.ts';
import { actionPath, apiPath, consume, csrf, login, noSession, post, refererScenario, requestLink, sessionUser, withBrowser } from './browser.ts';

test('закрытый A: настоящий standalone/PG/HTTPS/Chromium', { timeout: 1_140_000 }, async t => {
  let stand: Awaited<ReturnType<typeof setup>> | undefined;
  await safeCase(async () => { stand = await setup(); });
  const s = stand!;
  t.after(() => s.cleanup());
  // abort сохраняет факт ошибки для окончательного cleanup, не оставляя rejected
  // promise без обработчика в EventTarget (его возврат не ожидает Node test).
  const interrupted = () => { void s.abort().catch(() => {}); };
  t.signal.addEventListener('abort', interrupted, { once: true });
  async function reset() { await s.collector.reset(); await s.db.clear(); }
  async function state(id: string, expected: string) {
    await until(async () => (await s.db.operation(id))?.state === expected, 'не получено ожидаемое состояние операции');
    requireCheck(!s.collector.error, 'collector выявил несовпадение committed-снимка');
  }
  // Любая ошибка Playwright/SQL скрывается; в TAP остаётся название сценария.
  const scenario = (title: string, fn: () => Promise<void>, timeout = 20_000) =>
    t.test(title, { timeout }, async context => {
      context.signal.addEventListener('abort', interrupted, { once: true });
      try { await safeCase(fn); } finally { context.signal.removeEventListener('abort', interrupted); }
    });
  try {
    await scenario('standalone: намеренная абсолютная зависимость вне layout запрещена', async () => {
      const outside = join(s.root, 'external-fixture'), entry = join(s.layout, 'dependency-probe.cjs');
      await writeFile(outside, 'artificial-external-file');
      await writeFile(entry, `require('node:fs').readFileSync(${JSON.stringify(outside)});`);
      const control = new ManagedProcess(process.execPath, [entry], s.layout, cleanEnvironment());
      try { requireCheck((await control.completed(2000)).code === 0, 'положительный контроль внешней зависимости не выполнен'); }
      finally { await control.stop(); }
      const server = await s.start({ entry });
      try { requireCheck((await server.child.completed(2000)).code !== 0 && server.child.denied, 'Node не запретил внешнюю зависимость'); }
      finally { await server.stop(); }
    });
    for (const dispatch of [false, true]) {
      await scenario(`runtime: API off, dispatcher ${dispatch ? 'on' : 'off'}, ключ не читается`, async () => {
        await reset();
        const fixture = await s.db.fixture(), pending = await s.db.seed(fixture.email, 'verify');
        const server = await s.start({ dispatch, key: 'missing' });
        try {
          await server.ready();
          await withBrowser(s, async (context, page) => {
            for (const purpose of ['verify', 'reset'] as const) {
              requireCheck((await page.goto(s.origin + actionPath(purpose)))?.status() === 404, 'выключенная страница открылась');
              for (const action of ['request', 'consume']) {
                requireCheck((await post(context, s, apiPath(purpose, action), {})).status() === 404, 'выключенный API открылся');
              }
            }
          });
          await new Promise(resolve => setTimeout(resolve, 1200));
          requireCheck(s.collector.messages.length === 0 && (await s.db.operation(pending.id))?.state === 'pending', 'выключенный диспетчер обработал pending');
        } finally { await server.stop(); }
      }, 30_000);
    }
    await scenario('runtime: только API, hydration/submit сохраняют pending без отправки', async () => {
      await reset(); const fixture = await s.db.fixture();
      const server = await s.start({ api: true });
      try {
        await server.ready();
        await withBrowser(s, async (_context, page) => { await requestLink(page, s, 'verify', fixture.email); });
        await new Promise(resolve => setTimeout(resolve, 1200));
        requireCheck((await s.db.operations()).some(op => op.state === 'pending') && s.collector.messages.length === 0, 'API-only начал отправку');
      } finally { await server.stop(); }
    });
    for (const key of ['missing', 'bad-key'] as const) {
      await scenario(`runtime: оба флага, ${key}, конфигурация отвергнута до readiness`, async () => {
        await reset(); const server = await s.start({ api: true, dispatch: true, key });
        try {
          const exit = await server.child.completed(10_000);
          requireCheck(exit.code !== 0 && exit.code !== null && !server.child.denied, 'не подтверждён отказ именно конфигурации');
          requireCheck(key === 'missing'
            ? server.child.hasOutput('ENOENT') && server.child.hasOutput(join(s.fixtures, 'missing'))
            : server.child.hasOutput('нужен отдельный ключ почты из 32 байт'), 'нет ожидаемой диагностики ключа');
          requireCheck(s.collector.messages.length === 0, 'отправка с неверным ключом');
        } finally { await server.stop(); }
      });
    }
    await scenario('instrumentation: autoload и committed prepared до HTTP без auth-запросов', async () => {
      await reset(); const fixture = await s.db.fixture(), pending = await s.db.seed(fixture.email, 'verify');
      s.collector.beforeReply = item => s.db.committed(item.body, item.expiresAt);
      const server = await s.start({ api: true, dispatch: true });
      try {
        await server.ready(); const received = await s.collector.received(1);
        requireCheck(received.mail.operationId === pending.id, 'autoload сменил ID');
        await state(pending.id, 'accepted');
        requireCheck(s.collector.messages.length === 1, 'повтор autoload');
      } finally { await server.stop(); }
    });
    for (const purpose of ['verify', 'reset'] as const) {
      await scenario(`браузер ${purpose}: SSR, hydration, независимый ответ, GET/POST и одноразовость`, async () => {
        await reset(); const fixture = await s.db.fixture({ verified: purpose === 'reset' });
        if (purpose === 'reset') await s.db.oldCredentials(fixture.id);
        s.collector.hold = true;
        s.collector.beforeReply = item => s.db.committed(item.body, item.expiresAt);
        const server = await s.start({ api: true, dispatch: true });
        try {
          await server.ready();
          await withBrowser(s, async (context, page) => {
            const sent = await requestLink(page, s, purpose, fixture.email);
            const mail = await s.collector.received(1);
            requireCheck(s.collector.active === 1, 'независимость ответа request от доставки не проверена');
            const before = await s.db.operation(mail.mail.operationId);
            requireCheck(before?.state === 'started' && before.actionId, 'нет started');
            // Повтор точно того же intent, затем новое явное действие через UI.
            requireCheck((await post(context, s, apiPath(purpose), sent)).status() === 202, 'повтор intent не принят');
            requireCheck((await s.db.operations()).length === 1, 'повтор intent создал операцию');
            await page.getByRole('button', { name: 'Запросить новую ссылку', exact: true }).click();
            await page.getByRole('textbox', { name: 'Почта', exact: true }).fill(fixture.email);
            const [nextRequest, nextResponse] = await Promise.all([
              page.waitForRequest(req => new URL(req.url()).pathname === apiPath(purpose) && req.method() === 'POST'),
              page.waitForResponse(res => new URL(res.url()).pathname === apiPath(purpose)),
              page.getByRole('button', { name: 'Запросить письмо', exact: true }).click(),
            ]);
            const freshIntent = JSON.parse(nextRequest.postData()!).intent;
            requireCheck(freshIntent !== sent.intent && nextResponse.status() === 202, 'явное действие не создало нового intent');
            mail.reply(); await state(mail.mail.operationId, 'accepted');
            const url = mail.mail.url;
            await context.request.get(url); await page.goto(url); await page.reload();
            requireCheck((await s.db.action(before.actionId))?.consumedAt === null, 'GET/preview потребил token');
            requireCheck((await s.db.member(fixture.id)).emailVerified === (purpose === 'reset'), 'GET изменил emailVerified');
            const replacement = randomBytes(24).toString('base64url');
            await consume(page, purpose, replacement);
            requireCheck((await s.db.action(before.actionId))?.consumedAt instanceof Date, 'POST не потребил token');
            await noSession(context, s);
            const bearer = new URL(url).searchParams.get('token');
            const again = await post(context, s, apiPath(purpose, 'consume'), { token: bearer, ...(purpose === 'reset' ? { password: replacement } : {}) });
            requireCheck(again.status() === 400, 'повторное потребление прошло');
            const member = await s.db.member(fixture.id);
            requireCheck(member.emailVerified && member.role === 'user' && await s.db.gameDataIntact(fixture.id), 'consume изменил лишние данные/права');
            if (purpose === 'reset') {
              requireCheck(await s.db.credentialsGone(fixture.id), 'reset сохранил старые credentials');
              requireCheck((await login(context, s, fixture)).status() === 401, 'старый пароль работает');
              requireCheck((await login(context, s, fixture, replacement)).status() === 200, 'новый пароль не работает');
            }
          });
        } finally { await server.stop(); }
      }, 30_000);
      await scenario(`браузер ${purpose}: headers, ранние ресурсы и доказательный Referer`, async () => {
        await reset(); const fixture = await s.db.fixture(), pending = await s.db.seed(fixture.email, purpose);
        const server = await s.start({ api: true, dispatch: true });
        try {
          await server.ready(); const received = await s.collector.received(1); await state(pending.id, 'accepted');
          await refererScenario(s, received.mail.url);
        } finally { await server.stop(); }
      });
      await scenario(`браузер ${purpose}: сессия B не потребляет ссылку A, чистый context применяет`, async () => {
        await reset(); const a = await s.db.fixture(), b = await s.db.fixture();
        const pending = await s.db.seed(a.email, purpose);
        const server = await s.start({ api: true, dispatch: true });
        try {
          await server.ready(); const mail = await s.collector.received(1); await state(pending.id, 'accepted');
          const record = await s.db.operation(pending.id);
          await withBrowser(s, async (context, page) => {
            requireCheck((await login(context, s, b)).status() === 200, 'не выполнен вход B');
            requireCheck(await sessionUser(context, s) === b.id, 'нет исходной сессии B');
            await page.goto(mail.mail.url);
            if (purpose === 'reset') await page.getByLabel('Новый пароль', { exact: true }).fill(randomBytes(24).toString('base64url'));
            await page.getByRole('button', { name: purpose === 'verify' ? 'Подтвердить почту' : 'Сохранить пароль', exact: true }).click();
            await page.getByRole('status').filter({ hasText: 'Выйдите из другой' }).waitFor();
            requireCheck((await s.db.action(record!.actionId!))?.consumedAt === null, 'conflict потребил ссылку A');
            requireCheck(await sessionUser(context, s) === b.id, 'conflict сменил учётку B');
          });
          await withBrowser(s, async (context, page) => {
            await page.goto(mail.mail.url); await consume(page, purpose, randomBytes(24).toString('base64url')); await noSession(context, s);
          });
        } finally { await server.stop(); }
      }, 30_000);
    }
    await scenario('прямой HTTP: Origin/CSRF, закрытые Better Auth пути и регистрация', async () => {
      await reset(); const server = await s.start({ api: true, dispatch: true });
      try {
        await server.ready();
        await withBrowser(s, async (context, page) => {
          await page.goto(s.origin + actionPath('verify'));
          for (const purpose of ['verify', 'reset'] as const) for (const action of ['request', 'consume']) {
            for (const variant of ['no-origin', 'foreign-origin', 'no-csrf', 'bad-csrf'] as const) {
              const before = await s.db.fingerprint();
              requireCheck((await post(context, s, apiPath(purpose, action), {}, variant)).status() === 403, 'не получен реальный HTTP отказ CSRF');
              requireCheck(before === await s.db.fingerprint(), 'отказ CSRF изменил БД');
            }
          }
          const fixture = await s.db.fixture();
          const password = randomBytes(24).toString('base64url');
          for (const [path, data] of [
            ['request-password-reset', { email: fixture.email, redirectTo: s.origin + '/login' }],
            ['reset-password', { token: 'synthetic-library-token', newPassword: password }],
            ['send-verification-email', { email: fixture.email, callbackURL: s.origin + '/login' }],
          ] as const) {
            const before = await s.db.fingerprint();
            const response = await post(context, s, '/api/auth/' + path, data);
            requireCheck(response.status() === 403 && (await response.json()).message === 'используйте платформенное действие', 'альтернативный POST не закрыт явным guard');
            requireCheck(before === await s.db.fingerprint(), 'альтернативный auth путь изменил БД');
          }
          for (const path of ['/verify-email?token=synthetic-library-token', '/reset-password/synthetic-library-token?callbackURL=' + encodeURIComponent(s.origin + '/login')]) {
            const response = await context.request.get(s.origin + '/api/auth' + path, { maxRedirects: 0 });
            requireCheck(response.status() === 403 && (await response.json()).message === 'используйте платформенное действие', 'альтернативный GET не закрыт явным guard');
          }
          const beforeSignup = await s.db.fingerprint();
          const signup = await post(context, s, '/api/auth/sign-up/email', { name: 'Искусственный новый игрок',
            email: 'signup-disabled@example.test', password });
          requireCheck(signup.status() === 400 && (await signup.json()).code === 'EMAIL_PASSWORD_SIGN_UP_DISABLED', 'регистрация не закрыта конфигурацией');
          requireCheck(beforeSignup === await s.db.fingerprint(), 'закрытая регистрация изменила БД');
          await csrf(context, s.origin);
          requireCheck(s.collector.messages.length === 0, 'закрытые пути отправили письмо');
        });
      } finally { await server.stop(); }
    }, 30_000);
    await scenario('expiry/revoke/admin/owner/guard перепроверяются при consume', async () => {
      await reset(); const server = await s.start({ api: true, dispatch: true });
      try {
        await server.ready();
        await withBrowser(s, async (context, page) => {
          await page.goto(s.origin + actionPath('reset'));
          for (const mode of ['expired', 'revoked', 'admin', 'owner', 'guard'] as const) {
            const expected = s.collector.messages.length + 1;
            const fixture = await s.db.fixture(), pending = await s.db.seed(fixture.email, 'reset');
            const mail = await s.collector.received(expected); await state(pending.id, 'accepted');
            const op = await s.db.operation(pending.id);
            if (mode === 'expired') await s.db.expired(op!.actionId!);
            else if (mode === 'revoked') await s.db.revoked(op!.actionId!);
            else await s.db.strengthen(fixture.id, mode);
            const r = await post(context, s, apiPath('reset', 'consume'), { token: new URL(mail.mail.url).searchParams.get('token'), password: randomBytes(24).toString('base64url') });
            requireCheck(r.status() === 400, 'ограниченная ссылка была принята');
            const action = await s.db.action(op!.actionId!);
            requireCheck((!action || action.consumedAt === null) && await s.db.passwordUnchanged(fixture), 'запрещённое действие потреблено/изменило пароль');
          }
        });
      } finally { await server.stop(); }
    }, 30_000);
    await scenario('запрос reset: unknown/admin/owner/guard дают тот же ответ и нет отправки', async () => {
      await reset(); const server = await s.start({ api: true, dispatch: true });
      try {
        await server.ready();
        const targets = ['unknown@example.test'];
        for (const role of ['admin', 'owner'] as const) targets.push((await s.db.fixture({ role })).email);
        targets.push((await s.db.fixture({ guard: true })).email);
        for (const email of targets) await withBrowser(s, async (_context, page) => { await requestLink(page, s, 'reset', email); });
        await until(async () => (await s.db.operations()).every(op => op.state === 'suppressed'), 'диспетчер не подавил недоступные учётки');
        requireCheck(s.collector.messages.length === 0, 'недоступная учётка получила письмо');
      } finally { await server.stop(); }
    }, 30_000);
    await scenario('dispatcher: максимум два активных HTTP, исходы и обрыв без повтора', async () => {
      await reset(); const pending = [];
      for (let n = 0; n < 4; n++) pending.push(await s.db.seed((await s.db.fixture()).email, 'verify'));
      s.collector.hold = true;
      s.collector.beforeReply = item => s.db.committed(item.body, item.expiresAt);
      const server = await s.start({ api: true, dispatch: true });
      try {
        await server.ready(); await s.collector.received(2);
        await new Promise(resolve => setTimeout(resolve, 1200));
        requireCheck(s.collector.messages.length === 2 && s.collector.active === 2 && s.collector.peak === 2, 'не подтверждён предел двух HTTP');
        s.collector.messages[0]!.reply(); s.collector.messages[1]!.reply('not_accepted');
        const third = await s.collector.received(3), fourth = await s.collector.received(4);
        third.reply('unknown'); fourth.cut();
        await state(s.collector.messages[0]!.mail.operationId, 'accepted');
        await state(s.collector.messages[1]!.mail.operationId, 'not_accepted');
        await state(third.mail.operationId, 'unknown'); await state(fourth.mail.operationId, 'unknown');
        await new Promise(resolve => setTimeout(resolve, 1200));
        requireCheck(Number(s.collector.messages.length) === 4 && s.collector.peak === 2 &&
          new Set(s.collector.messages.map(item => item.mail.operationId)).size === 4, 'после исхода был повтор');
      } finally { await server.stop(); }
    }, 30_000);
    await scenario('restart pending: тот же ID/createdAt после включения dispatcher', async () => {
      await reset(); const pending = await s.db.seed((await s.db.fixture()).email, 'verify');
      let server = await s.start({ api: true });
      try { await server.ready(); requireCheck(s.collector.messages.length === 0, 'отправка в API-only'); }
      finally { await server.stop(); }
      s.collector.beforeReply = item => s.db.committed(item.body, item.expiresAt);
      server = await s.start({ api: true, dispatch: true });
      try {
        await server.ready(); const mail = await s.collector.received(1); await state(pending.id, 'accepted');
        requireCheck(mail.mail.operationId === pending.id && (await s.db.operation(pending.id))?.createdAt.getTime() === pending.createdAt.getTime(), 'restart заменил логическую отправку');
      } finally { await server.stop(); }
    }, 30_000);
    for (const signal of ['SIGKILL', 'SIGTERM'] as const) {
      await scenario(`${signal}: committed started после остановки становится unknown без resend`, async () => {
        await reset(); const pending = await s.db.seed((await s.db.fixture()).email, 'verify');
        s.collector.hold = true;
        let server = await s.start({ api: true, dispatch: true });
        try {
          await server.ready(); await s.collector.received(1); await state(pending.id, 'started');
          // Останавливаем выполнение до создания второй fixture: таймер не может
          // захватить её раньше проверяемого сигнала завершения.
          server.child.signal('SIGSTOP');
          const next = await s.db.seed((await s.db.fixture()).email, 'verify');
          if (signal === 'SIGTERM') {
            server.child.signal('SIGTERM'); server.child.signal('SIGCONT');
            await server.child.completed(10_000);
          } else await server.stop(signal);
          requireCheck(s.collector.messages.length === 1 && (await s.db.operation(next.id))?.state === 'pending', 'захват после начала остановки');
          // Состариваем только startedAt; pending остаётся независимой отправкой.
          await s.db.stale(pending.id);
          server = await s.start({ api: true, dispatch: true });
          try {
            await server.ready(); await state(pending.id, 'unknown');
            // Следующая независимая операция может отправиться; старая — никогда.
            await s.collector.received(2);
            requireCheck(s.collector.messages.filter(item => item.mail.operationId === pending.id).length === 1, 'started была отправлена повторно');
            s.collector.messages[1]!.reply(); await state(next.id, 'accepted');
          } finally { await server.stop(); }
        } finally { await server.stop('SIGKILL'); }
      }, 30_000);
    }
  } finally { t.signal.removeEventListener('abort', interrupted); await s.cleanup(); }
});
