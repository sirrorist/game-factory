// Без Engine и API: реальные функции допуска/валидации и их GitHub Actions wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GF_MAIL_IMAGE_TEST_ROOT ?? resolve('.');
const source = async (file) => readFile(resolve(root, file), 'utf8');
const { authorizeMailPublish } = await import(pathToFileURL(resolve(root, '.github/scripts/mail-publish-gate.mjs')));
const { sandboxArgs, checkImageMetadata, checkProbe, smokeImage } = await import(pathToFileURL(resolve(root, 'tools/mail-image-smoke.mjs')));
const repository = 'sirrorist/game-factory';
const sha = 'a'.repeat(40);
function fixture(eventName = 'workflow_run') {
  const run = { id: 17, workflow_id: 23, path: '.github/workflows/ci.yml',
    head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success',
    head_sha: sha, repository: { full_name: repository }, head_repository: { full_name: repository } };
  const jobs = [{ name: 'mail-image', head_sha: sha, status: 'completed', conclusion: 'success' }];
  const event = { repository: { full_name: repository }, workflow_run: structuredClone(run) };
  const data = { eventName, event, repository, checkoutSha: sha, ref: 'refs/heads/main' };
  return { data, run, jobs, workflow: { id: 23 }, list: { workflow_runs: [run] } };
}
function withApi(f) {
  return { ...f.data, api: async (path) => {
    if (path === `/repos/${repository}/actions/workflows/ci.yml`) return f.workflow;
    if (path.endsWith('/jobs?filter=latest&per_page=100')) return { jobs: f.jobs };
    if (path === `/repos/${repository}/actions/runs/17`) return f.run;
    if (path === `/repos/${repository}/actions/runs/18`) return f.list.workflow_runs.find((run) => run.id === 18);
    if (path === `/repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=1`) return f.list;
    throw new Error('неожиданный API-маршрут');
  } };
}

