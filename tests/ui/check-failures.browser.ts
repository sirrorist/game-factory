import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { ROOT } from './core/paths.ts';
import { publishSnapshot } from './core/snapshot.ts';
import { snapshotEvidence } from './core/evidence.ts';
import { startComparison } from './core/server.ts';

test('открытая вкладка снимает старый успех и снимки; перезагрузка показывает новую сборку', { timeout: 30000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'gf-ui-viewer-update-')), content = join(out, 'content');
  mkdirSync(content); writeFileSync(join(content, 'index.html'), '<!doctype html><body>образец');
  publishSnapshot(out, 'before', content, { ref: 'base', version: '1' });
  publishSnapshot(out, 'after', content, { ref: 'checked', version: '2' });
  const snapshots = snapshotEvidence(out);
  writeFileSync(join(out, 'report.json'), JSON.stringify({ status: 'finished', complete: true, failed: 0, snapshots, results: [] }));
  writeFileSync(join(out, 'before', '.private'), 'безвредный маркер');
  symlinkSync(join(out, 'before', '.private'), join(out, 'before', 'alias.txt'));
  const server = await startComparison({ id: 'sample', title: 'Образец', out,
    profiles: [{ id: 'small', label: 'Малый', width: 390, height: 844, touch: true }], scenes: [{ id: 'start', label: 'Старт' }] });
  const browser = await chromium.launch({ executablePath: process.env.GF_CHROMIUM_PATH || undefined });
  try {
    assert.equal((await fetch(server.before + '/alias.txt')).status, 404);
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.locator('#verdict').filter({ hasText: 'проверки пройдены' }).waitFor();
    await page.locator('#content').selectOption('shots');
    writeFileSync(join(content, 'index.html'), '<!doctype html><body>новая сборка');
    publishSnapshot(out, 'after', content, { ref: 'unchecked', version: '3' });
    writeFileSync(join(out, 'report.json'), JSON.stringify({ status: 'interrupted-or-failed', complete: false, failed: 1 }));
    await page.waitForFunction(() => document.querySelector('#verdict')!.textContent!.includes('Актуального полного прогона'));
    assert.equal(await page.locator('#content').inputValue(), 'scene');
    assert.equal(await page.locator('#content option[value="shots"]').evaluate(e => (e as HTMLOptionElement).disabled), true);
    assert.equal(await page.locator('#diff-link').isHidden(), true);
    assert.equal(await page.locator('#version-after').textContent(), '3');
    // Кнопка просмотрщика обновляет конфигурацию даже между периодическими запросами.
    writeFileSync(join(out, 'after', 'snapshot.json'), JSON.stringify({ ref: 'button-reload', version: '4', hash: 'new' }));
    await page.locator('#reload').click();
    await page.waitForFunction(() => document.querySelector('#version-after')!.textContent === '4');
    await page.reload();
    assert.equal(await page.locator('#ref-after').textContent(), 'button-reload');
    assert.doesNotMatch(await page.locator('#verdict').innerText(), /проверки пройдены/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); rmSync(out, { recursive: true }); }
});

