import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { boundedExchange, nodeExchange } from '../src/io.ts';
import { sendMail } from '../src/provider.ts';
import { LIMITS } from '../src/protocol.ts';
import { config, input, reply, startRelay, deferred, SECRET, API_KEY, TOKEN, OPERATION } from './fixtures.ts';

function call(endpoint: string, body = JSON.stringify(input), headers: Record<string, string> | string[] = {
  authorization: 'Bearer ' + SECRET, 'content-type': 'application/json', 'x-gf-mail-expires-at': String(Date.now() + LIMITS.operationMs),
}, method = 'POST'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(endpoint, { method, headers, agent: false, signal: AbortSignal.timeout(1500) }, (response) => {
      let data = '';
      response.setEncoding('utf8').on('data', (chunk) => { data += chunk; });
      response.once('error', reject).once('end', () => resolve({ status: response.statusCode!, body: data }));
    });
    request.once('error', reject);
    request.end(body);
  });
}
test('HTTP: авторизованное письмо, единственный получатель и безопасные ответы/журналы', { timeout: 3000 }, async (t) => {
  const logs: unknown[] = [];
  let count = 0;
  const fixture = await startRelay({
    log: (entry) => logs.push(entry),
    exchange: async (request) => {
      count++;
      assert.equal(JSON.parse(request.body).to.length, 1);
      return reply();
    },
  });
  t.after(fixture.close);
  const response = await call(fixture.endpoint);
  assert.equal(response.status, 202);
  assert.deepEqual(JSON.parse(response.body), { outcome: 'accepted', code: 'accepted_by_provider' });
  assert.equal(count, 1);
  for (const value of [SECRET, API_KEY, TOKEN, OPERATION, input.to, input.url]) {
    assert.equal(JSON.stringify(logs).includes(value), false);
    assert.equal(response.body.includes(value), false);
  }
});
test('HTTP: неверные секрет, метод, маршрут и заголовки не вызывают провайдера', { timeout: 3000 }, async (t) => {
  let count = 0;
  const fixture = await startRelay({ exchange: async () => { count++; return reply(); } });
  t.after(fixture.close);
  for (const secret of ['', 'Bearer wrong', 'Bearer ' + API_KEY]) {
    assert.equal((await call(fixture.endpoint, JSON.stringify(input), { authorization: secret, 'content-type': 'application/json' })).status, 401);
  }
  const duplicate = ['Host', '127.0.0.1', 'Authorization', 'Bearer ' + SECRET,
    'Authorization', 'Bearer ' + SECRET, 'Content-Type', 'application/json',
    'Content-Length', String(Buffer.byteLength(JSON.stringify(input))), 'Connection', 'close'];
  assert.equal((await call(fixture.endpoint, JSON.stringify(input), duplicate)).status, 401);
  assert.equal((await call(fixture.endpoint + '?next=evil')).status, 404);
  assert.equal((await call(fixture.endpoint.replace('/v1/send', '/other'))).status, 404);
  assert.equal((await call(fixture.endpoint, '', {}, 'GET')).status, 404);
  assert.equal((await call(fixture.endpoint, '{}', { authorization: 'Bearer ' + SECRET, 'content-type': 'text/plain' })).status, 400);
  assert.equal((await call(fixture.endpoint, '{}', { authorization: 'Bearer ' + SECRET, 'content-type': 'application/json', 'content-encoding': 'gzip' })).status, 400);
  assert.equal(count, 0);
});
test('HTTP: фактический размер, дубли JSON и неверные поля отвергаются', { timeout: 3000 }, async (t) => {
  let count = 0;
  const fixture = await startRelay({ exchange: async () => { count++; return reply(); } });
  t.after(fixture.close);
  const bodies = [
    ' '.repeat(16385), JSON.stringify({ ...input, bcc: 'other@example.com' }),
    JSON.stringify(input).replace('}', ',"kind":"reset-password.v1"}'),
    JSON.stringify({ ...input, url: input.url + '&redirect=https://evil.example' }),
    JSON.stringify({ ...input, to: 'first@example.com,second@example.com' }),
  ];
  for (const body of bodies) assert.equal((await call(fixture.endpoint, body)).status, 400);
  assert.equal(count, 0);
});
test('HTTP: два занятых обработчика не создают очередь третьего', { timeout: 3000 }, async (t) => {
  const both = deferred();
  const release = deferred();
  let count = 0;
  const fixture = await startRelay({ exchange: async () => {
    if (++count === 2) both.resolve();
    await release.promise;
    return reply();
  } });
  t.after(() => { release.resolve(); });
  t.after(fixture.close);
  const first = call(fixture.endpoint);
  const second = call(fixture.endpoint);
  await both.promise;
  const third = await call(fixture.endpoint);
  assert.equal(third.status, 503);
  assert.equal(JSON.parse(third.body).code, 'overloaded');
  assert.equal(count, 2);
  release.resolve();
  assert.equal((await first).status, 202);
  assert.equal((await second).status, 202);
});
test('HTTP: лишний pipeline, большой заголовок и неверная длина не создают обход', { timeout: 3000 }, async (t) => {
  let count = 0;
  const fixture = await startRelay({ bodyMs: 40, exchange: async () => { count++; return reply(); } });
  t.after(fixture.close);
  await assert.rejects(call(fixture.endpoint, '{}', {
    authorization: 'Bearer ' + SECRET, 'content-type': 'application/json', 'x-large': 'x'.repeat(9000),
  }));
  const body = JSON.stringify(input);
  const frame = 'POST /v1/send HTTP/1.1\r\nHost: relay\r\nAuthorization: Bearer ' + SECRET +
    '\r\nX-GF-Mail-Expires-At: ' + (Date.now() + LIMITS.operationMs) + '\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body;
  const socket = connect(fixture.port, '127.0.0.1');
  const closed = once(socket, 'close');
  socket.resume();
  await once(socket, 'connect');
  socket.write(frame + frame);
  await closed;
  assert.ok(count <= 1);
  const before = count;
  const short = connect(fixture.port, '127.0.0.1');
  const shortClosed = once(short, 'close');
  short.resume();
  await once(short, 'connect');
  short.write(frame.replace('Content-Length: ' + Buffer.byteLength(body), 'Content-Length: 10000'));
  await shortClosed;
  assert.equal(count, before);
});
test('HTTP: отключение клиента отменяет также паузу повтора', { timeout: 3000 }, async (t) => {
  const waiting = deferred();
  const cancelled = deferred();
  let count = 0;
  const fixture = await startRelay({
    exchange: async () => { count++; return reply(503, 'service_unavailable'); },
    wait: async (_ms, signal) => {
      waiting.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        cancelled.resolve(); reject(new Error());
      }, { once: true }));
    },
  });
  t.after(fixture.close);
  const socket = connect(fixture.port, '127.0.0.1');
  await once(socket, 'connect');
  const body = JSON.stringify(input);
  socket.write('POST /v1/send HTTP/1.1\r\nHost: relay\r\nAuthorization: Bearer ' + SECRET +
    '\r\nX-GF-Mail-Expires-At: ' + (Date.now() + LIMITS.operationMs) + '\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
  await waiting.promise;
  socket.destroy();
  await cancelled.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(count, 1);
});
test('HTTP: абсолютный срок заголовков и тела закрывает медленное соединение', { timeout: 3000 }, async (t) => {
  let count = 0;
  const fixture = await startRelay({
    headerMs: 40, bodyMs: 40, totalMs: 300,
    exchange: async () => { count++; return reply(); },
  });
  t.after(fixture.close);
  for (const raw of [
    'POST /v1/send HTTP/1.1\r\nHost: relay\r\n',
    'POST /v1/send HTTP/1.1\r\nHost: relay\r\nAuthorization: Bearer ' + SECRET +
      '\r\nX-GF-Mail-Expires-At: ' + (Date.now() + LIMITS.operationMs) + '\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{',
  ]) {
    const socket = connect(fixture.port, '127.0.0.1');
    const closed = once(socket, 'close');
    await once(socket, 'connect');
    socket.write(raw);
    await closed;
  }
  assert.equal(count, 0);
});
test('HTTP: ограничены все входящие соединения, включая незавершённые заголовки', { timeout: 3000 }, async (t) => {
  const fixture = await startRelay({ headerMs: 1000 });
  t.after(fixture.close);
  const sockets: Socket[] = [];
  for (let i = 0; i < 8; i++) {
    const socket = connect(fixture.port, '127.0.0.1');
    sockets.push(socket);
    socket.on('error', () => {});
    await once(socket, 'connect');
  }
  t.after(() => { for (const socket of sockets) socket.destroy(); });
  assert.equal(await new Promise<number>((resolve, reject) => fixture.server.getConnections((error, count) => error ? reject(error) : resolve(count))), 8);
  const ninth = connect(fixture.port, '127.0.0.1');
  const closed = once(ninth, 'close');
  await closed;
});
test('HTTP: отключение клиента отменяет upstream, не запускает повтор и освобождает слот', { timeout: 3000 }, async (t) => {
  const entered = deferred();
  const cancelled = deferred();
  let count = 0;
  const fixture = await startRelay({
    exchange: async (_request, signal) => {
      if (++count > 1) return reply();
      entered.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        cancelled.resolve(); reject(new Error('synthetic ' + TOKEN));
      }, { once: true }));
    },
  });
  t.after(fixture.close);
  const socket = connect(fixture.port, '127.0.0.1');
  await once(socket, 'connect');
  const body = JSON.stringify(input);
  socket.write('POST /v1/send HTTP/1.1\r\nHost: relay\r\nAuthorization: Bearer ' + SECRET +
    '\r\nX-GF-Mail-Expires-At: ' + (Date.now() + LIMITS.operationMs) + '\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
  await entered.promise;
  socket.destroy();
  await cancelled.promise;
  // Следующий оборот нужен обработчику finally, а не повтору отправки.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(count, 1);
  assert.equal((await call(fixture.endpoint)).status, 202);
  assert.equal(count, 2);
});
test('HTTP: общий дедлайн отменяет медленный upstream без оставшихся попыток', { timeout: 3000 }, async (t) => {
  let count = 0;
  let aborted = false;
  const fixture = await startRelay({
    totalMs: 50,
    exchange: async (_request, signal) => new Promise((_resolve, reject) => {
      count++;
      signal.addEventListener('abort', () => { aborted = true; reject(new Error()); }, { once: true });
    }),
  });
  t.after(fixture.close);
  // Upstream timeout может опередить закрытие сокета общим таймером.
  const response = await call(fixture.endpoint).catch((error: NodeJS.ErrnoException) => {
    assert.equal(error.code, 'ECONNRESET');
    return null;
  });
  if (response) {
    assert.equal(response.status, 503);
    const result = JSON.parse(response.body);
    assert.deepEqual(Object.keys(result).sort(), ['code', 'outcome']);
    assert.equal(result.outcome, 'unknown');
    assert.ok(['cancelled', 'transport_error'].includes(result.code));
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(count, 1);
  assert.equal(aborted, true);
});
test('HTTP: ошибки провайдера не отражают исходные данные в ответах/журналах', { timeout: 3000 }, async (t) => {
  const logs: unknown[] = [];
  const fixture = await startRelay({
    log: (entry) => logs.push(entry),
    exchange: async () => ({ status: 401, headers: {}, body: JSON.stringify({ name: API_KEY, message: [SECRET, TOKEN, OPERATION, input.to, input.url].join(' ') }) }),
  });
  t.after(fixture.close);
  const response = await call(fixture.endpoint);
  assert.equal(JSON.parse(response.body).code, 'provider_error');
  for (const value of [SECRET, API_KEY, TOKEN, OPERATION, input.to, input.url]) {
    assert.equal(response.body.includes(value), false);
    assert.equal(JSON.stringify(logs).includes(value), false);
  }
});
test('низкоуровневый HTTP: редиректы не выполняются, размер и весь ответ ограничены', { timeout: 3000 }, async (t) => {
  let count = 0;
  const upstream = createServer((request, response) => {
    count++; request.resume();
    if (request.url === '/redirect') { response.writeHead(302, { location: '/target' }).end('{}'); }
    else if (request.url === '/big') response.end('x'.repeat(20000));
    else if (request.url === '/slow') { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{"id":'); }
    else if (request.url === '/no-headers') return;
    else response.end('{}');
  });
  await new Promise<void>((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve) => { upstream.closeAllConnections(); upstream.close(() => resolve()); }));
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const make = (path: string) => ({ url: base + path, headers: {}, body: '{}', maxResponseBytes: 16384 });
  assert.equal((await boundedExchange(nodeExchange, make('/redirect'), new AbortController().signal, 500)).status, 302);
  assert.equal(count, 1);
  assert.equal((await boundedExchange(nodeExchange, make('/big'), new AbortController().signal, 500)).incomplete, true);
  assert.equal((await boundedExchange(nodeExchange, make('/slow'), new AbortController().signal, 40)).incomplete, true);
  await assert.rejects(boundedExchange(nodeExchange, make('/no-headers'), new AbortController().signal, 40));
  assert.equal(count, 4);
});

test('HTTP: второй pipeline-запрос закрывает сокет и отменяет удерживаемый upstream', { timeout: 4000 }, async (t) => {
  const entered = deferred();
  const cancelled = deferred();
  let count = 0;
  const fixture = await startRelay({ totalMs: 10000, exchange: async (_request, signal) => {
    count++; entered.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      cancelled.resolve(); reject(new Error());
    }, { once: true }));
  } });
  t.after(fixture.close);
  const socket = connect(fixture.port, '127.0.0.1');
  t.after(() => socket.destroy());
  const closed = once(socket, 'close');
  socket.resume();
  await once(socket, 'connect');
  const body = JSON.stringify(input);
  const frame = 'POST /v1/send HTTP/1.1\r\nHost: relay\r\nAuthorization: Bearer ' + SECRET +
    '\r\nX-GF-Mail-Expires-At: ' + (Date.now() + LIMITS.operationMs) + '\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body;
  socket.write(frame);
  await entered.promise;
  const timely = AbortSignal.timeout(1000);
  socket.write(frame);
  await Promise.all([closed,
    Promise.race([cancelled.promise, new Promise((_resolve, reject) => timely.addEventListener('abort', () => reject(new Error('pipeline не отменён вовремя')), { once: true }))])]);
  assert.equal(count, 1);
});
test('HTTP: потоковый лимит отклоняет незавершённое chunked-тело до body timeout', { timeout: 4000 }, async (t) => {
  let count = 0;
  const fixture = await startRelay({ bodyMs: 10000, totalMs: 12000, exchange: async () => { count++; return reply(); } });
  t.after(fixture.close);
  const socket = connect(fixture.port, '127.0.0.1');
  t.after(() => socket.destroy());
  let received = '';
  socket.setEncoding('utf8').on('data', (chunk) => { received += chunk; });
  await once(socket, 'connect');
  const chunk = 'x'.repeat(LIMITS.bodyBytes + 1);
  const closed = once(socket, 'close', { signal: AbortSignal.timeout(1000) });
  socket.write('POST /v1/send HTTP/1.1\r\nHost: relay\r\nAuthorization: Bearer ' + SECRET +
    '\r\nX-GF-Mail-Expires-At: ' + (Date.now() + LIMITS.operationMs) + '\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n' + chunk.length.toString(16) + '\r\n' + chunk + '\r\n');
  // Нет последнего нулевого чанка: JSON-парсер ещё не должен вызываться.
  await closed;
  assert.match(received, /^HTTP\/1\.1 400 /);
  assert.equal(count, 0);
});
test('HTTP: oversized/truncated 502 и 429 сохраняют заголовки и запрещают повтор', { timeout: 4000 }, async (t) => {
  let count = 0;
  const upstream = createServer((request, response) => {
    count++; request.resume();
    const status = request.url?.includes('429') ? 429 : 502;
    response.writeHead(status, { 'retry-after': '60', 'content-length': '20000' });
    if (request.url?.includes('oversized')) response.end('x'.repeat(20000));
    else response.end('x');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.closeAllConnections(); upstream.close(() => resolve()); }));
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  for (const status of [502, 429]) for (const form of ['oversized', 'truncated']) {
    const before = count;
    let pauses = 0;
    const actual = await sendMail(input as Parameters<typeof sendMail>[0], config, new AbortController().signal, performance.now() + 12000, {
      expiresAt: Date.now() + LIMITS.operationMs,
      exchange: (request, signal) => nodeExchange({ ...request, url: 'http://127.0.0.1:' + address.port + '/' + status + '/' + form }, signal),
      wait: async () => { pauses++; },
    });
    assert.equal(count, before + 1);
    assert.equal(pauses, 0);
    assert.deepEqual(actual, { outcome: 'unknown', code: 'provider_error', retryAfterSeconds: 60 });
  }
});

