import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { request as tlsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { checkLayout, cleanEnvironment, inside, testDatabaseUrl, until } from './guards.ts';
import { ManagedProcess, abortResources, launchRuntime } from './process.ts';
import { Collector, TlsProxy, closeServer, listen } from './network.ts';
import { checkAutomaticReferers, checkBearerReferers, checkNoSessionCookies, checkObserved } from './browser.ts';

test('CI-БД: только отдельный loopback/user/database, отклонение другого источника', () => {
  const valid = 'postgres://gf_ci:auth-a-ci-only@127.0.0.1:5432/gf_auth_a';
  assert.equal(testDatabaseUrl(valid), valid);
  for (const value of [undefined, '', 'invalid', valid.replace('127.0.0.1', 'example.test'), valid.replace('gf_auth_a', 'gf'),
    valid.replace('gf_ci:', 'gf:'), valid + '?sslmode=disable', valid.replace('5432', '5433')]) {
    assert.throws(() => testDatabaseUrl(value), /БД|адрес/);
  }
});
test('allowlist окружения не наследует GF/NODE_PATH/токен', () => {
  const saved = { ...process.env };
  try {
    process.env.GF_TEST_UNTRUSTED = 'artificial'; process.env.GITHUB_TOKEN = 'artificial';
    process.env.NODE_OPTIONS = '--trace-warnings'; process.env.NODE_PATH = '/artificial';
    const env = cleanEnvironment({ PORT: '1234' });
    for (const key of ['GF_TEST_UNTRUSTED', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'NODE_PATH']) assert.equal(key in env, false);
    assert.equal(env.PORT, '1234');
  } finally { process.env = saved; }
});
test('layout: внутренние ссылки разрешены, выход/сломанная ссылка запрещены', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gf-layout-unit-'));
  try {
    const layout = join(root, 'layout'); await mkdir(layout);
    await writeFile(join(layout, 'inside'), 'artificial'); await symlink('inside', join(layout, 'ok'));
    await checkLayout(layout);
    assert.equal(inside(layout, layout + '-other/file'), false);
    await writeFile(join(root, 'outside'), 'artificial'); await symlink('../outside', join(layout, 'escape'));
    await assert.rejects(checkLayout(layout), /внешнюю ссылку/);
    await rm(join(layout, 'escape')); await symlink('../absent', join(layout, 'broken'));
    await assert.rejects(checkLayout(layout));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('настоящий дочерний Node: внешний runtime-файл читается в контроле и запрещён с permission model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gf-permission-unit-'));
  try {
    const layout = join(root, 'layout'), fixtures = join(root, 'fixtures');
    await mkdir(layout); await mkdir(fixtures);
    const outside = join(root, 'checkout-fixture'), entry = join(layout, 'probe.cjs');
    await writeFile(outside, 'artificial-checkout');
    await writeFile(entry, `require('node:fs').readFileSync(${JSON.stringify(outside)});`);
    const control = new ManagedProcess(process.execPath, [entry], layout, cleanEnvironment());
    try { assert.equal((await control.completed(2000)).code, 0); } finally { await control.stop(); }
    const child = launchRuntime(layout, fixtures, cleanEnvironment(), entry);
    try { assert.notEqual((await child.completed(2000)).code, 0); assert.equal(child.denied, true); }
    finally { await child.stop(); }
    await writeFile(entry, `require('node:fs').readFileSync(${JSON.stringify(join(fixtures, 'key'))});`);
    await writeFile(join(fixtures, 'key'), 'artificial');
    const allowed = launchRuntime(layout, fixtures, cleanEnvironment(), entry);
    try { assert.equal((await allowed.completed(2000)).code, 0); } finally { await allowed.stop(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('дочерний процесс: ошибка запуска не равна ожидаемому config-отказу', async () => {
  const child = new ManagedProcess('/not-a-real-command', [], tmpdir(), cleanEnvironment());
  assert.equal((await child.completed(2000)).code, null);
  assert.equal(child.denied, false); await child.stop();
});
test('дочерний процесс: timeout и остановка не оставляют живой процесс', async () => {
  const child = new ManagedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmpdir(), cleanEnvironment());
  try { await assert.rejects(child.completed(30), /превысил срок/); }
  finally { await child.stop('SIGKILL'); }
  assert.equal(child.running, false);
});
test('Referer: пустое наблюдение/ошибка HTTP/неверное значение не являются успехом', () => {
  assert.throws(() => checkObserved([], '/probe'), /не поступил/);
  assert.throws(() => checkObserved([{ path: '/probe', status: 500 }], '/probe'), /не поступил/);
  assert.throws(() => checkObserved([{ path: '/probe', status: 200, referer: 'artificial' }], '/probe'), /Referer/);
  checkObserved([{ path: '/probe', status: 200 }], '/probe');
  checkObserved([{ path: '/probe', status: 200, referer: 'control' }], '/probe', 'control');
  assert.throws(() => checkObserved([{ path: '/other', status: 200, referer: 'control' }], '/probe', 'control'), /не поступил/);
});
test('Referer CSS: точный загруженный stylesheet разрешён только объявленному в нём шрифту', () => {
  const origin = 'https://localhost:54321', css = origin + '/_next/static/fonts.css';
  const font = origin + '/fonts/fixture.woff2', tokenUrl = origin + '/account/verify-email?token=' + 'a'.repeat(43);
  const loaded = new Set([css]), sources = [{ font, stylesheet: css }];
  const item = { path: '/fonts/fixture.woff2', referer: css, status: 200 };
  checkAutomaticReferers([item], tokenUrl, loaded, sources);
  checkAutomaticReferers([{ ...item, referer: undefined }], tokenUrl, loaded, sources);
  assert.throws(() => checkAutomaticReferers([item], tokenUrl, new Set(), sources), /неожиданный Referer/);
  assert.throws(() => checkAutomaticReferers([item], tokenUrl, loaded, []), /неожиданный Referer/);
  assert.throws(() => checkAutomaticReferers([{ ...item, referer: origin + '/unrelated.css' }], tokenUrl, loaded, sources), /неожиданный Referer/);
  for (const path of ['/_next/static/app.js', '/_next/static/page.css', '/fonts/other.woff2']) {
    assert.throws(() => checkAutomaticReferers([{ ...item, path }], tokenUrl, loaded, sources), /неожиданный Referer/);
  }
  // Даже разрешённый stylesheet не может стать Referer документа/probe.
  assert.throws(() => checkObserved([{ ...item, path: '/probe' }], '/probe'), /Referer/);
});
test('Referer bearer: token/страница действия запрещены и у шрифта, и вне списка auto', () => {
  const origin = 'https://localhost:54321', token = 'b'.repeat(43), tokenUrl = origin + '/account/reset-password?token=' + token;
  const leakedCss = origin + '/_next/static/fonts.css?token=' + token;
  for (const referer of [tokenUrl, origin + '/account/reset-password', leakedCss, origin + '/other?value=' + token]) {
    const item = { path: '/fonts/fixture.woff2', status: 200, referer };
    assert.throws(() => checkBearerReferers([item], tokenUrl), /token|bearer/);
    assert.throws(() => checkAutomaticReferers([item], tokenUrl, new Set([referer]),
      [{ font: origin + item.path, stylesheet: referer }]), /token|bearer/);
    assert.throws(() => checkBearerReferers([{ ...item, path: '/some-other-request' }], tokenUrl), /token|bearer/);
  }
});

// Потомок намеренно не держит stdout лидера: exit лидера не доказывает cleanup.
async function descendantFixture(leaderExits: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'gf-process-group-unit-'));
  const ready = join(root, 'ready.json'), term = join(root, 'term');
  const descendant = join(root, 'descendant.cjs'), leader = join(root, 'leader.cjs');
  await writeFile(descendant, `const fs = require('node:fs');
    process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(term)}, 'ignored'));
    const server = require('node:net').createServer(s => s.end());
    server.listen(0, '127.0.0.1', () => {
      fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({pid:process.pid,port:server.address().port}));
      process.send('ready');
    });`);
  await writeFile(leader, `const child = require('node:child_process').spawn(process.execPath, [${JSON.stringify(descendant)}],
    {detached:false,stdio:['ignore','ignore','ignore','ipc']});
    child.on('message', () => { ${leaderExits ? 'process.exit(0);' : "process.on('SIGTERM', () => process.exit(0)); child.disconnect();"} });`);
  const child = new ManagedProcess(process.execPath, [leader], root, cleanEnvironment());
  try {
    let data: { pid: number; port: number } | undefined;
    await until(async () => {
      try { data = JSON.parse(await readFile(ready, 'utf8')); return true; } catch { return false; }
    }, 'потомок не сообщил готовность', 2000);
    if (leaderExits) assert.equal((await child.completed(2000)).code, 0);
    // Сначала доказываем наличие слушателя, иначе освобождение порта ничего не значит.
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: data!.port });
      socket.once('connect', () => { socket.destroy(); resolve(); }); socket.once('error', reject);
    });
    return { child, data: data!, term, async cleanup() {
      // Независимая страховка теста, в том числе для старого кода/мутаций.
      try { if (child.child.pid) process.kill(-child.child.pid, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      await child.completed(2000); await rm(root, { recursive: true, force: true });
    } };
  } catch {
    try { if (child.child.pid) process.kill(-child.child.pid, 'SIGKILL'); } catch { /* только аварийная страховка fixture */ }
    await child.completed(2000); await rm(root, { recursive: true, force: true });
    throw new Error('не создан синтетический потомок');
  }
}
async function freedPort(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve());
  });
  await new Promise<void>(resolve => server.close(() => resolve()));
}
async function descendantStopped(pid: number) {
  await until(async () => {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      return ['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]!);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
  }, 'потомок всё ещё исполняется', 1000);
}
for (const leaderExits of [true, false]) {
  test(`группа: лидер ${leaderExits ? 'уже вышел' : 'выходит по TERM'}, потомок игнорирует TERM`, { timeout: 5000 }, async () => {
    const fixture = await descendantFixture(leaderExits);
    try {
      // После TERM stop обязан дойти до ограниченного KILL всей группы. Ошибка
      // graceful-deadline сохраняется, но потомок и порт уже должны быть убраны.
      await assert.rejects(fixture.child.stop('SIGTERM', 150), /штатная остановка превысила срок/);
      assert.equal(await readFile(fixture.term, 'utf8'), 'ignored');
      await descendantStopped(fixture.data.pid);
      await freedPort(fixture.data.port);
    } finally { await fixture.cleanup(); }
  });
}
test('abort cleanup: KILL завершает группу после выхода лидера и освобождает порт', { timeout: 5000 }, async () => {
  const fixture = await descendantFixture(true);
  try {
    await abortResources([fixture.child], []);
    await descendantStopped(fixture.data.pid);
    await freedPort(fixture.data.port);
  } finally { await fixture.cleanup(); }
});
test('cleanup: ошибка одной задачи не скрывается и не отменяет остальные', async () => {
  let completed = 0;
  await assert.rejects(abortResources([
    { stop: async signal => { assert.equal(signal, 'SIGKILL'); completed++; throw new Error('artificial async failure'); } },
    { stop: async () => { completed++; return { code: 0, signal: null }; } },
  ], [() => { throw new Error('artificial synchronous failure'); }]), /не все ресурсы стенда очищены/);
  assert.equal(completed, 2);
});
test('отсутствие сессии: проверяется реальное имя cookie хаба, в том числе chunk', () => {
  checkNoSessionCookies([{ name: '__Host-gf-csrf' }]);
  assert.throws(() => checkNoSessionCookies([{ name: '__Host-gf-session' }]), /сессию/);
  assert.throws(() => checkNoSessionCookies([{ name: '__Host-gf-session.0' }]), /сессию/);
});
test('collector: настоящий HTTP, auth/schema, удержание, исход и reset', async () => {
  const origin = 'https://localhost:54321', secret = 'a'.repeat(64), collector = new Collector(secret, () => origin);
  const port = await listen(collector.server);
  const body = JSON.stringify({ kind: 'verify-email.v1', operationId: randomUUID(), to: 'fixture@example.test', url: origin + '/account/verify-email?token=' + 'a'.repeat(43) });
  try {
    collector.hold = true; let checked = false;
    collector.beforeReply = async item => { assert.equal(item.body === body, true); checked = true; };
    const reply = fetch(`http://127.0.0.1:${port}/v1/send`, { method: 'POST',
      headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json', 'x-gf-mail-expires-at': String(Date.now() + 60_000) }, body });
    const received = await collector.received(1);
    await until(async () => checked, 'проверка collector не вызвана', 1000);
    assert.equal(collector.active, 1); received.reply();
    const response = await reply; assert.equal(response.status, 202);
    assert.equal((await response.json()).outcome, 'accepted');
    await collector.reset(); assert.equal(collector.messages.length, 0);
    const rejected = await fetch(`http://127.0.0.1:${port}/v1/send`, { method: 'POST', body,
      headers: { authorization: 'Bearer ' + 'z'.repeat(64), 'content-type': 'application/json', 'x-gf-mail-expires-at': String(Date.now() + 60_000) } });
    assert.equal(rejected.status, 400); assert.equal(collector.error, true); assert.equal(collector.messages.length, 0);
  } finally { await closeServer(collector.server); }
});
test('collector: chunked oversized без EOF отвергается до накопления', async () => {
  const collector = new Collector('b'.repeat(64), () => 'https://localhost');
  const port = await listen(collector.server);
  try {
    await new Promise<void>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/v1/send', method: 'POST', headers: {
        authorization: 'Bearer ' + 'b'.repeat(64), 'content-type': 'application/json' } }, res => {
        try { assert.equal(res.statusCode, 400); resolve(); } catch (error) { reject(error); }
        finally { req.destroy(); }
      });
      req.on('error', error => { if (!req.destroyed) reject(error); });
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('collector не ограничил тело')); });
      req.write('x'.repeat(16_385));
    });
    assert.equal(collector.error, true); assert.equal(collector.messages.length, 0);
  } finally { await closeServer(collector.server); }
});
test('CI: отдельный job без публикации, без изменения прежних jobs', async () => {
  const yaml = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = yaml.split('  auth-a-integration:')[1]!.split('\n  mail-image:')[0]!;
  assert.match(job, /persist-credentials: false/); assert.match(job, /contents: read/);
  assert.doesNotMatch(job, /packages:|actions:|secrets\.|docker build/);
  assert.match(job, /GF_AUTH_INTEGRATION_PG: postgres:\/\/gf_ci:/);
  assert.match(job, /pnpm test:auth-integration/);
});

