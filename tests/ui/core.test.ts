import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeName, ROOT } from './core/paths.ts';
import { assertDevelopment, servedFile, startComparison } from './core/server.ts';
import { ensureNewBaseline, publishSnapshot } from './core/snapshot.ts';
import { snapshotEvidence } from './core/evidence.ts';
import { markInterrupted } from './core/report.ts';

test('цели и отдельные проходы не позволяют выйти из каталога результатов', () => {
  for (const value of ['', '..', '../hub', 'a/b', 'a\\b', '/tmp', '-ref']) assert.throws(() => safeName(value));
  assert.equal(safeName('rogue-destiny'), 'rogue-destiny');
});

test('база защищена даже при прерванном создании; подмена HTML обнаруживается', () => {
  const out = mkdtempSync(join(tmpdir(), 'gf-ui-evidence-'));
  try {
    mkdirSync(join(out, 'before'));
    assert.throws(() => ensureNewBaseline(join(out, 'before')), /База уже существует/);
    for (const side of ['before', 'after']) {
      mkdirSync(join(out, side), { recursive: true });
      writeFileSync(join(out, side, 'index.html'), 'изменённая сборка');
      writeFileSync(join(out, side, 'snapshot.json'), JSON.stringify({ hash: 'предыдущий хеш', ref: 'sample', version: '1' }));
    }
    assert.throws(() => snapshotEvidence(out), /HTML не совпадает/);
  } finally { rmSync(out, { recursive: true }); }
});

test('раздаётся только каталог артефактов, без скрытых файлов и внешних симлинков', () => {
  const out = mkdtempSync(join(tmpdir(), 'gf-ui-path-')), root = join(out, 'site');
  mkdirSync(root); writeFileSync(join(root, 'index.html'), 'UI'); writeFileSync(join(out, 'outside.txt'), 'outside');
  writeFileSync(join(root, '.private'), 'hidden'); symlinkSync(join(out, 'outside.txt'), join(root, 'linked.txt'));
  symlinkSync(join(root, '.private'), join(root, 'alias.txt'));
  mkdirSync(join(root, '.hidden')); writeFileSync(join(root, '.hidden', 'visible.txt'), 'hidden directory');
  symlinkSync(join(root, '.hidden'), join(root, 'alias-directory'), 'dir');
  symlinkSync(join(root, 'index.html'), join(root, 'visible-link.html'));
  try {
    assert.equal(servedFile(root, '/'), join(root, 'index.html'));
    assert.equal(servedFile(root, '/visible-link.html'), join(root, 'index.html'));
    for (const path of ['/../outside.txt', '/%2e%2e/outside.txt', '/%2eprivate', '/linked.txt', '/alias.txt', '/alias-directory/visible.txt', '/%00', '/%ff', '/a%5cb']) assert.equal(servedFile(root, path), null);
  } finally { rmSync(out, { recursive: true }); }
});

test('работающий сервер перечитывает отчёт и метаданные после замены after', async () => {
  const out = mkdtempSync(join(tmpdir(), 'gf-ui-refresh-')), content = join(out, 'content');
  mkdirSync(content); writeFileSync(join(content, 'index.html'), '<!doctype html><body>первая');
  publishSnapshot(out, 'before', content, { ref: 'base', version: '1' });
  publishSnapshot(out, 'after', content, { ref: 'old', version: '2' });
  const evidence = snapshotEvidence(out);
  writeFileSync(join(out, 'report.json'), JSON.stringify({ status: 'finished', complete: true, failed: 0, snapshots: evidence }));
  const server = await startComparison({ id: 'sample', title: 'sample', out, profiles: [], scenes: [],
    validateReport: report => JSON.stringify((report as { snapshots: unknown }).snapshots) === JSON.stringify(snapshotEvidence(out)) });
  try {
    const get = async () => (await (await fetch(server.url + '/config.json')).json()) as { report: { status: string; complete: boolean } | null; snapshots: { after: { version: string; ref: string } } };
    assert.equal((await get()).report?.status, 'finished');
    writeFileSync(join(content, 'index.html'), '<!doctype html><body>следующая');
    publishSnapshot(out, 'after', content, { ref: 'new', version: '3' });
    assert.equal((await get()).report, null);
    assert.equal((await get()).snapshots.after.version, '3');
    for (const path of ['/', '/index.html']) {
      const html = await (await fetch(server.url + path)).text();
      assert.match(html, /"ref":"new","version":"3"/);
      assert.match(html, /"report":null/);
    }
    writeFileSync(join(out, 'report.json'), JSON.stringify({ status: 'finished', complete: true, failed: 0, snapshots: evidence }));
    assert.equal((await get()).report?.status, 'stale');
    writeFileSync(join(out, 'report.json'), '{');
    assert.equal((await get()).report, null);
  } finally { await server.close(); rmSync(out, { recursive: true }); }
});

