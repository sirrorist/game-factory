// Поток без EOF: отказ должен происходить во время чтения, до любых auth/mail операций.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { authMailKeys, type AnyDb, type AuthMailStore } from '@gf/db';
import { authActionHttp } from '../src/lib/auth-actions-http.ts';
import { CSRF_COOKIE, CSRF_HEADER } from '../src/lib/csrf-names.ts';
const origin = 'https://hub.example', csrf = 's'.repeat(43), keys = authMailKeys([Buffer.alloc(32, 51)]);

function fixture(purpose: 'verify' | 'reset', action: 'request' | 'consume', content: string) {
  let sideEffects = 0, cancelled = 0;
  const forbidden = () => { sideEffects++; throw new Error('не должно быть обращения за пределами чтения body'); };
  const db = new Proxy({}, { get: forbidden }) as AnyDb;
  const store = new Proxy({}, { get: forbidden }) as AuthMailStore;
  const handle = authActionHttp({ db, origin, keys, store, enabled: true, session: async () => forbidden() });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(Buffer.from(content)); }, cancel() { cancelled++; } });
  const req = new Request(origin + '/api/account/action', { method: 'POST', body: stream, duplex: 'half',
    headers: { origin, 'content-type': 'application/json', cookie: `${CSRF_COOKIE}=${csrf}`, [CSRF_HEADER]: csrf },
  } as RequestInit & { duplex: 'half' });
  let result: Response | undefined;
  const promise = handle(req, purpose, action).then(response => { result = response; });
  return { req, promise, result: () => result, sideEffects: () => sideEffects, cancelled: () => cancelled,
    close() { if (!cancelled) controller.close(); } };
}
async function flush() { for (let n = 0; n < 20; n++) await turn(); }
function validBody(purpose: 'verify' | 'reset', action: 'request' | 'consume') {
  return JSON.stringify(action === 'request' ? { email: 'synthetic@example.test', intent: keys.intent() }
    : { token: 'A'.repeat(43), ...(purpose === 'reset' ? { password: 'Synthetic new password' } : {}) });
}
const routes = [['verify', 'request'], ['verify', 'consume'], ['reset', 'request'], ['reset', 'consume']] as const;

test('body: более 4096 прочитанных байт без EOF отвергаются до таймера и store/consume', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [purpose, action] of routes) {
    const content = validBody(purpose, action) + ' '.repeat(4097);
    const f = fixture(purpose, action, content);
    try {
      await flush(); // Пять секунд не прошли; EOF так и не был передан.
      assert.ok(f.result(), 'ограничение размера должно сработать без EOF/таймера');
      assert.equal(f.result()!.status, 400); assert.equal(f.cancelled(), 1);
      assert.equal(f.sideEffects(), 0); assert.equal(f.req.body!.locked, false);
    } finally { f.close(); await f.promise; }
  }
});

test('body: без EOF чтение отменяется через 5000 мс, даже если JSON уже полный', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [purpose, action] of routes) for (const complete of [false, true]) {
    const f = fixture(purpose, action, complete ? validBody(purpose, action) : '{');
    try {
      await flush(); assert.equal(f.result(), undefined);
      t.mock.timers.tick(4999); await flush(); assert.equal(f.result(), undefined);
      t.mock.timers.tick(1); await flush();
      assert.ok(f.result(), 'дедлайн должен завершать чтение без EOF');
      assert.equal(f.result()!.status, 400); assert.equal(f.cancelled(), 1);
      assert.equal(f.sideEffects(), 0); assert.equal(f.req.body!.locked, false);
    } finally { f.close(); await f.promise; }
  }
});