test('HTTPS: proxy передаёт реальный Host/proto и наблюдает probe/Referer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gf-tls-unit-'));
  const { createServer } = await import('node:http');
  const upstream = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ host: req.headers.host, proto: req.headers['x-forwarded-proto'] }));
  });
  let proxy: TlsProxy | undefined;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-keyout', join(root, 'key'), '-out', join(root, 'cert')], { env: cleanEnvironment(), stdio: 'pipe', timeout: 5000 });
    proxy = new TlsProxy(await readFile(join(root, 'cert')), await readFile(join(root, 'key')));
    proxy.target = await listen(upstream); await proxy.start();
    const get = (path: string, referer?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = tlsRequest({ hostname: '127.0.0.1', port: proxy!.port, path, rejectUnauthorized: false,
        headers: referer ? { referer } : {} }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      });
      req.setTimeout(2000, () => req.destroy(new Error('TLS timeout'))); req.on('error', reject); req.end();
    });
    const response = await get('/runtime');
    assert.deepEqual(JSON.parse(response.body), { host: new URL(proxy.origin).host, proto: 'https' });
    assert.equal((await get('/__probe/control', 'https://control.example/')).status, 200);
    checkObserved(proxy.observations, '/__probe/control', 'https://control.example/');
    assert.equal((await get('/__probe/empty')).status, 200);
    checkObserved(proxy.observations, '/__probe/empty');
    assert.equal((await get('/__control')).status, 200);
  } finally {
    if (proxy) await closeServer(proxy.server);
    await closeServer(upstream); await rm(root, { recursive: true, force: true });
  }
});