test('HTTP: срок операции обязателен, не дублируется и не обновляется шлюзом', { timeout: 4000 }, async (t) => {
  let count = 0;
  let clock = Date.now();
  const fixture = await startRelay({ wallNow: () => clock, exchange: async () => {
    count++; clock += 7000; return reply(500, 'application_error');
  } });
  t.after(fixture.close);
  const headers = { authorization: 'Bearer ' + SECRET, 'content-type': 'application/json' };
  for (const expiry of [undefined, '', '0', '01', '+1', '1.5', '9999999999999999', String(clock + LIMITS.operationMs + 1)]) {
    assert.equal((await call(fixture.endpoint, JSON.stringify(input), { ...headers,
      ...(expiry === undefined ? {} : { 'x-gf-mail-expires-at': expiry }),
    })).status, 400);
  }
  const value = String(clock + 7000);
  const body = JSON.stringify(input);
  const duplicate = ['Host', '127.0.0.1', 'Authorization', 'Bearer ' + SECRET,
    'Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body)),
    'X-GF-Mail-Expires-At', value, 'X-GF-Mail-Expires-At', value];
  assert.equal((await call(fixture.endpoint, body, duplicate)).status, 400);
  assert.equal(count, 0);
  const expired = await call(fixture.endpoint, body, { ...headers, 'x-gf-mail-expires-at': String(clock - 1) });
  assert.deepEqual(JSON.parse(expired.body), { outcome: 'unknown', code: 'operation_expired' });
  assert.equal(count, 0);
  const crossing = await call(fixture.endpoint, body, { ...headers, 'x-gf-mail-expires-at': value });
  assert.deepEqual(JSON.parse(crossing.body), { outcome: 'unknown', code: 'operation_expired' });
  assert.equal(count, 1);
});
