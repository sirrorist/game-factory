// Запускается только по согласованию или в CI: настоящий Docker, искусственные файлы.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);

export function sandboxArgs() {
  return ['--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.25', '--pids-limit', '32'];
}
export function checkImageMetadata(image) {
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, 'amd64');
  assert.equal(image.Config.User, 'node');
  assert.equal(image.Config.WorkingDir, '/app');
  assert.deepEqual(image.Config.Cmd, ['node', 'apps/mail-relay/src/main.ts']);
  assert.ok(image.Config.Env.includes('NODE_ENV=production'));
}
export function checkProbe(reply) {
  assert.equal(reply.uid, 1000);
  assert.equal(reply.status, 401);
  assert.deepEqual(reply.body, { outcome: 'not_accepted', code: 'unauthorized' });
}
export function checkContainerSandbox(container) {
  const host = container.HostConfig;
  assert.equal(container.Config.User, '1000:1000');
  assert.equal(host.NetworkMode, 'none');
  assert.equal(host.ReadonlyRootfs, true);
  assert.deepEqual(host.CapDrop, ['ALL']);
  assert.deepEqual(host.CapAdd ?? [], []);
  assert.equal(host.SecurityOpt?.length, 1);
  assert.match(host.SecurityOpt[0], /^no-new-privileges(?:=true)?$/);
  assert.equal(host.Memory, 128 * 1024 * 1024);
  assert.equal(host.NanoCpus, 250000000);
  assert.equal(host.PidsLimit, 32);
  assert.equal(host.Privileged, false);
  assert.equal(host.PublishAllPorts, false);
  assert.deepEqual(host.PortBindings ?? {}, {});
  for (const mount of host.Mounts ?? []) assert.equal(mount.ReadOnly, true);
}

// Подмена исполнителя доступна только импортирующему тесту; CLI всегда использует execFile.
export async function smokeImage(image, execDocker = exec) {
  assert.match(image ?? '', /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/);
  const docker = async (...args) => (await execDocker('docker', args, { timeout: 10000, maxBuffer: 1024 * 1024 })).stdout.trim();
  const metadata = JSON.parse(await docker('image', 'inspect', image));
  checkImageMetadata(metadata[0]);
  const dir = await mkdtemp(join(tmpdir(), 'gf-mail-smoke-'));
  const service = 'synthetic-service-secret-0123456789abcdef';
  const apiKey = 're_synthetic_mail_ci_01234567890123456789';
  const pin = '2f6ade95883c8735f14d51452fe94d0964a80dbc47c04c9b796df2a45a5b74dd';
  const containers = new Set();
  const create = async (args, command = []) => {
    const name = 'gf-mail-smoke-' + randomUUID();
    // Регистрируем имя до create: даже потерянный ответ не оставляет контейнер вне cleanup.
    containers.add(name);
    await docker('create', ...sandboxArgs(), '--name', name, ...args, image, ...command);
    const actual = JSON.parse(await docker('inspect', '--type', 'container', name));
    assert.equal(actual.length, 1);
    checkContainerSandbox(actual[0]);
    await docker('start', name);
    return name;
  };
  const remove = async (name) => { await docker('rm', '-f', name); containers.delete(name); };
  try {
    for (const [file, value] of [['service', service], ['api', apiKey], ['empty', '']]) {
      await writeFile(join(dir, file), value, { mode: 0o644 });
    }
    const config = (serviceFile = 'service', apiFile = 'api', profile = pin) => [
      '--env', 'GF_HUB_ORIGIN=https://games.youranus.ru', '--env', 'GF_MAIL_FROM=noreply@auth.youranus.ru',
      '--env', 'GF_MAIL_PROFILE_SHA256=' + profile,
      '--env', 'GF_MAIL_SERVICE_SECRET_FILE=/run/secrets/service', '--env', 'GF_RESEND_API_KEY_FILE=/run/secrets/api',
      '--mount', `type=bind,src=${join(dir, serviceFile)},dst=/run/secrets/service,readonly`,
      '--mount', `type=bind,src=${join(dir, apiFile)},dst=/run/secrets/api,readonly`,
    ];
    const from = (await readFile('apps/mail-relay/Dockerfile', 'utf8')).match(/^FROM node:(22\.\d+\.\d+)-bookworm-slim@sha256:[0-9a-f]{64}$/m);
    assert.ok(from);
    const sourceFiles = (await readdir('apps/mail-relay/src')).sort();
    assert.ok(sourceFiles.every((file) => /^[a-z-]+\.ts$/.test(file)));
    const inspectProgram = `const fs = require('node:fs');
      console.log(JSON.stringify({ version: process.versions.node, uid: process.getuid(),
        top: fs.readdirSync('/app').sort(), apps: fs.readdirSync('/app/apps'),
        relay: fs.readdirSync('/app/apps/mail-relay'), src: fs.readdirSync('/app/apps/mail-relay/src').sort() }));`;
    const inspection = await create(['--entrypoint', 'node'], ['-e', inspectProgram]);
    assert.equal(await docker('wait', inspection), '0');
    const layout = JSON.parse(await docker('logs', inspection));
    assert.equal(layout.version, from[1]);
    assert.equal(layout.uid, 1000);
    assert.deepEqual(layout.top, ['apps', 'package.json']);
    assert.deepEqual(layout.apps, ['mail-relay']);
    assert.deepEqual(layout.relay, ['src']);
    assert.deepEqual(layout.src, sourceFiles);
    await remove(inspection);

    for (const [name, args] of [
      ['missing-config', []], ['empty-service', config('empty')],
      ['empty-api', config('service', 'empty')], ['invalid-pin', config('service', 'api', '0'.repeat(64))],
    ]) {
      const container = await create(args);
      assert.equal(await docker('wait', container), '1', name);
      // docker logs передаёт журнал процесса в два отдельных потока.
      const output = await execDocker('docker', ['logs', container], { timeout: 5000 });
      const combined = output.stdout + output.stderr;
      assert.match(combined, /gf-mail: обязательная конфигурация отсутствует или неверна/);
      assert.ok(!combined.includes(service) && !combined.includes(apiKey));
      await remove(container);
    }

    const positive = await create(config());
    const probe = `fetch('http://127.0.0.1:4102/v1/send', { method: 'POST',
      signal: AbortSignal.timeout(500), body: '{}' }).then(async r => console.log(JSON.stringify({
      uid: process.getuid(), status: r.status, body: await r.json() }))).catch(() => process.exit(1));`;
    const deadline = Date.now() + 5000;
    let reply;
    while (Date.now() < deadline) {
      try { reply = JSON.parse(await docker('exec', positive, 'node', '-e', probe)); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(reply, 'шлюз не начал отвечать в пределах smoke-дедлайна');
    checkProbe(reply);
    const logs = await execDocker('docker', ['logs', positive], { timeout: 5000 });
    assert.ok(!(logs.stdout + logs.stderr).includes(service) && !(logs.stdout + logs.stderr).includes(apiKey));
    await remove(positive);
    console.info('mail-image: metadata/layout, 4 отказа конфигурации и положительный HTTP smoke пройдены');
  } finally {
    let failed = false;
    for (const name of containers) {
      try { await docker('rm', '-f', name); } catch { failed = true; }
    }
    await rm(dir, { recursive: true, force: true });
    assert.equal(failed, false, 'не удалось очистить smoke-контейнер');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeImage(process.argv[2]).catch(() => { console.error('mail-image: smoke не пройден'); process.exitCode = 1; });
}