for (const eventName of ['workflow_run', 'workflow_dispatch']) {
  test('допуск: успешный CI и smoke точного SHA, ' + eventName, async () => {
    assert.equal(await authorizeMailPublish(withApi(fixture(eventName))), sha);
  });
}
for (const [name, change] of [
  ['другая ветка', (f) => { f.data.event.workflow_run.head_branch = 'dev'; f.run.head_branch = 'dev'; }],
  ['PR', (f) => { f.data.event.workflow_run.event = 'pull_request'; f.run.event = 'pull_request'; }],
  ['форк', (f) => { f.data.event.workflow_run.head_repository.full_name = 'attacker/game-factory'; f.run.head_repository.full_name = 'attacker/game-factory'; }],
  ['чужой репозиторий события', (f) => { f.data.event.repository.full_name = 'attacker/game-factory'; }],
  ['красный CI', (f) => { f.data.event.workflow_run.conclusion = 'failure'; f.run.conclusion = 'failure'; }],
  ['API опровергает зелёное событие', (f) => { f.run.conclusion = 'failure'; }],
  ['CI ещё выполняется', (f) => { f.run.status = 'in_progress'; }],
  ['другой SHA CI', (f) => { f.data.event.workflow_run.head_sha = 'b'.repeat(40); f.run.head_sha = 'b'.repeat(40); }],
  ['другой SHA только в API', (f) => { f.run.head_sha = 'b'.repeat(40); }],
  ['другой workflow id', (f) => { f.run.workflow_id = 24; }],
  ['другой workflow path', (f) => { f.run.path = '.github/workflows/untrusted.yml'; }],
  ['нет smoke', (f) => { f.jobs = []; }],
  ['smoke skipped', (f) => { f.jobs[0].conclusion = 'skipped'; }],
  ['smoke failure', (f) => { f.jobs[0].conclusion = 'failure'; }],
  ['smoke другого SHA', (f) => { f.jobs[0].head_sha = 'b'.repeat(40); }],
  ['два smoke вместо одного', (f) => { f.jobs.push(structuredClone(f.jobs[0])); }],
  ['повреждённый SHA', (f) => { f.data.checkoutSha = 'main'; }],
]) {
  test('допуск: отказ — ' + name, async () => {
    const f = fixture(); change(f);
    await assert.rejects(authorizeMailPublish(withApi(f)));
  });
}
test('допуск: ручной запуск из dev запрещён', async () => {
  const f = fixture('workflow_dispatch'); f.data.ref = 'refs/heads/dev';
  await assert.rejects(authorizeMailPublish(withApi(f)));
});
test('допуск: нет успешного CI для ручного запуска', async () => {
  const f = fixture('workflow_dispatch'); f.list.workflow_runs = [];
  await assert.rejects(authorizeMailPublish(withApi(f)));
});
test('допуск: новый красный повтор не прикрывается старым зелёным', async () => {
  const f = fixture('workflow_dispatch');
  f.list.workflow_runs = [{ ...f.run, conclusion: 'failure' }, f.run];
  await assert.rejects(authorizeMailPublish(withApi(f)));
});
for (const eventName of ['workflow_run', 'workflow_dispatch']) {
  for (const [name, status, conclusion] of [
    ['красный', 'completed', 'failure'], ['незавершённый', 'in_progress', null],
  ]) {
    test(`допуск: последний отдельный run ${name} запрещает ${eventName}`, async () => {
      const f = fixture(eventName);
      f.list.workflow_runs = [{ ...f.run, id: 18, status, conclusion }, f.run];
      await assert.rejects(authorizeMailPublish(withApi(f)));
    });
  }
}
test('допуск: старое событие не соответствует новому зелёному run', async () => {
  const f = fixture(); f.list.workflow_runs = [{ ...f.run, id: 18 }];
  await assert.rejects(authorizeMailPublish(withApi(f)));
});
test('допуск: ручной запуск использует новый зелёный run', async () => {
  const f = fixture('workflow_dispatch'); f.list.workflow_runs = [{ ...f.run, id: 18 }];
  assert.equal(await authorizeMailPublish(withApi(f)), sha);
});
for (const eventName of ['workflow_run', 'workflow_dispatch']) {
  test('допуск: формат ci.yml@main, ' + eventName, async () => {
    const f = fixture(eventName); f.run.path = '.github/workflows/ci.yml@main';
    assert.equal(await authorizeMailPublish(withApi(f)), sha);
  });
}
for (const path of ['.github/workflows/other.yml@main', '.github/workflows/ci.yml@dev', '.github/workflows/ci.yml@main/extra']) {
  test('допуск: отказ для пути ' + path, async () => {
    const f = fixture(); f.run.path = path;
    await assert.rejects(authorizeMailPublish(withApi(f)));
  });
}
test('допуск: ошибка списка последнего CI закрывает автоматический путь', async () => {
  const f = fixture(); const api = withApi(f).api;
  await assert.rejects(authorizeMailPublish({ ...f.data, api: async (path) => {
    if (path.includes('/runs?')) throw new Error('synthetic');
    return api(path);
  } }));
});
test('допуск: пустой список последнего CI закрывает автоматический путь', async () => {
  const f = fixture(); f.list.workflow_runs = [];
  await assert.rejects(authorizeMailPublish(withApi(f)));
});
test('допуск: ответ отдельного run должен совпадать с выбранным id', async () => {
  const f = fixture(); f.list.workflow_runs = [{ ...f.run }]; f.run.id = 99;
  await assert.rejects(authorizeMailPublish(withApi(f)));
});
test('допуск: ошибка API закрывает публикацию', async () => {
  await assert.rejects(authorizeMailPublish({ ...fixture().data, api: async () => { throw new Error('synthetic'); } }));
});
test('допуск: неизвестное событие запрещено', async () => {
  const f = fixture('pull_request');
  await assert.rejects(authorizeMailPublish(withApi(f)));
});

