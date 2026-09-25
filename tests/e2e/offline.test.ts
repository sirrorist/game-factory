// Офлайн-архив: распаковали, открыли index.html через file:// — игра работает.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';
import { buildData, launchBrowser } from './helpers.ts';

let browser: Browser;
let data: string;

/** Распаковать архив игры, как это сделает человек, и вернуть file://-адрес index.html. */
function unpack(id: string, version: string): string {
  const out = mkdtempSync(join(tmpdir(), 'gf-offline-'));
  const r = spawnSync('unzip', ['-q', join(data, `storage/exports/${id}-${version}.zip`), '-d', out]);
  assert.equal(r.status, 0, 'unzip');
  return pathToFileURL(join(out, `${id}-${version}`, 'index.html')).href;
}

before(async () => {
  data = buildData();
  browser = await launchBrowser();
});

after(() => browser?.close());

test('змейка из архива запускается через file:// и сохраняет рекорд', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Еда появляется случайно; попади она на путь змейки — счёт будет не 0 (так упал CI #1).
  // Math.random = 0 кладёт еду в клетку (0,0), в стороне от пути по строке 10.
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(unpack('snake', '1.0.0'));
  await page.waitForSelector('html[data-gf-ready="standalone"]', { timeout: 5000 });
  assert.equal(await page.textContent('#mode'), 'без хаба');
  assert.equal(await page.textContent('#best'), '—');

  // Змейка едет вправо и через ~1,2 с врезается в стену.
  await page.click('#start');
  await page.waitForSelector('#start:not([hidden])', { timeout: 5000 });
  assert.match((await page.textContent('#message')) ?? '', /Игра окончена/);
  assert.equal(await page.textContent('#best'), '0');

  // Рекорд переживает перезагрузку: localStorage на file:// работает.
  await page.reload();
  await page.waitForSelector('html[data-gf-ready="standalone"]');
  assert.equal(await page.textContent('#best'), '0');

  const roundTrip = await page.evaluate(async () => {
    const s = await window.GameFactory.init({ gameId: 'snake' });
    await s.save('probe', { level: 3, name: 'тест' });
    return { mode: s.mode, player: s.player, value: await s.load('probe'), missing: await s.load('nope') };
  });
  assert.deepEqual(roundTrip, { mode: 'standalone', player: null, value: { level: 3, name: 'тест' }, missing: null });

  assert.deepEqual(errors, []);
  await context.close();
});

// Игры на движках: офлайн-сборка @gf/vite-config — один HTML с классическим скриптом.
for (const { id, start } of [
  { id: 'phaser-2d', start: null },
  { id: 'three-3d', start: 'Space' },
]) {
  test(`${id} из архива запускается через file:// и рисует кадр`, async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(unpack(id, '1.0.0'));
    await page.waitForSelector('html[data-gf-ready="standalone"]', { timeout: 10000 });
    assert.equal(await page.textContent('#mode'), 'без хаба');
    assert.equal(await page.locator('canvas').count(), 1);
    if (start) await page.keyboard.press(start);
    // Кадр не пустой: движок действительно рисует, а не просто создал canvas.
    await page.waitForTimeout(500);
    const shot = await page.locator('canvas').screenshot();
    assert.ok(shot.length > 2000, `кадр подозрительно пустой: ${shot.length} байт`);

    const roundTrip = await page.evaluate(async (gameId) => {
      const s = await window.GameFactory.init({ gameId });
      await s.save('probe', { ok: true });
      return { mode: s.mode, value: await s.load('probe'), score: await s.submitScore(5) };
    }, id);
    assert.deepEqual(roundTrip, { mode: 'standalone', value: { ok: true }, score: { best: 5, isBest: true } });

    assert.deepEqual(errors, []);
    await context.close();
  });
}
