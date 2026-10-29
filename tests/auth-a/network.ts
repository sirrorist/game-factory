import { createServer as httpServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { parseMailRequest, parseMailResult, EXPIRY_HEADER } from '../../apps/mail-relay/src/protocol.ts';
import { requireCheck, until } from './guards.ts';

export async function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve((server.address() as AddressInfo).port); });
  });
}
export async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
export type Mail = { kind: string; operationId: string; to: string; url: string };
export type Received = { mail: Mail; body: string; expiresAt: number; reply: (outcome?: 'accepted' | 'not_accepted' | 'unknown') => void; cut: () => void };
export class Collector {
  readonly server: Server;
  readonly messages: Received[] = [];
  active = 0;
  peak = 0;
  hold = false;
  error = false;
  beforeReply?: (item: Received) => Promise<void>;
  readonly secret: string;
  readonly origin: () => string;
  constructor(secret: string, origin: () => string) {
    this.secret = secret; this.origin = origin;
    this.server = httpServer((req, res) => { void this.receive(req, res); });
    this.server.requestTimeout = 5000; this.server.headersTimeout = 5000;
    this.server.maxConnections = 10;
  }
  private async receive(req: IncomingMessage, res: ServerResponse) {
    const timer = setTimeout(() => { this.error = true; req.destroy(); res.destroy(); }, 5000);
    try {
      const expected = Buffer.from('Bearer ' + this.secret), supplied = Buffer.from(req.headers.authorization ?? '');
      requireCheck(req.method === 'POST' && req.url === '/v1/send' && supplied.length === expected.length &&
        timingSafeEqual(expected, supplied), 'тестовый collector отверг запрос');
      requireCheck(req.headers['content-type'] === 'application/json', 'тип тела collector');
      const chunks: Buffer[] = []; let size = 0;
      for await (const part of req) {
        size += part.length; requireCheck(size <= 16_384, 'размер тела collector'); chunks.push(Buffer.from(part));
      }
      requireCheck(this.messages.length < 100, 'collector переполнен');
      const body = Buffer.concat(chunks).toString('utf8');
      const mail = parseMailRequest(body, this.origin());
      const expiresAt = Number(req.headers[EXPIRY_HEADER]);
      requireCheck(Number.isSafeInteger(expiresAt) && expiresAt > Date.now(), 'неверный срок collector');
      this.active++; this.peak = Math.max(this.peak, this.active);
      let finished = false;
      res.once('close', () => { if (!finished) { finished = true; this.active--; } });
      const item: Received = { body, mail, expiresAt,
        reply: (outcome = 'accepted') => {
          const value = { outcome, code: outcome === 'accepted' ? 'accepted_by_provider' : outcome === 'unknown' ? 'transport_error' : 'invalid_request' };
          requireCheck(parseMailResult(value), 'неверный искусственный ответ');
          if (!res.destroyed && !res.writableEnded) { res.writeHead(outcome === 'accepted' ? 202 : 400, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
        }, cut: () => res.destroy() };
      this.messages.push(item);
      // Таймаут только получения входа; управляемый ответ может удерживаться до crash/stop.
      clearTimeout(timer);
      await this.beforeReply?.(item);
      if (!this.hold) item.reply();
    } catch { this.error = true; if (!res.headersSent && !res.destroyed) res.writeHead(400); res.end(); }
    finally { clearTimeout(timer); }
  }
  async received(count: number) {
    await until(async () => { requireCheck(!this.error, 'ошибка протокола/снимка collector'); return this.messages.length >= count; }, 'collector не получил ожидаемый запрос');
    requireCheck(!this.error, 'ошибка collector');
    return this.messages[count - 1]!;
  }
  async reset() {
    for (const message of this.messages) message.cut();
    await until(async () => this.active === 0, 'collector не освободил запросы');
    this.messages.length = 0; this.peak = 0; this.hold = false; this.error = false; this.beforeReply = undefined;
  }
}
export type Observation = { path: string; referer?: string; status: number };
export class TlsProxy {
  readonly server: Server;
  readonly observations: Observation[] = [];
  target?: number;
  port = 0;
  get origin() { return `https://localhost:${this.port}`; }
  constructor(cert: Buffer, key: Buffer) {
    this.server = httpsServer({ cert, key }, (req, res) => {
      const path = new URL(req.url ?? '/', this.origin).pathname;
      if (this.observations.length >= 3000) { res.writeHead(503); res.end(); return; }
      if (path.startsWith('/__probe/')) {
        this.observations.push({ path, referer: req.headers.referer, status: 200 });
        res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end('probe-ok'); return;
      }
      if (path === '/__control') {
        this.observations.push({ path, referer: req.headers.referer, status: 200 });
        res.writeHead(200, { 'content-type': 'text/html', 'referrer-policy': 'unsafe-url', 'cache-control': 'no-store' });
        res.end('<!doctype html><title>test control</title>'); return;
      }
      if (!this.target) { res.writeHead(503); res.end(); return; }
      const outgoing = httpRequest({ hostname: '127.0.0.1', port: this.target, path: req.url, method: req.method,
        headers: { ...req.headers, host: new URL(this.origin).host, 'x-forwarded-proto': 'https',
          'x-forwarded-host': new URL(this.origin).host, 'x-real-ip': '192.0.2.80' } }, reply => {
        this.observations.push({ path, referer: req.headers.referer, status: reply.statusCode ?? 0 });
        res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res);
      });
      outgoing.setTimeout(10_000, () => outgoing.destroy());
      outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on('close', () => outgoing.destroy()); req.pipe(outgoing);
    });
    this.server.requestTimeout = 10_000; this.server.headersTimeout = 5000;
  }
  async start() { this.port = await listen(this.server); }
}
