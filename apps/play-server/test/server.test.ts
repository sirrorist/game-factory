import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyHost } from '../src/config.ts';
import { createPlayServer, requestPath } from '../src/server.ts';

const HUB = 'http://localhost:3000';
let server: Server;
let port: number;
let data: string;

before(async () => {
  data = mkdtempSync(join(tmpdir(), 'gf-play-'));
  const gf = new URL('../../../tools/gf.ts', import.meta.url).pathname;
  for (const cmd of [['build', 'snake'], ['export', 'snake']]) {
    const r = spawnSync(process.execPath, [gf, ...cmd], { env: { ...process.env, GF_DATA_DIR: data }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  // Симлинк, подброшенный в хранилище в обход CLI, всё равно не должен отдаваться.
  symlinkSync('/etc/passwd', join(data, 'storage/games/snake/1.0.0/passwd.txt'));

  server = createPlayServer({ baseHost: 'play.test', port: 0, host: '127.0.0.1', hubOrigins: [HUB], dataDir: data });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

after(() => new Promise<void>((r) => server.close(() => r())));

interface Res {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function get(host: string, path: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { Host: host, ...opts.headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('корень игры отдаёт entry с защитными заголовками', async () => {
  const r = await get('snake.play.test', '/');
  assert.equal(r.status, 200);
  assert.match(String(r.headers['content-type'] ?? ''), /^text\/html/);
  assert.match(r.body, /<title>Змейка<\/title>/);
  const csp = String(r.headers['content-security-policy'] ?? '');
  assert.match(csp, new RegExp(`frame-ancestors ${HUB}(;|$)`));
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(String(r.headers['permissions-policy'] ?? ''), /camera=\(\)/);
  assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(r.headers['x-gf-game'], 'snake@1.0.0');
});

test('SDK подложен в сборку', async () => {
  const r = await get('snake.play.test', '/gf-sdk.js');
  assert.equal(r.status, 200);
  assert.match(String(r.headers['content-type'] ?? ''), /^text\/javascript/);
  assert.match(r.body, /GameFactory/);
});

test('ETag и 304', async () => {
  const first = await get('snake.play.test', '/game.js');
  const etag = first.headers.etag;
  assert.ok(etag);
  const second = await get('snake.play.test', '/game.js', { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
});

test('HEAD без тела, POST запрещён', async () => {
  const head = await get('snake.play.test', '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  const post = await get('snake.play.test', '/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('обход пути не проходит ни в каком написании', async () => {
  for (const p of [
    '/../../../etc/passwd',
    '/..%2f..%2fetc%2fpasswd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/a/../../1.0.0.meta.json',
    '/..\\..\\etc\\passwd',
    '/index.html%00.png',
    '/%E0%A4%A',
    '/.hidden.js',
    '//etc/passwd',
  ]) {
    const r = await get('snake.play.test', p);
    assert.ok(r.status === 404 || r.status === 403, `${p} → ${r.status}`);
    assert.doesNotMatch(r.body, /root:/, p);
  }
});

test('симлинк в хранилище не отдаётся', async () => {
  const r = await get('snake.play.test', '/passwd.txt');
  assert.equal(r.status, 404);
});

test('тип файла вне белого списка — 403', async () => {
  const r = await get('snake.play.test', '/game.php');
  assert.equal(r.status, 403);
});

test('неизвестные хосты и игры — 404', async () => {
  assert.equal((await get('evil.example', '/')).status, 404);
  assert.equal((await get('nope.play.test', '/')).status, 404);
  assert.equal((await get('a.b.play.test', '/')).status, 404);
  assert.equal((await get('Snake_1.play.test', '/')).status, 404);
});

test('Service Worker запрещён', async () => {
  const r = await get('snake.play.test', '/game.js', { headers: { 'Service-Worker': 'script' } });
  assert.equal(r.status, 403);
});

test('служебный хост: архив скачивается вложением', async () => {
  const r = await get('play.test', '/exports/snake-1.0.0.zip');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/zip');
  assert.equal(r.headers['content-disposition'], 'attachment; filename="snake-1.0.0.zip"');
  assert.equal((await get('play.test', '/exports/other-1.0.0.zip')).status, 404);
});

test('служебный хост: обложка с sandbox-CSP', async () => {
  const r = await get('play.test', '/covers/snake');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/svg+xml');
  assert.match(String(r.headers['content-security-policy'] ?? ''), /sandbox/);
  assert.equal(r.headers['cross-origin-resource-policy'], 'cross-origin');
});

test('служебный хост: обложка кешируется надолго только с текущей версией в адресе', async () => {
  const current = await get('play.test', '/covers/snake?v=1.0.0');
  assert.equal(current.status, 200);
  assert.equal(current.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.match(String(current.headers['content-security-policy'] ?? ''), /sandbox/);

  // Без версии и со старой - только с проверкой: иначе адрес надолго запомнит не те байты.
  for (const path of ['/covers/snake', '/covers/snake?v=0.9.0']) {
    const r = await get('play.test', path);
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-cache', path);
    assert.equal(r.headers.etag, current.headers.etag, path);
  }

  const again = await get('play.test', '/covers/snake', { headers: { 'If-None-Match': String(current.headers.etag) } });
  assert.equal(again.status, 304);
  assert.equal(again.body, '');
  assert.match(String(again.headers['content-security-policy'] ?? ''), /sandbox/);
});

test('архив и файл игры: повторный запрос с ETag - 304 без тела', async () => {
  for (const [host, path] of [['play.test', '/exports/snake-1.0.0.zip'], ['snake.play.test', '/']] as const) {
    const first = await get(host, path);
    assert.ok(first.headers.etag, path);
    const r = await get(host, path, { headers: { 'If-None-Match': String(first.headers.etag) } });
    assert.equal(r.status, 304, path);
    assert.equal(r.body, '', path);
  }
});

test('служебный хост не отдаёт файлы игр', async () => {
  assert.equal((await get('play.test', '/storage/games/snake/1.0.0/index.html')).status, 404);
  assert.equal((await get('play.test', '/registry.json')).status, 404);
  assert.equal((await get('play.test', '/healthz')).status, 200);
});

test('classifyHost', () => {
  assert.deepEqual(classifyHost('snake.play.test:4100', 'play.test'), { kind: 'game', id: 'snake' });
  assert.deepEqual(classifyHost('PLAY.TEST', 'play.test'), { kind: 'root' });
  assert.deepEqual(classifyHost('xplay.test', 'play.test'), { kind: 'unknown' });
  assert.deepEqual(classifyHost(undefined, 'play.test'), { kind: 'unknown' });
});

test('requestPath', () => {
  assert.equal(requestPath('/'), '');
  assert.equal(requestPath('/a/b.js?v=1'), 'a/b.js');
  assert.equal(requestPath('http://evil/x'), null);
  assert.equal(requestPath('/a/%2e%2e/b'), null);
});
