// Настоящий хаб (apps/hub на Next.js) + сервер игр: то, что увидит игрок.
// Критерий этапа 0б: каталог → игра → сохранение и рекорд → скачать архив → офлайн.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Frame, Page } from 'playwright';
import { buildData, close, freePort, gameVersion, launchBrowser, startHub, startPlay, type Hub } from './helpers.ts';

const GAMES = ['phaser-2d', 'snake', 'three-3d'] as const;

let browser: Browser;
let play: { server: Server; port: number };
let hub: Hub;

const gameOrigin = (id: string): string => `http://${id}.play.localhost:${play.port}`;

before(async () => {
  const data = buildData();
  // Порт хаба нужен серверу игр для frame-ancestors, а хабу - порт игр: хабу порт выбираем заранее.
  const hubPort = await freePort();
  play = await startPlay(data, [`http://localhost:${hubPort}`]);
  hub = await startHub({ port: hubPort, dataDir: data, playPort: play.port });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await hub?.stop();
  if (play) await close(play.server);
});

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function openGame(page: Page, id: string): Promise<Frame> {
  await page.goto(`${hub.origin}/games/${id}`);
  await page.waitForSelector('[data-game-ready="1"]', { timeout: 15000 });
  const game = page.frames().find((f) => f.url().startsWith(gameOrigin(id)));
  assert.ok(game, `фрейм ${id} не найден`);
  return game;
}

test('каталог показывает все игры с обложками и кнопкой "Скачать"', async () => {
  const page = await browser.newPage();
  const errors = trackErrors(page);
  await page.goto(`${hub.origin}/`);
  const ids = await page.locator('[data-game-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-game-id')));
  assert.deepEqual([...ids].sort(), [...GAMES]);
  for (const id of GAMES) {
    const card = page.locator(`[data-game-id="${id}"]`);
    assert.equal(await card.getByTestId('download').count(), 1, `${id}: нет кнопки "Скачать"`);
    // Версия в адресе обложки - ключ её долгого кеша на сервере игр.
    const src = await card.locator('img').getAttribute('src');
    assert.equal(src, `http://play.localhost:${play.port}/covers/${id}?v=${gameVersion(id)}`);
    // Обложка пришла со служебного хоста игр и декодировалась.
    const loaded = await card.locator('img').evaluate(async (img: HTMLImageElement) => {
      await img.decode().catch(() => undefined);
      return img.naturalWidth > 0;
    });
    assert.ok(loaded, `${id}: обложка не загрузилась`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test('из каталога в игру: ссылка "Играть" открывает страницу игры', async () => {
  const page = await browser.newPage();
  await page.goto(`${hub.origin}/`);
  await page.locator('[data-game-id="snake"]').getByRole('link', { name: 'Играть' }).click();
  await page.waitForURL(`${hub.origin}/games/snake`);
  await page.waitForSelector('[data-game-ready="1"]', { timeout: 15000 });
  await page.close();
});

for (const id of GAMES) {
  test(`${id}: в хабе - сохранения и рекорд уходят в хаб и видны на странице`, async () => {
    const page = await browser.newPage();
    const errors = trackErrors(page);
    const game = await openGame(page, id);
    assert.equal(await game.textContent('#mode'), 'в хабе');
    assert.equal(await page.getByTestId('hub-best').textContent(), '-');

    const r = await game.evaluate(async (gameId) => {
      const s = await window.GameFactory.init({ gameId });
      await s.save('probe', { n: 1 });
      return { mode: s.mode, player: s.player, value: await s.load('probe'), score: await s.submitScore(12) };
    }, id);
    assert.deepEqual(r, { mode: 'hub', player: null, value: { n: 1 }, score: { best: 12, isBest: true } });

    // Рекорд виден в интерфейсе хаба и лежит в хранилище хаба, а не игры.
    await page.getByTestId('hub-best').filter({ hasText: '12' }).waitFor({ timeout: 3000 });
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), `gf-hub:${id}:best`), '12');
    assert.equal(await game.evaluate((k) => localStorage.getItem(k), `gf:${id}:best`), null);

    // После перезагрузки хаб помнит рекорд, а игра получает его через SDK.
    await page.reload();
    const again = await (async () => {
      await page.waitForSelector('[data-game-ready="1"]', { timeout: 15000 });
      return page.frames().find((f) => f.url().startsWith(gameOrigin(id)))!;
    })();
    assert.equal(await page.getByTestId('hub-best').textContent(), '12');
    assert.equal(await again.textContent('#best'), '12');

    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('права манифеста: fullscreen есть только у игр, которые его просили', async () => {
  const page = await browser.newPage();
  // phaser-2d просит fullscreen, snake - нет.
  const phaser = await openGame(page, 'phaser-2d');
  assert.equal(await page.locator('iframe#game').getAttribute('allow'), 'fullscreen');
  assert.equal(await phaser.evaluate(() => document.fullscreenEnabled), true);

  const snake = await openGame(page, 'snake');
  assert.equal(await page.locator('iframe#game').getAttribute('allow'), '');
  assert.equal(await snake.evaluate(() => document.fullscreenEnabled), false);
  await page.close();
});

test('песочница настоящего хаба: игра не достаёт DOM, хранилище и вкладку хаба', async () => {
  const page = await browser.newPage();
  const game = await openGame(page, 'snake');
  const hubUrl = page.url();
  const r = await game.evaluate(() => {
    const out: Record<string, string> = {};
    try {
      out.dom = String(window.parent.document.title);
    } catch {
      out.dom = 'blocked';
    }
    try {
      out.storage = String(window.parent.localStorage.length);
    } catch {
      out.storage = 'blocked';
    }
    try {
      window.top!.location.href = 'http://example.invalid/';
    } catch {
      // заблокировано - так и надо
    }
    return out;
  });
  assert.deepEqual(r, { dom: 'blocked', storage: 'blocked' });
  await page.waitForTimeout(300);
  assert.equal(page.url(), hubUrl, 'игра увела вкладку хаба');
  await page.close();
});

test('хаб нельзя встроить в iframe (frame-ancestors none)', async () => {
  const r = await fetch(`${hub.origin.replace('localhost', '127.0.0.1')}/`);
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('неизвестная игра и мусор вместо id - 404', async () => {
  const base = hub.origin.replace('localhost', '127.0.0.1');
  for (const path of ['/games/nope', '/games/..%2F..%2Fetc', '/games/SNAKE']) {
    const r = await fetch(base + path);
    assert.equal(r.status, 404, path);
  }
});

for (const id of GAMES) {
  test(`${id}: "Скачать" в хабе → архив → запуск через file://`, async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${hub.origin}/`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(`[data-game-id="${id}"]`).getByTestId('download').click(),
    ]);
    assert.equal(download.suggestedFilename(), `${id}-${gameVersion(id)}.zip`);
    const dir = mkdtempSync(join(tmpdir(), 'gf-download-'));
    const zip = join(dir, download.suggestedFilename());
    await download.saveAs(zip);
    const r = spawnSync('unzip', ['-q', zip, '-d', dir]);
    assert.equal(r.status, 0, 'unzip');

    const offline = await context.newPage();
    const errors = trackErrors(offline);
    await offline.goto(pathToFileURL(join(dir, `${id}-${gameVersion(id)}`, 'index.html')).href);
    await offline.waitForSelector('html[data-gf-ready="standalone"]', { timeout: 10000 });
    assert.equal(await offline.textContent('#mode'), 'без хаба');
    assert.deepEqual(errors, []);
    await context.close();
  });
}
