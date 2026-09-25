// Игра в iframe эталонного хаба: протокол SDK и границы песочницы.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { Browser, Frame, Page } from 'playwright';
import { buildData, close, launchBrowser, listen, mockHub, startPlay } from './helpers.ts';

let browser: Browser;
let play: { server: Server; port: number };
let hub: Server;
let hubPort: number;
let stranger: Server;
let strangerPort: number;

const gameOrigin = (): string => `http://snake.play.localhost:${play.port}`;

before(async () => {
  const data = buildData();
  // Порт хаба нужен серверу игр для frame-ancestors, а хабу — порт игр: сперва хаб.
  hub = mockHub(() => ({ gameId: 'snake', gameOrigin: gameOrigin() }));
  hubPort = await listen(hub);
  play = await startPlay(data, [`http://localhost:${hubPort}`]);
  // Такой же «хаб», но на origin, которого нет в frame-ancestors.
  stranger = mockHub(() => ({ gameId: 'snake', gameOrigin: gameOrigin() }));
  strangerPort = await listen(stranger);
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await Promise.all([close(hub), close(play.server), close(stranger)]);
});

async function openHub(): Promise<{ page: Page; game: Frame; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${hubPort}/`);
  await page.waitForSelector('body[data-game-ready="1"]', { timeout: 5000 });
  const game = page.frames().find((f) => f.url().startsWith(gameOrigin()));
  assert.ok(game, 'фрейм игры не найден');
  return { page, game, errors };
}

test('игра узнаёт хаб, сохранения и очки уходят в хаб', async () => {
  const { page, game, errors } = await openHub();
  assert.equal(await game.textContent('#mode'), 'в хабе');

  const r = await game.evaluate(async () => {
    const s = await window.GameFactory.init({ gameId: 'snake' });
    await s.save('probe', { n: 1 });
    const score = await s.submitScore(7);
    const lower = await s.submitScore(3);
    return { mode: s.mode, player: s.player, value: await s.load('probe'), score, lower, best: await s.bestScore() };
  });
  assert.deepEqual(r, {
    mode: 'hub',
    player: { id: 'p1', name: 'Тестер' },
    value: { n: 1 },
    score: { best: 7, isBest: true },
    lower: { best: 7, isBest: false },
    best: 7,
  });

  // Данные легли в хранилище хаба, а не игры.
  const stored = await page.evaluate(() => ({
    save: localStorage.getItem('gf-hub:snake:save:probe'),
    best: localStorage.getItem('gf-hub:snake:best'),
  }));
  assert.deepEqual(stored, { save: '{"n":1}', best: '7' });
  const gameSide = await game.evaluate(() => localStorage.getItem('gf:snake:best'));
  assert.equal(gameSide, null);

  assert.deepEqual(errors, []);
  await page.close();
});

test('мост отвергает кривые запросы игры', async () => {
  const { page, game } = await openHub();
  const r = await game.evaluate(async () => {
    const results: string[] = [];
    const s = await window.GameFactory.init({ gameId: 'snake' });
    for (const bad of [() => s.save('bad key!', 1), () => s.submitScore(Number.NaN), () => s.save('big', 'x'.repeat(70000))]) {
      try {
        await bad();
        results.push('принято');
      } catch {
        results.push('отказ');
      }
    }
    return results;
  });
  assert.deepEqual(r, ['отказ', 'отказ', 'отказ']);
  await page.close();
});

test('поддельные сообщения не от iframe игры игнорируются', async () => {
  const { page } = await openHub();
  const origin = gameOrigin();
  await page.evaluate((gameOrigin) => {
    const iframe = document.getElementById('game') as HTMLIFrameElement;
    const request = { gf: 1, type: 'request', id: 999, method: 'save', params: { key: 'forged', value: '1' } };
    // Верное окно, чужой origin.
    window.dispatchEvent(new MessageEvent('message', { data: request, origin: 'http://evil.localhost', source: iframe.contentWindow }));
    // Верный origin, но не то окно.
    window.dispatchEvent(new MessageEvent('message', { data: request, origin: gameOrigin, source: window }));
  }, origin);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => localStorage.getItem('gf-hub:snake:save:forged')), null);
  await page.close();
});

test('игра не дотягивается до хаба: DOM, хранилище, навигация', async () => {
  const { page, game } = await openHub();
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
      out.nav = 'no-throw';
    } catch {
      out.nav = 'blocked';
    }
    return out;
  });
  assert.equal(r.dom, 'blocked');
  assert.equal(r.storage, 'blocked');
  await page.waitForTimeout(300);
  assert.equal(page.url(), hubUrl, 'игра увела вкладку хаба');
  await page.close();
});

test('чужой сайт не может встроить игру (frame-ancestors)', async () => {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${strangerPort}/`);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.body.dataset.gameReady ?? null), null);
  const game = page.frames().find((f) => f.url().startsWith(gameOrigin()));
  const hasGame = game ? await game.evaluate(() => typeof window.GameFactory).catch(() => 'no-access') : 'no-frame';
  assert.notEqual(hasGame, 'object', 'игра загрузилась на чужом сайте');
  await page.close();
});
