import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHubMailClient, restorePreparedMail, hubMailClientFromEnv } from '../src/lib/mail-client.ts';
import { LIMITS } from '../../mail-relay/src/protocol.ts';
import { ORIGIN, SECRET, input, startRelay } from '../../mail-relay/test/fixtures.ts';

const cfg = { endpoint: 'http://mail-relay:4102/v1/send', hubOrigin: ORIGIN, serviceSecret: SECRET };
test('клиент: один ID на подготовленную отправку и сохранённый снимок', async () => {
  const calls: string[] = [];
  const client = createHubMailClient(cfg, {
    now: () => 1000,
    exchange: async (request) => { calls.push(request.body); return { status: 202, headers: {}, body: '{"outcome":"accepted","code":"accepted_by_provider"}' }; },
  });
  const { operationId: _id, ...data } = input;
  const prepared = client.prepare(data);
  const restored = restorePreparedMail(JSON.parse(JSON.stringify(prepared)), ORIGIN);
  assert.ok(Object.isFrozen(prepared));
  assert.equal((await client.send(prepared)).outcome, 'accepted');
  assert.equal((await client.send(restored)).outcome, 'accepted');
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
  assert.match(JSON.parse(calls[0]!).operationId, /^[0-9a-f-]{36}$/);
});
test('клиент: потеря ответа не вызывает скрытый повтор и не меняет ID', async () => {
  let count = 0;
  const client = createHubMailClient(cfg, { exchange: async () => { count++; throw new Error(input.url); } });
  const { operationId: _id, ...data } = input;
  const prepared = client.prepare(data);
  assert.deepEqual(await client.send(prepared), { outcome: 'unknown', code: 'transport_error' });
  assert.equal(count, 1);
  assert.equal(prepared.body, restorePreparedMail(prepared, ORIGIN).body);
});
test('клиент: истечение окна, будущая дата и ранняя отмена не отправляют письмо', async () => {
  let clock = 1000;
  let count = 0;
  const client = createHubMailClient(cfg, { now: () => clock, exchange: async () => { count++; throw new Error(); } });
  const { operationId: _id, ...data } = input;
  const mail = client.prepare(data);
  clock += 24 * 60 * 60 * 1000;
  assert.equal((await client.send(mail)).code, 'operation_expired');
  clock = 0;
  assert.equal((await client.send(mail)).code, 'invalid_request');
  clock = 1000;
  const controller = new AbortController(); controller.abort();
  assert.equal((await client.send(mail, controller.signal)).code, 'cancelled');
  assert.equal(count, 0);
});
test('клиент: ошибочный ответ, редирект и чужие поля не отражаются и не повторяются', async () => {
  for (const reply of [
    { status: 302, body: '{}' },
    { status: 202, body: '{"outcome":"accepted","code":"accepted_by_provider","secret":"' + SECRET + '"}' },
    { status: 503, body: '{"outcome":"accepted","code":"accepted_by_provider"}' },
    { status: 503, body: 'bad ' + input.url },
    { status: 503, body: 'x'.repeat(1025) },
  ]) {
    let count = 0;
    const client = createHubMailClient(cfg, { exchange: async () => { count++; return { ...reply, headers: {} }; } });
    const { operationId: _id, ...data } = input;
    const result = await client.send(client.prepare(data));
    assert.deepEqual(result, { outcome: 'unknown', code: 'transport_error' });
    assert.equal(count, 1);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
  assert.throws(() => createHubMailClient({ ...cfg, endpoint: 'https://evil.example/v1/send' }));
  assert.throws(() => createHubMailClient({ ...cfg, serviceSecret: '' }));
  assert.throws(() => hubMailClientFromEnv({ GF_MAIL_RELAY_URL: 'https://evil.example/v1/send' }));
});
test('клиент: полный HTTP-дедлайн отменяет запрос', async () => {
  let aborted = false;
  const client = createHubMailClient(cfg, { timeoutMs: 10, exchange: async (_request, signal) => new Promise((_resolve, reject) =>
    signal.addEventListener('abort', () => { aborted = true; reject(new Error()); }, { once: true })),
  });
  const { operationId: _id, ...data } = input;
  assert.equal((await client.send(client.prepare(data))).outcome, 'unknown');
  assert.equal(aborted, true);
});
test('клиент и шлюз: локальный HTTP без настоящих писем', { timeout: 3000 }, async (t) => {
  const fixture = await startRelay();
  t.after(fixture.close);
  const client = createHubMailClient({ ...cfg, endpoint: fixture.endpoint });
  const { operationId: _id, ...data } = input;
  const mail = client.prepare(data);
  assert.deepEqual(await client.send(mail), { outcome: 'accepted', code: 'accepted_by_provider' });
});

test('клиент: исходный срок неизменен при повторе и недостаточный остаток закрыт', async () => {
  let clock = 1000;
  const expiries: string[] = [];
  const client = createHubMailClient(cfg, { now: () => clock, exchange: async (request) => {
    expiries.push(request.headers['x-gf-mail-expires-at']!);
    return { status: 202, headers: {}, body: '{"outcome":"accepted","code":"accepted_by_provider"}' };
  } });
  const { operationId: _id, ...data } = input;
  const saved = client.prepare(data);
  await client.send(saved);
  clock += 1000;
  await client.send(restorePreparedMail(JSON.parse(JSON.stringify(saved)), ORIGIN));
  assert.deepEqual(expiries, [String(1000 + LIMITS.operationMs), String(1000 + LIMITS.operationMs)]);
  clock = saved.createdAt + LIMITS.operationMs - 1000;
  assert.deepEqual(await client.send(saved), { outcome: 'unknown', code: 'operation_expired' });
  assert.equal(expiries.length, 2);
});