test('повторная сборка удаляет старые ресурсы, сохраняет историю и не меняет базу', () => {
  const out = mkdtempSync(join(tmpdir(), 'gf-ui-rebuild-')), content = join(out, 'content');
  mkdirSync(content); writeFileSync(join(content, 'index.html'), 'первая версия');
  try {
    const before = publishSnapshot(out, 'before', content, { ref: 'sample', version: '1' });
    publishSnapshot(out, 'after', content, { ref: 'sample', version: '2' });
    writeFileSync(join(out, 'after', 'old.js'), 'старый ресурс');
    writeFileSync(join(out, 'report.json'), '{"complete":true}');
    writeFileSync(join(content, 'index.html'), 'вторая версия');
    const after = publishSnapshot(out, 'after', content, { ref: 'sample', version: '3' });
    assert.notEqual(before.hash, after.hash);
    assert.equal(servedFile(join(out, 'after'), '/old.js'), null);
    assert.equal(readFileSync(join(out, 'before/index.html'), 'utf8'), 'первая версия');
    const history = join(out, 'history', readdirSync(join(out, 'history'))[0]!);
    assert.equal(readFileSync(join(history, 'after/index.html'), 'utf8'), 'первая версия');
    assert.equal(readFileSync(join(history, 'after/old.js'), 'utf8'), 'старый ресурс');
    assert.deepEqual(JSON.parse(readFileSync(join(history, 'report.json'), 'utf8')), { complete: true });
    assert.throws(() => publishSnapshot(out, 'before', content, { ref: 'other', version: '4' }), /База уже существует/);
    const { before: preserved } = snapshotEvidence(out);
    assert.equal(preserved!.hash, before.hash);
  } finally { rmSync(out, { recursive: true }); }
});

test('dev-просмотрщик запрещён в production и не включён в прод-запуск/образы', async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(assertDevelopment, /только dev/);
    await assert.rejects(startComparison({ id: 'sample', title: 'sample', out: '/unused', profiles: [], scenes: [] }), /только dev/);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
  for (const name of ['play', 'hub', 'hub:start', 'hub:build', 'games:build', 'games:export']) assert.doesNotMatch(scripts[name]!, /tests\/ui|ui:compare|ui:preview/);
  assert.match(readFileSync(join(ROOT, '.dockerignore'), 'utf8'), /^tests\/?$/m);
  assert.doesNotMatch(readFileSync(join(ROOT, 'deploy/compose.prod.yml'), 'utf8'), /tests\/ui|ui:compare|ui:preview/);
});

test('две версии имеют разные origins; метаданные не исполняются; доступны только GET/HEAD', async () => {
  const out = mkdtempSync(join(tmpdir(), 'gf-ui-server-'));
  for (const side of ['before', 'after']) { mkdirSync(join(out, side)); writeFileSync(join(out, side, 'index.html'), '<!doctype html><body>' + side); }
  const server = await startComparison({ id: 'sample', title: '</script><img src=x>', out, profiles: [], scenes: [],
    snapshots: { before: { ref: 'sample', hash: 'a', version: '1' }, after: { ref: 'sample', hash: 'b', version: '2' } } });
  try {
    assert.notEqual(new URL(server.before).origin, new URL(server.after).origin);
    assert.equal(await (await fetch(server.before)).text(), '<!doctype html><body>before');
    const viewer = await (await fetch(server.url)).text();
    assert.doesNotMatch(viewer, /<img src=x>/); assert.match(viewer, /\\u003c\/script>/);
    assert.equal((await fetch(server.after, { method: 'POST' })).status, 405);
    assert.equal(await (await fetch(server.after, { method: 'HEAD' })).text(), '');
  } finally { await server.close(); rmSync(out, { recursive: true }); }
});

test('прерванный прогон не остаётся зелёным и сохраняет уже собранные доказательства', () => {
  const out = mkdtempSync(join(tmpdir(), 'gf-ui-interrupted-')), file = join(out, 'report.json');
  try {
    writeFileSync(file, JSON.stringify({ complete: true, failed: 0, runs: [{ phase: 'case', errors: ['ошибка'] }], fatal: 'источник изменился' }));
    markInterrupted(file, 1);
    const report = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(report.complete, false); assert.equal(report.failed, 1);
    assert.equal(report.fatal, 'источник изменился');
    assert.deepEqual(report.runs, [{ phase: 'case', errors: ['ошибка'] }]);
  } finally { rmSync(out, { recursive: true }); }
});