function job(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^  ${escaped}:\\n[\\s\\S]*?(?=^  [a-z][a-z-]*:\\n|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, 'нет job ' + name);
  return match[0];
}
test('wiring: CI, ограниченные права, gate и точный checkout публикации', async () => {
  const ci = await source('.github/workflows/ci.yml');
  const publish = await source('.github/workflows/publish.yml');
  const check = job(ci, 'mail-image');
  assert.match(check, /name: mail-image\n/);
  assert.match(check, /permissions:\n      contents: read\n/);
  assert.doesNotMatch(check, /packages: write|secrets\.|push: true/);
  assert.match(check, /node --test --experimental-test-isolation=none tests\/ops\/mail-image.test.mjs/);
  assert.match(check, /docker build --platform linux\/amd64 --file apps\/mail-relay\/Dockerfile --tag gf-mail-relay-ci \./);
  assert.match(check, /node tools\/mail-image-smoke.mjs gf-mail-relay-ci/);
  const gate = job(publish, 'mail-gate');
  assert.match(gate, /actions: read/);
  assert.doesNotMatch(gate, /packages: write/);
  assert.match(gate, /github\.ref == 'refs\/heads\/main'/);
  assert.match(gate, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(gate, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(gate, /ref: \$\{\{ github.event.workflow_run.head_sha \|\| github.sha \}\}/);
  assert.match(gate, /run: node \.github\/scripts\/mail-publish-gate.mjs/);
  const push = job(publish, 'mail-image');
  assert.match(push, /needs: mail-gate\n/);
  assert.match(push, /ref: \$\{\{ needs.mail-gate.outputs.sha \}\}/);
  assert.match(push, /file: apps\/mail-relay\/Dockerfile\n/);
  assert.match(push, /platforms: linux\/amd64\n/);
  assert.match(push, /tags: ghcr.io\/sirrorist\/game-factory-mail-relay:\$\{\{ needs.mail-gate.outputs.sha \}\}\n/);
  assert.match(push, /org.opencontainers.image.revision=\$\{\{ needs.mail-gate.outputs.sha \}\}/);
  assert.doesNotMatch(push, /:main\b|:latest\b|build-args:|secrets:\s*\|/);
  assert.match(push, /IMAGE_DIGEST: \$\{\{ steps.build.outputs.digest \}\}/);
});
test('образ: фиксированная база и строгий контекст шлюза', async () => {
  const dockerfile = await source('apps/mail-relay/Dockerfile');
  assert.match(dockerfile, /^FROM node:22\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/m);
  assert.doesNotMatch(dockerfile, /^ARG\b|^ADD\b|^RUN\b|^COPY \. /m);
  assert.match(dockerfile, /^COPY package.json \.\/$/m);
  assert.match(dockerfile, /^COPY apps\/mail-relay\/src apps\/mail-relay\/src\/$/m);
  assert.match(dockerfile, /^USER node$/m);
  const lines = (await source('apps/mail-relay/Dockerfile.dockerignore')).split('\n').filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(lines, ['**', '!package.json', '!apps/mail-relay/Dockerfile',
    '!apps/mail-relay/Dockerfile.dockerignore', '!apps/mail-relay/src/*.ts']);
});
test('smoke: контейнер без сети, записи, root, capabilities и портов', () => {
  assert.deepEqual(sandboxArgs(), ['--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.25', '--pids-limit', '32']);
});
test('smoke: metadata и ожидаемый безопасный HTTP-ответ', () => {
  const meta = { Os: 'linux', Architecture: 'amd64', Config: { User: 'node', WorkingDir: '/app',
    Cmd: ['node', 'apps/mail-relay/src/main.ts'], Env: ['NODE_ENV=production'] } };
  checkImageMetadata(meta);
  for (const mutate of [m => { m.Config.User = 'root'; }, m => { m.Architecture = 'arm64'; }, m => { m.Config.Cmd = ['sh']; }]) {
    const other = structuredClone(meta); mutate(other);
    assert.throws(() => checkImageMetadata(other));
  }
  const reply = { uid: 1000, status: 401, body: { outcome: 'not_accepted', code: 'unauthorized' } };
  checkProbe(reply);
  assert.throws(() => checkProbe({ ...reply, status: 202 }));
  assert.throws(() => checkProbe({ ...reply, uid: 0 }));
  assert.throws(() => checkProbe({ ...reply, body: { outcome: 'accepted' } }));
});

// Только протокол CLI: никакой настоящий docker здесь не запускается.
// Inspect строится из переданных argv, а не из ожидаемого sandboxArgs().
async function fakeDocker(options = {}) {
  const containers = new Map();
  const trace = { created: [], inspected: [], started: [], removed: [], waits: 0 };
  const version = (await source('apps/mail-relay/Dockerfile')).match(/FROM node:([0-9.]+)-/)?.[1];
  const files = (await readdir(resolve(root, 'apps/mail-relay/src')).catch(() => readdir('apps/mail-relay/src'))).sort();
  const metadata = { Os: 'linux', Architecture: 'amd64', Config: { User: 'node', WorkingDir: '/app',
    Cmd: ['node', 'apps/mail-relay/src/main.ts'], Env: ['NODE_ENV=production'] } };
  const run = async (command, args) => {
    assert.equal(command, 'docker');
    let stdout = ''; let stderr = '';
    const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
    if (args[0] === 'image' && args[1] === 'inspect') stdout = JSON.stringify([metadata]);
    else if (args[0] === 'create') {
      const name = option('--name'); assert.ok(name);
      const mounts = args.flatMap((arg, index) => arg === '--mount' ? [{ ReadOnly: args[index + 1].split(',').includes('readonly') }] : []);
      const host = {
        NetworkMode: option('--network', 'bridge'), ReadonlyRootfs: args.includes('--read-only'),
        CapDrop: args.includes('--cap-drop') ? [option('--cap-drop')] : [], CapAdd: [],
        SecurityOpt: args.includes('--security-opt') ? [option('--security-opt')] : [],
        Memory: option('--memory') === '128m' ? 128 * 1024 * 1024 : 0,
        NanoCpus: Number(option('--cpus', 0)) * 1000000000,
        PidsLimit: Number(option('--pids-limit', 0)), Privileged: false,
        PublishAllPorts: false, PortBindings: {}, Mounts: mounts,
      };
      const config = { User: option('--user', 'node') };
      if (options.corruptHost) Object.assign(host, options.corruptHost);
      if (options.corruptUser) config.User = options.corruptUser;
      const inspection = args.includes('--entrypoint');
      const empty = args.some((arg) => /src=[^,]*\/empty,/.test(arg));
      const pin = option('--env');
      const invalid = !pin || empty || args.includes('GF_MAIL_PROFILE_SHA256=' + '0'.repeat(64));
      containers.set(name, { host, config, inspection, invalid });
      trace.created.push(name); stdout = name;
    } else if (args[0] === 'inspect') {
      assert.deepEqual(args.slice(1, 3), ['--type', 'container']);
      const name = args[3]; const value = containers.get(name); assert.ok(value);
      trace.inspected.push(name);
      stdout = JSON.stringify([{ HostConfig: value.host, Config: value.config }]);
    } else if (args[0] === 'start') { assert.ok(containers.has(args[1])); trace.started.push(args[1]); }
    else if (args[0] === 'wait') {
      trace.waits++;
      if (options.failWait && trace.waits === 2) throw new Error('synthetic docker wait failure');
      const value = containers.get(args[1]); assert.ok(value);
      assert.ok(value.inspection || value.invalid, 'положительный сервер не должен ожидать завершения');
      stdout = value.inspection ? '0' : '1';
    } else if (args[0] === 'logs') {
      const value = containers.get(args[1]); assert.ok(value);
      if (value.inspection) stdout = JSON.stringify({ version, uid: 1000, top: ['apps', 'package.json'],
        apps: ['mail-relay'], relay: ['src'], src: files });
      else if (value.invalid) stderr = 'gf-mail: обязательная конфигурация отсутствует или неверна\n';
    } else if (args[0] === 'exec') {
      assert.ok(containers.has(args[1]));
      stdout = JSON.stringify({ uid: 1000, status: 401, body: { outcome: 'not_accepted', code: 'unauthorized' } });
    } else if (args[0] === 'rm') {
      assert.equal(args[1], '-f'); assert.ok(containers.delete(args[2])); trace.removed.push(args[2]);
    } else throw new Error('неожиданный синтетический вызов Docker');
    return { stdout, stderr };
  };
  return { run, trace, containers };
}
test('smoke CLI: фактические аргументы, inspect каждого контейнера и cleanup', async () => {
  const fake = await fakeDocker();
  await smokeImage('synthetic-mail-image', fake.run);
  assert.equal(fake.trace.created.length, 6);
  assert.deepEqual(fake.trace.inspected, fake.trace.created);
  assert.deepEqual(fake.trace.started, fake.trace.created);
  assert.deepEqual(fake.trace.removed, fake.trace.created);
  assert.equal(fake.containers.size, 0);
});
for (const [name, corruptHost] of [
  ['сеть', { NetworkMode: 'bridge' }], ['запись rootfs', { ReadonlyRootfs: false }],
  ['capabilities', { CapDrop: [] }], ['повышение привилегий', { SecurityOpt: [] }],
  ['RAM', { Memory: 0 }], ['CPU', { NanoCpus: 0 }], ['процессы', { PidsLimit: 0 }],
  ['привилегированный режим', { Privileged: true }], ['порты', { PortBindings: { '4102/tcp': [{}] } }],
  ['запись mount', { Mounts: [{ ReadOnly: false }] }],
]) {
  test('smoke CLI: inspect отвергает — ' + name, async () => {
    const fake = await fakeDocker({ corruptHost });
    await assert.rejects(smokeImage('synthetic-mail-image', fake.run));
    assert.equal(fake.trace.started.length, 0);
    assert.equal(fake.containers.size, 0);
    assert.deepEqual(fake.trace.removed, fake.trace.created);
  });
}
test('smoke CLI: inspect отвергает неверного пользователя', async () => {
  const fake = await fakeDocker({ corruptUser: 'root' });
  await assert.rejects(smokeImage('synthetic-mail-image', fake.run));
  assert.equal(fake.trace.started.length, 0);
  assert.equal(fake.containers.size, 0);
});
test('smoke CLI: ошибка Docker не считается отказом конфигурации; cleanup выполняется', async () => {
  const fake = await fakeDocker({ failWait: true });
  await assert.rejects(smokeImage('synthetic-mail-image', fake.run), /synthetic docker wait failure/);
  assert.equal(fake.containers.size, 0);
  assert.deepEqual(fake.trace.removed, fake.trace.created);
});
