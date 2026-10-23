import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMail, RESEND_URL, retryAfter } from '../src/provider.ts';
import type { WireRequest } from '../src/io.ts';
import { LIMITS } from '../src/protocol.ts';
import { config, mail, reply, PROVIDER_ID } from './fixtures.ts';

const parent = () => new AbortController().signal;
test('провайдер: неизменный POST, ключ и payload при повторе и новом вызове', async () => {
  const seen: WireRequest[] = [];
  const cache = new Map<string, string>();
  let delivered = 0;
  let lose = true;
  const exchange = async (request: WireRequest) => {
    seen.push(request);
    assert.equal(request.url, RESEND_URL);
    const key = request.headers['idempotency-key']!;
    if (!cache.has(key)) { delivered++; cache.set(key, request.body); }
    assert.equal(cache.get(key), request.body);
    if (lose) throw new Error('ответ потерян после принятия');
    return reply();
  };
  const options = { expiresAt: Date.now() + LIMITS.operationMs, exchange, wait: async () => {}, now: () => 0 };
  const first = await sendMail(mail, config, parent(), 20000, options);
  assert.equal(first.outcome, 'unknown');
  lose = false;
  const second = await sendMail(mail, config, parent(), 20000, options);
  assert.equal(second.outcome, 'accepted');
  assert.equal(seen.length, 3);
  assert.equal(delivered, 1);
  for (const request of seen) {
    assert.equal(request.headers.authorization, 'Bearer ' + config.apiKey);
    assert.equal(request.headers['idempotency-key'], mail.operationId);
    assert.equal(request.body, seen[0]!.body);
  }
  assert.equal(JSON.stringify(second).includes(PROVIDER_ID), false);
});
test('ошибки: квота/конфликт/постоянный отказ не запускают повтор', async () => {
  const cases = [
    [429, 'daily_quota_exceeded', 'quota_exhausted', 'not_accepted'],
    [429, 'monthly_quota_exceeded', 'quota_exhausted', 'not_accepted'],
    [409, 'invalid_idempotent_request', 'idempotency_conflict', 'unknown'],
    [401, 'validation_error', 'provider_error', 'not_accepted'],
    [403, 'restricted_api_key', 'provider_error', 'not_accepted'],
    [422, 'validation_error', 'provider_error', 'not_accepted'],
    [429, 'new_unrecognized_error', 'provider_error', 'not_accepted'],
    [302, 'redirect', 'provider_error', 'not_accepted'],
  ] as const;
  for (const [status, name, code, outcome] of cases) {
    let count = 0;
    const result = await sendMail(mail, config, parent(), 20000, {
      expiresAt: Date.now() + LIMITS.operationMs,
      now: () => 0, exchange: async () => { count++; return reply(status, name); },
    });
    assert.equal(count, 1, name);
    assert.deepEqual(result, { outcome, code });
  }
});
test('неизвестные 500/502/504 возвращают unknown без автоматического повтора', async () => {
  for (const status of [500, 502, 504]) {
    for (const name of ['new_unrecognized_error', undefined]) {
      for (const retry of [undefined, '1']) {
        let count = 0;
        const response = {
          ...reply(status, name, retry),
          ...(name === undefined ? { body: '{}' } : {}),
        };
        const actual = await sendMail(mail, config, parent(), 20000, {
          expiresAt: Date.now() + LIMITS.operationMs,
          now: () => 0,
          exchange: async () => { count++; return response; },
          wait: async () => assert.fail('неизвестный 5xx не разрешает повтор'),
        });
        assert.equal(count, 1);
        assert.deepEqual(actual, {
          outcome: 'unknown', code: 'provider_error',
          ...(retry === undefined ? {} : { retryAfterSeconds: 1 }),
        });
      }
    }
  }
});
test('ошибки: неопределённость сохраняется после отказа второй попытки', async () => {
  let count = 0;
  const result = await sendMail(mail, config, parent(), 20000, {
    expiresAt: Date.now() + LIMITS.operationMs,
    now: () => 0, wait: async () => {},
    exchange: async () => { if (++count === 1) throw new Error('API accepted, response lost'); return reply(429, 'daily_quota_exceeded'); },
  });
  assert.equal(count, 2);
  assert.deepEqual(result, { outcome: 'unknown', code: 'quota_exhausted' });
});
test('409 concurrent повторяем тем же ключом; незавершённый результат unknown', async () => {
  let count = 0;
  const seen: string[] = [];
  const result = await sendMail(mail, config, parent(), 20000, {
    expiresAt: Date.now() + LIMITS.operationMs,
    now: () => 0, wait: async () => {},
    exchange: async (request) => { count++; seen.push(request.headers['idempotency-key']!); return reply(409, 'concurrent_idempotent_requests'); },
  });
  assert.equal(count, 2);
  assert.deepEqual(seen, [mail.operationId, mail.operationId]);
  assert.deepEqual(result, { outcome: 'unknown', code: 'concurrent_request' });
});
test('Retry-After: секунды, HTTP-date и запрет неверного/слишком большого срока', () => {
  const date = Date.UTC(2026, 9, 21, 0, 0, 0);
  assert.deepEqual(retryAfter('1', date), { ms: 1000, seconds: 1 });
  assert.deepEqual(retryAfter('0', date), { ms: 0, seconds: 0 });
  assert.deepEqual(retryAfter(new Date(date + 2000).toUTCString(), date), { ms: 2000, seconds: 2 });
  for (const value of ['-1', '1.2', '9999999999999999999', 'tomorrow', 'Wed, 21 Oct 2126 00:00:00 GMT']) {
    assert.equal(retryAfter(value, date), 'invalid');
  }
});
test('скорость и бюджет: не повторяем раньше Retry-After и не перемножаем попытки', async () => {
  for (const header of [undefined, '20', '999999999999999999999', '-1']) {
    let count = 0;
    const result = await sendMail(mail, config, parent(), 12000, {
      expiresAt: Date.now() + LIMITS.operationMs,
      now: () => 0, exchange: async () => { count++; return reply(429, 'rate_limit_exceeded', header); },
    });
    assert.equal(count, 1);
    assert.equal(result.code, 'rate_limited');
  }
  let count = 0;
  let clock = 0;
  const pauses: number[] = [];
  const result = await sendMail(mail, config, parent(), 12000, {
    expiresAt: Date.now() + LIMITS.operationMs,
    now: () => clock,
    wait: async (ms) => { pauses.push(ms); clock += ms; },
    exchange: async () => ++count === 1 ? reply(429, 'rate_limit_exceeded', '1') : reply(),
  });
  assert.deepEqual(pauses, [1000]);
  assert.equal(count, 2);
  assert.equal(result.outcome, 'accepted');
  count = 0;
  await sendMail(mail, config, parent(), 5200, {
    expiresAt: Date.now() + LIMITS.operationMs,
    now: () => 0, exchange: async () => { count++; throw new Error(); },
    wait: async () => assert.fail('пауза и полная попытка не помещаются'),
  });
  assert.equal(count, 1);
});
test('отмена прекращает паузу, а таймаут попытки отменяет весь ответ', async () => {
  const controller = new AbortController();
  let count = 0;
  const result = await sendMail(mail, config, controller.signal, 20000, {
    expiresAt: Date.now() + LIMITS.operationMs,
    now: () => 0, exchange: async () => { count++; return reply(503, 'service_unavailable'); },
    wait: async () => { controller.abort(); throw new Error(); },
  });
  assert.equal(count, 1);
  assert.deepEqual(result, { outcome: 'unknown', code: 'cancelled' });
  const timed = await sendMail(mail, config, parent(), performance.now() + 20, {
    expiresAt: Date.now() + LIMITS.operationMs,
    attemptMs: 10,
    exchange: async (_request, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error()), { once: true })),
  });
  assert.equal(timed.outcome, 'unknown');
});
test('чужие поля и сообщения upstream не попадают в результат', async () => {
  const result = await sendMail(mail, config, parent(), 20000, {
    expiresAt: Date.now() + LIMITS.operationMs,
    now: () => 0,
    exchange: async () => ({ status: 401, headers: {}, body: JSON.stringify({ name: mail.url, message: config.apiKey, operation: mail.operationId }) }),
  });
  assert.deepEqual(result, { outcome: 'not_accepted', code: 'provider_error' });
  const bad = await sendMail(mail, config, parent(), 20000, {
    expiresAt: Date.now() + LIMITS.operationMs,
    now: () => 0, exchange: async () => ({ status: 200, headers: {}, body: 'x'.repeat(17000) }),
  });
  assert.equal(bad.outcome, 'unknown');
});