test('успешная пересборка обновляет документ iframe, а неизменные файлы сохраняют сеанс', { timeout: 30000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'gf-ui-frame-sync-')), content = join(out, 'content');
  const evidenceRoot = join(ROOT, 'test-results/ui-review-fixes-r1'); mkdirSync(evidenceRoot, { recursive: true });
  const proof = mkdtempSync(join(evidenceRoot, 'frame-sync-'));
  const observations: unknown[] = [];
  mkdirSync(content);
  const html = (version: number) => `<!doctype html><link rel="stylesheet" href="style.css"><body><h1 id="build">BUILD ${version}</h1><p id="asset">CSS</p><script>document.body.dataset.boot=crypto.randomUUID();for(const [key,value] of new URL(location.href).searchParams)document.body.dataset[key]=value;</script>`;
  writeFileSync(join(content, 'index.html'), html(1)); writeFileSync(join(content, 'style.css'), '#asset{color:rgb(10,20,30)}');
  publishSnapshot(out, 'before', content, { ref: 'base', version: '0' });
  publishSnapshot(out, 'after', content, { ref: 'checked-v1', version: '1' });
  const finish = () => writeFileSync(join(out, 'report.json'), JSON.stringify({ status: 'finished', complete: true, failed: 0, snapshots: snapshotEvidence(out), results: [] }));
  finish();
  const server = await startComparison({ id: 'sample', title: 'Синхронизация сборки', out,
    profiles: [{ id: 'small', label: 'Малый', width: 390, height: 844, touch: true }, { id: 'large', label: 'Большой', width: 844, height: 390, touch: true }],
    scenes: [{ id: 'start', label: 'Старт' }, { id: 'other', label: 'Другой экран' }], themes: ['dark', 'light'],
    validateReport: report => JSON.stringify((report as { snapshots: unknown }).snapshots) === JSON.stringify(snapshotEvidence(out)),
  });
  const browser = await chromium.launch({ executablePath: process.env.GF_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const frame = (side: string) => page.frameLocator(`#${side} iframe`);
  const boot = (side: string) => frame(side).locator('body').getAttribute('data-boot');
  const polls = async () => { for (let i = 0; i < 2; i++) await page.waitForResponse(r => r.url() === server.url + '/config.json'); };
  const observed = async (phase: string) => observations.push({ phase, beforeBoot: await boot('before'), afterBoot: await boot('after'),
    version: await page.locator('#version-after').textContent(), build: await frame('after').locator('#build').textContent(),
    verdict: await page.locator('#verdict').innerText(), css: await frame('after').locator('#asset').evaluate(e => getComputedStyle(e).color) });
  try {
    await page.goto(server.url);
    await page.locator('#profile').selectOption('large'); await page.locator('#scene').selectOption('other'); await page.locator('#theme').selectOption('light');
    await page.locator('#verdict').filter({ hasText: 'проверки пройдены' }).waitFor();
    const beforeBoot = await boot('before'), oldBoot = await boot('after'); assert.ok(oldBoot);
    writeFileSync(join(content, 'index.html'), html(2));
    publishSnapshot(out, 'after', content, { ref: 'checked-v2', version: '2' }); finish();
    await frame('after').locator('#build').filter({ hasText: 'BUILD 2' }).waitFor();
    await page.locator('#verdict').filter({ hasText: 'проверки пройдены' }).waitFor();
    assert.equal(await page.locator('#version-after').textContent(), '2'); assert.equal(await page.locator('#ref-after').textContent(), 'checked-v2');
    assert.notEqual(await boot('after'), oldBoot); assert.equal(await boot('before'), beforeBoot);
    assert.deepEqual(await frame('after').locator('body').evaluate(e => [e.dataset.scene, e.dataset.touch, innerWidth, innerHeight]), ['other', '1', 844, 390]);
    assert.equal(await page.locator('#theme').inputValue(), 'light');
    await observed('successful-html-rebuild'); await page.screenshot({ path: join(proof, 'html-rebuild.png'), fullPage: true });
    const stableBoot = await boot('after'); await polls(); assert.equal(await boot('after'), stableBoot);
    // Перезапись одного отчёта не меняет файлы игры и не должна сбрасывать её состояние.
    finish(); await polls(); assert.equal(await boot('after'), stableBoot); await observed('unchanged-success-poll');
    const originalHash = snapshotEvidence(out).after!.hash;
    writeFileSync(join(out, 'after', 'style.css'), '#asset{color:rgb(40,50,60)}'); finish();
    const afterFrame = await (await page.locator('#after iframe').elementHandle())!.contentFrame();
    await afterFrame!.waitForFunction(() => getComputedStyle(document.querySelector('#asset')!).color === 'rgb(40, 50, 60)');
    await page.locator('#verdict').filter({ hasText: 'проверки пройдены' }).waitFor();
    assert.equal(snapshotEvidence(out).after!.hash, originalHash, 'При изменении CSS hash HTML прежний');
    assert.notEqual(await boot('after'), stableBoot); assert.equal(await boot('before'), beforeBoot); await observed('successful-css-rebuild');
    await page.locator('#content').selectOption('live');
    await page.locator('#verdict').filter({ hasText: 'проверки пройдены' }).waitFor();
    const liveBoot = await boot('after'), liveBeforeBoot = await boot('before');
    await polls(); assert.equal(await boot('after'), liveBoot);
    writeFileSync(join(content, 'index.html'), html(3));
    publishSnapshot(out, 'after', content, { ref: 'checked-v3', version: '3' }); finish();
    await frame('after').locator('#build').filter({ hasText: 'BUILD 3' }).waitFor();
    await page.locator('#verdict').filter({ hasText: 'проверки пройдены' }).waitFor();
    assert.equal(await frame('after').locator('body').getAttribute('data-live'), '1');
    assert.notEqual(await boot('after'), liveBoot); assert.equal(await boot('before'), liveBeforeBoot);
    await observed('successful-live-rebuild'); await page.screenshot({ path: join(proof, 'live-rebuild.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    writeFileSync(join(proof, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
    await browser.close(); await server.close(); rmSync(out, { recursive: true });
  }
});

interface CheckReport {
  status: string; complete: boolean; failed: number; fatal: string; exitCode: number;
  snapshots: { before: { hash: string }; after: { hash: string } }; toolHash: string;
  profiles: { id: string }[]; results: { errors: string[]; screenshot: string; uiScreenshot: string }[];
}

// Отдельная браузерная команда: обычные pnpm test / ui:test не требуют Chromium.
// Реальный CLI и реальные runners, отдельные каталоги. Не подменяем markInterrupted
// готовым JSON: инъекция происходит только после записанного runner-ом измерения.
for (const id of ['snake', 'superwalk']) test(`${id}: аварийный check сохраняет диагностику и SIGINT сохраняет промежуточный результат`, { timeout: 120000 }, async t => {
  for (const mode of ['fatal', 'sigint']) await t.test(mode, async () => {
    const run = `regression-${id}-${mode}-${process.pid}-${Date.now()}`;
    const out = join(ROOT, 'test-results/ui', id, 'runs', run);
    mkdirSync(out, { recursive: true });
    const cli = (command: string, args: string[] = []) => spawn(process.execPath, ['tests/ui/cli.ts', command, id, '--run', run, ...args], {
      cwd: ROOT, env: { ...process.env, GF_UI_RUN: run, GF_UI_PROFILES: id === 'snake' ? 'phone-landscape,fullhd' : 'tablet-landscape' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const baseline = cli('baseline', ['--ref', 'HEAD']);
    let log = ''; baseline.stdout.on('data', b => log += String(b)); baseline.stderr.on('data', b => log += String(b));
    assert.equal((await once(baseline, 'close'))[0], 0, log);
    const child = cli('check');
    child.stdout.on('data', b => log += String(b)); child.stderr.on('data', b => log += String(b));
    let ended = false; const closed = once(child, 'close').then(value => { ended = true; return value; });
    let injected = false;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90000);
    try {
      const file = join(out, 'report.json');
      while (!ended && !injected) {
        let report: CheckReport | undefined;
        try { if (existsSync(file)) report = JSON.parse(readFileSync(file, 'utf8')) as CheckReport; } catch { /* Ожидаем первую запись runner-а. */ }
        if (report?.status === 'running' && report.results?.some(r => r.screenshot)) {
          injected = true;
          if (mode === 'fatal') appendFileSync(join(out, 'after', 'index.html'), '\n<!-- Проверка изменения артефакта во время check -->');
          else child.kill('SIGINT');
        } else await delay(20);
      }
      const [code] = await closed;
      assert.equal(injected, true, log);
      assert.equal(code, mode === 'sigint' ? 130 : 1, log);
      const report = JSON.parse(readFileSync(file, 'utf8')) as CheckReport;
      assert.equal(report.status, 'interrupted-or-failed'); assert.equal(report.complete, false); assert.ok(report.failed >= 1);
      assert.equal(report.exitCode, mode === 'sigint' ? 130 : 1);
      assert.match(report.fatal, mode === 'sigint' ? /SIGINT/ : /HTML не совпадает|Сборка.*инструмент.*(изменились|поменялись)/);
      assert.ok(report.snapshots.before.hash); assert.ok(report.snapshots.after.hash); assert.ok(report.toolHash);
      assert.ok(report.profiles.length); assert.ok(report.results.length);
      const captured = report.results.filter(r => r.screenshot);
      assert.ok(captured.length); assert.ok(captured.every(r => existsSync(join(out, r.screenshot))));
      if (id === 'snake' && mode === 'fatal') assert.ok(report.results.some(r => r.errors.includes('Игровое поле выходит за экран')), 'Не потеряна ошибка уже измеренного состояния');
    } finally {
      clearTimeout(timeout);
      if (!ended) { child.kill('SIGKILL'); await closed; }
      // Результаты оставляем как доказательства, базы каждого теста имеют новое имя.
    }
  });
});
