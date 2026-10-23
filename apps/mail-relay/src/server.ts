import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { TextDecoder } from 'node:util';
import { assertRelayConfig, type RelayConfig } from './config.ts';
import { sendMail, type SendOptions } from './provider.ts';
import { EXPIRY_HEADER, LIMITS, MailInputError, parseMailRequest, result, type MailResult } from './protocol.ts';

type Connection = { controller: AbortController; deadline: number; timers: Set<ReturnType<typeof setTimeout>>; used: boolean };
type ServerOptions = Omit<SendOptions, 'expiresAt' | 'operationDeadline'> & {
  headerMs?: number; bodyMs?: number; totalMs?: number;
  log?: (entry: Readonly<Pick<MailResult, 'outcome' | 'code'>>) => void;
};
function countHeader(request: IncomingMessage, name: string): number {
  let count = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i]?.toLowerCase() === name) count++;
  return count;
}
function authorized(request: IncomingMessage, secret: string): boolean {
  if (countHeader(request, 'authorization') !== 1) return false;
  const actual = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from('Bearer ' + secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function readBody(request: IncomingMessage, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (error?: boolean) => {
      request.removeListener('data', data);
      request.removeListener('end', end);
      request.removeListener('error', fail);
      request.removeListener('aborted', fail);
      signal.removeEventListener('abort', fail);
      request.pause();
      if (error) reject(new MailInputError());
      else {
        try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { reject(new MailInputError()); }
      }
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMITS.bodyBytes) { finish(true); return; }
      chunks.push(chunk);
    };
    const end = () => finish();
    const fail = () => finish(true);
    request.on('data', data).once('end', end).once('error', fail).once('aborted', fail);
    signal.addEventListener('abort', fail, { once: true });
    if (signal.aborted) fail();
  });
}
export function createRelayServer(config: RelayConfig, options: ServerOptions = {}) {
  assertRelayConfig(config);
  const now = options.now ?? (() => performance.now());
  const connections = new Map<Socket, Connection>();
  let active = 0;
  const server = createServer({
    maxHeaderSize: LIMITS.headerBytes, headersTimeout: 0, requestTimeout: 0,
    keepAliveTimeout: 1,
  });
  server.maxConnections = LIMITS.connections;
  server.maxRequestsPerSocket = 1;
  server.on('connection', (socket) => {
    const controller = new AbortController();
    const state: Connection = {
      controller, deadline: now() + (options.totalMs ?? LIMITS.totalMs), timers: new Set(), used: false,
    };
    const timer = (ms: number) => {
      const handle = setTimeout(() => { controller.abort(); socket.destroy(); }, ms);
      state.timers.add(handle);
      return handle;
    };
    connections.set(socket, state);
    const header = timer(options.headerMs ?? LIMITS.headerMs);
    timer(options.totalMs ?? LIMITS.totalMs);
    socket.once('close', () => {
      controller.abort();
      for (const handle of state.timers) clearTimeout(handle);
      connections.delete(socket);
    });
    // В отличие от inactivity timeout, медленный клиент не продлевает этот срок.
    socket.once('gf-mail-headers', () => { clearTimeout(header); state.timers.delete(header); });
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('dropRequest', (request, socket) => {
    connections.get(request.socket)?.controller.abort();
    // Не оставляем Node очередь 503 за удерживаемым первым ответом.
    socket.destroy();
  });
  server.on('request', (request, response) => {
    const state = connections.get(request.socket);
    if (!state || state.used) { request.socket.destroy(); return; }
    state.used = true;
    request.socket.emit('gf-mail-headers');
    const send = (reply: MailResult, status: number) => {
      if (response.destroyed || state.controller.signal.aborted) return;
      const safe = JSON.stringify(reply);
      response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(safe), connection: 'close', 'cache-control': 'no-store' });
      response.end(safe);
      // Наружу уходит только собственный набор кодов, не exception или request.
      try { options.log?.(Object.freeze({ outcome: reply.outcome, code: reply.code })); } catch { /* Логгер не меняет результат. */ }
    };
    const reject = (code: 'invalid_request' | 'unauthorized' | 'overloaded', status: number) => send(result('not_accepted', code), status);
    if (request.method !== 'POST' || request.url !== '/v1/send') { reject('invalid_request', 404); return; }
    if (!authorized(request, config.serviceSecret)) { reject('unauthorized', 401); return; }
    const rawExpiry = request.headers[EXPIRY_HEADER];
    const expiresAt = typeof rawExpiry === 'string' && /^[1-9][0-9]{0,15}$/.test(rawExpiry) ? Number(rawExpiry) : NaN;
    const wallNow = options.wallNow ?? Date.now;
    if (countHeader(request, EXPIRY_HEADER) !== 1 || !Number.isSafeInteger(expiresAt) || expiresAt > wallNow() + LIMITS.operationMs) {
      reject('invalid_request', 400); return;
    }
    // Входные байты и ожидание также расходуют исходный остаток операции.
    const operationDeadline = now() + expiresAt - wallNow() - LIMITS.operationSafetyMs;
    if (countHeader(request, 'content-type') !== 1 ||
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') ||
        (request.headers['content-encoding'] !== undefined && request.headers['content-encoding'] !== 'identity')) {
      reject('invalid_request', 400); return;
    }
    if (active >= LIMITS.parallel) { reject('overloaded', 503); return; }
    active++;
    const bodyTimer = setTimeout(() => { state.controller.abort(); request.socket.destroy(); }, options.bodyMs ?? LIMITS.bodyMs);
    state.timers.add(bodyTimer);
    response.once('close', () => { if (!response.writableFinished) state.controller.abort(); });
    void (async () => {
      try {
        const body = await readBody(request, state.controller.signal);
        clearTimeout(bodyTimer); state.timers.delete(bodyTimer);
        const input = parseMailRequest(body, config.hubOrigin);
        const reply = await sendMail(input, config, state.controller.signal, state.deadline, {
          ...options, expiresAt, operationDeadline,
        });
        send(reply, reply.outcome === 'accepted' ? 202 : reply.code === 'invalid_request' ? 400 : 503);
      } catch {
        send(result('not_accepted', 'invalid_request'), 400);
      } finally {
        clearTimeout(bodyTimer); state.timers.delete(bodyTimer); active--;
      }
    })();
  });
  return server;
}