test('окно операции: истечение во время первой попытки запрещает следующую', async () => {
  let wall = 1000;
  let mono = 0;
  let count = 0;
  let pauses = 0;
  const actual = await sendMail(mail, config, parent(), 20000, {
    expiresAt: 8000, now: () => mono, wallNow: () => wall,
    exchange: async () => { count++; mono += 7000; wall += 7000; return reply(500, 'application_error'); },
    wait: async () => { pauses++; },
  });
  assert.deepEqual(actual, { outcome: 'unknown', code: 'operation_expired' });
  assert.equal(count, 1);
  assert.equal(pauses, 0);
});
test('окно операции: полная попытка, пауза и монотонный предел не продлеваются', async () => {
  for (const mode of ['short', 'pause', 'clock-back']) {
    let wall = 1000;
    let mono = 0;
    let count = 0;
    const actual = await sendMail(mail, config, parent(), 20000, {
      expiresAt: mode === 'short' ? 6999 : 8000,
      now: () => mono, wallNow: () => wall,
      exchange: async () => { count++; return reply(500, 'application_error'); },
      wait: async () => { mono += 7000; wall += mode === 'clock-back' ? -1000 : 7000; },
    });
    assert.deepEqual(actual, { outcome: 'unknown', code: 'operation_expired' }, mode);
    assert.equal(count, mode === 'short' ? 0 : 1, mode);
  }
});
