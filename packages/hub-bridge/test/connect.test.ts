// Граница моста без браузера: окно хаба и iframe - заглушки, сообщения подаются напрямую.
// Здесь - то, что e2e ловит плохо или не ловит вовсе (docs/TESTING.md, "честно"): подмена
// origin суффиксом, точный целевой origin ответа (инвариант 4), лимит запросов.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectGame, PROTOCOL, type ConnectOptions } from '../src/index.ts';

const GAME_ORIGIN = 'https://snake.play.example';

interface Sent {
  message: Record<string, unknown>;
  targetOrigin: string;
}

function setup(extra: Partial<ConnectOptions> = {}) {
  let listener: ((e: MessageEvent) => void) | null = null;
  const host = {
    addEventListener: (_: string, fn: (e: MessageEvent) => void) => (listener = fn),
    removeEventListener: () => (listener = null),
  } as unknown as Window;
  const sent: Sent[] = [];
  const gameWindow = {
    postMessage: (message: Record<string, unknown>, targetOrigin: string) => sent.push({ message, targetOrigin }),
  };
  const saves: string[] = [];
  connectGame({
    host,
    iframe: { contentWindow: gameWindow } as unknown as HTMLIFrameElement,
    gameId: 'snake',
    gameOrigin: GAME_ORIGIN,
    player: { id: 'p1', name: 'Игрок' },
    handlers: {
      save: async (key) => void saves.push(key),
      load: async () => '{"level":3}',
      submitScore: async (score) => ({ best: score, isBest: true }),
      bestScore: async () => null,
    },
    ...extra,
  });
  const deliver = (data: unknown, origin = GAME_ORIGIN, source: unknown = gameWindow) =>
    listener!({ data, origin, source } as unknown as MessageEvent);
  return { deliver, sent, saves };
}

const tick = () => new Promise((r) => setImmediate(r));
const save = (id: number, key = 'progress') => ({ gf: PROTOCOL, type: 'request', id, method: 'save', params: { key, value: '1' } });

test('запрос от окна и origin игры принимается', async () => {
  const { deliver, saves } = setup();
  deliver(save(1));
  await tick();
  assert.deepEqual(saves, ['progress']);
});

test('origin, похожий на origin игры, не принимается - только точное совпадение', async () => {
  const { deliver, saves, sent } = setup();
  for (const origin of [
    'https://x-snake.play.example', // другая игра: id с дефисом оканчивается хостом snake
    'https://snake.play.example.evil.test',
    'http://snake.play.example',
    'https://snake.play.example:8443',
    'https://SNAKE.play.example',
  ]) {
    deliver(save(1, origin.replace(/\W/g, '_').slice(0, 60)), origin);
  }
  await tick();
  assert.deepEqual(saves, []);
  assert.deepEqual(sent, [], 'на чужой origin мост не отвечает ничем');
});

test('верный origin из чужого окна не принимается', async () => {
  const { deliver, saves } = setup();
  deliver(save(1), GAME_ORIGIN, {});
  deliver(save(2), GAME_ORIGIN, null);
  await tick();
  assert.deepEqual(saves, []);
});

test('ответы моста уходят только на точный origin игры', async () => {
  const { deliver, sent } = setup();
  deliver({ gf: PROTOCOL, type: 'hello', gameId: 'snake', sdk: '1' });
  deliver({ gf: PROTOCOL, type: 'request', id: 1, method: 'load', params: { key: 'progress' } });
  deliver({ gf: PROTOCOL, type: 'request', id: 2, method: 'save', params: { key: 'x', value: 'не json' } });
  await tick();
  assert.deepEqual(
    sent.map((s) => s.message.type),
    ['welcome', 'response', 'response'],
  );
  for (const s of sent) assert.equal(s.targetOrigin, GAME_ORIGIN, JSON.stringify(s.message));
});

test('лимит по умолчанию - 20 запросов в секунду, лишние получают rate-limited', async () => {
  const { deliver, sent, saves } = setup();
  for (let id = 1; id <= 25; id++) deliver(save(id));
  await tick();
  assert.equal(saves.length, 20);
  const limited = sent.filter((s) => s.message.error === 'rate-limited').map((s) => s.message.id);
  assert.deepEqual(limited, [21, 22, 23, 24, 25]);
});

test('лимит - на любые сообщения: hello в цикле не даёт поток welcome', async () => {
  const events: string[] = [];
  const { deliver, sent } = setup({ onEvent: (e) => void events.push(e.type === 'rejected' ? e.reason : e.type) });
  for (let i = 0; i < 1000; i++) deliver({ gf: PROTOCOL, type: 'hello', gameId: 'snake', sdk: '1' });
  await tick();
  assert.equal(sent.length, 20);
  assert.equal(events.filter((e) => e === 'rate-limited').length, 1, 'одно событие на окно, а не на каждое лишнее');
});

test('через секунду лимит снова пропускает', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { deliver, saves } = setup();
  for (let id = 1; id <= 25; id++) deliver(save(id));
  t.mock.timers.tick(999);
  deliver(save(26));
  t.mock.timers.tick(1);
  deliver(save(27, 'after'));
  await tick();
  assert.equal(saves.length, 21);
  assert.equal(saves.at(-1), 'after');
});

test('счётчик у каждого подключения свой: игроки друг другу лимит не съедают', async () => {
  const a = setup();
  const b = setup();
  for (let id = 1; id <= 25; id++) a.deliver(save(id));
  for (let id = 1; id <= 20; id++) b.deliver(save(id));
  await tick();
  assert.equal(a.saves.length, 20);
  assert.equal(b.saves.length, 20);
});

test('чужие сообщения не тратят лимит игры: проверка окна и origin - до счётчика', async () => {
  const events: string[] = [];
  const { deliver, sent, saves } = setup({ onEvent: (e) => void events.push(e.type === 'rejected' ? e.reason : e.type) });
  for (let id = 1; id <= 25; id++) deliver(save(id), 'https://evil.example');
  for (let id = 1; id <= 25; id++) deliver(save(id), GAME_ORIGIN, {});
  deliver(save(100, 'real'));
  await tick();
  assert.deepEqual(saves, ['real']);
  assert.deepEqual(sent.map((s) => s.message.id), [100], 'на чужие id мост не отвечает');
  assert.ok(!events.includes('rate-limited'));
});
