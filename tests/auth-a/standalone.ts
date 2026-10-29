import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { checkLayout, cleanEnvironment, requireCheck, testDatabaseUrl, until } from './guards.ts';
import { ManagedProcess, abortResources, command, expectConfigurationRejection, launchRuntime } from './process.ts';
import { Collector, TlsProxy, closeServer, listen } from './network.ts';
import { integrationDatabase } from '../../packages/db/test/auth-integration-fixtures.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export async function setup() {
  requireCheck(process.env.CI === 'true' && process.env.GF_AUTH_INTEGRATION_CI === '1', 'сборка/браузер разрешены только отдельному CI job');
  const url = testDatabaseUrl(process.env.GF_AUTH_INTEGRATION_PG);
  const resolution = await lookup('mail-relay', { all: true });
  requireCheck(resolution.length > 0 && resolution.every(item => item.address === '127.0.0.1'), 'mail-relay должен указывать только на loopback');
  const root = await mkdtemp(join(tmpdir(), 'gf-auth-integration-'));
  const processes: ManagedProcess[] = [];
  const browserClosers = new Set<() => Promise<void>>();
  let proxy: TlsProxy | undefined, probe: TlsProxy | undefined, collector: Collector | undefined;
  let db: Awaited<ReturnType<typeof integrationDatabase>> | undefined;
  let aborted = false, cleanupFailed = false, cleanupPromise: Promise<void> | undefined;
  async function abort() {
    aborted = true;
    try {
      await abortResources(processes, browserClosers);
    } catch { cleanupFailed = true; throw new Error('ошибка принудительной очистки стенда'); }
  }
  function cleanup() {
    return cleanupPromise ??= (async () => {
      // Даже ошибка остановки процесса не отменяет закрытие сетей/БД и удаление файлов.
      const first = await Promise.allSettled([abort()]);
      const results = await Promise.allSettled([
        ...(collector ? [closeServer(collector.server)] : []),
        ...(proxy ? [closeServer(proxy.server)] : []),
        ...(probe ? [closeServer(probe.server)] : []), db?.close(),
      ]);
      const files = await Promise.allSettled([rm(root, { recursive: true, force: true })]);
      process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
      requireCheck(!cleanupFailed && [...first, ...results, ...files].every(result => result.status === 'fulfilled'), 'не все ресурсы стенда очищены');
    })();
  }
  function interrupted() { void cleanup().finally(() => process.exit(1)); }
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  const track = (child: ManagedProcess) => { processes.push(child); };
  try {
    const layout = join(root, 'layout'), fixtures = join(root, 'fixtures');
    await mkdir(fixtures, { mode: 0o700 });
    const key = randomBytes(32), serviceSecret = randomBytes(32).toString('hex');
    await writeFile(join(fixtures, 'mail-key'), key, { mode: 0o600 });
    await writeFile(join(fixtures, 'bad-key'), 'invalid-synthetic-key', { mode: 0o600 });
    await writeFile(join(fixtures, 'auth-secret'), randomBytes(48).toString('hex'), { mode: 0o600 });
    await writeFile(join(fixtures, 'service-secret'), serviceSecret, { mode: 0o600 });
    await mkdir(join(fixtures, 'data'));
    await writeFile(join(fixtures, 'data/registry.json'), JSON.stringify({ schema: 1, updatedAt: new Date(0).toISOString(), games: [] }));
    await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost', '-keyout', join(fixtures, 'tls-key'), '-out', join(fixtures, 'tls-cert')], root, cleanEnvironment(), 10_000, track);
    const cert = await readFile(join(fixtures, 'tls-cert')), tlsKey = await readFile(join(fixtures, 'tls-key'));
    proxy = new TlsProxy(cert, tlsKey); probe = new TlsProxy(cert, tlsKey);
    await proxy.start(); await probe.start();
    const origin = proxy.origin;
    collector = new Collector(serviceSecret, () => origin);
    await listen(collector.server, 4102);
    // Next сам читает .env при build, независимо от переданного env.
    // Чистый checkout CI обязан обходиться без таких файлов; содержимое не читаем.
    for (const directory of [ROOT, join(ROOT, 'apps/hub')]) {
      requireCheck(!(await readdir(directory)).some(name => name.startsWith('.env') && name !== '.env.example'), 'build checkout содержит runtime env-файл');
    }
    // Та же сборка во всех режимах. Runtime DB/origin/секретов в build env нет.
    await command('pnpm', ['--filter', '@gf/hub', 'build'], ROOT, cleanEnvironment({ CI: 'true', GF_HUB_STANDALONE: '1',
      GF_AUTH_ACTIONS_ENABLED: 'closed-test', GF_AUTH_MAIL_DISPATCHER: 'closed-test' }), 480_000, track);
    requireCheck(collector.messages.length === 0, 'сборка пыталась отправлять почту');
    await cp(join(ROOT, 'apps/hub/.next/standalone'), layout, { recursive: true, verbatimSymlinks: true });
    await cp(join(ROOT, 'apps/hub/.next/static'), join(layout, 'apps/hub/.next/static'), { recursive: true });
    await cp(join(ROOT, 'apps/hub/public'), join(layout, 'apps/hub/public'), { recursive: true });
    await checkLayout(layout);
    db = await integrationDatabase(url, key, origin);
    const readyDb = db, readyProxy = proxy;
    const baseEnv = cleanEnvironment({ NODE_ENV: 'production', HOSTNAME: '127.0.0.1',
      GF_DATA_DIR: join(fixtures, 'data'), GF_DATABASE_URL: db.hubUrl, GF_HUB_ORIGIN: origin,
      GF_AUTH_SECRET_FILE: join(fixtures, 'auth-secret'), GF_AUTH_MAIL_KEY_FILE: join(fixtures, 'mail-key'),
      GF_MAIL_RELAY_URL: 'http://mail-relay:4102/v1/send', GF_MAIL_SERVICE_SECRET_FILE: join(fixtures, 'service-secret') });
    async function start(options: { api?: boolean; dispatch?: boolean; key?: 'missing' | 'bad-key'; entry?: string } = {}) {
      requireCheck(!aborted, 'стенд уже остановлен/прерван');
      // Порт резервируется только для определения номера; EADDRINUSE не является ожидаемым отказом.
      const { createServer } = await import('node:http');
      const socket = createServer(); const port = await listen(socket); await closeServer(socket);
      const env = { ...baseEnv, PORT: String(port),
        ...(options.api ? { GF_AUTH_ACTIONS_ENABLED: 'closed-test' } : {}),
        ...(options.dispatch ? { GF_AUTH_MAIL_DISPATCHER: 'closed-test' } : {}),
        ...(options.key ? { GF_AUTH_MAIL_KEY_FILE: join(fixtures, options.key) } : {}) };
      const child = launchRuntime(layout, fixtures, env, options.entry);
      processes.push(child); readyProxy.target = port;
      return { child, async ready() {
        await until(async () => {
          requireCheck(child.running, child.denied ? 'standalone запросил файл вне layout' : 'standalone завершился до готовности');
          try { const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) }); return r.status === 200; }
          catch { return false; }
        }, 'standalone не готов за 30 секунд', 30_000);
      }, rejected: (diagnostic: () => boolean) => expectConfigurationRejection(child, `http://127.0.0.1:${port}/healthz`, diagnostic),
      stop: (signal: NodeJS.Signals = 'SIGTERM') => child.stop(signal) };
    }
    return { root, layout, fixtures, origin, proxy, probe, collector, db: readyDb, start, cleanup, abort, browserClosers };
  } catch {
    await cleanup();
    throw new Error('setup standalone/HTTPS/PG не выполнен; это ошибка, а не успешный негативный тест');
  }
}
export type Stand = Awaited<ReturnType<typeof setup>>;
