import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';

export type WireRequest = Readonly<{
  url: string; headers: Readonly<Record<string, string>>; body: string; maxResponseBytes: number;
}>;
export type WireReply = Readonly<{ status: number; headers: Readonly<Record<string, string | undefined>>; body: string; incomplete?: true }>;
export type Exchange = (request: WireRequest, signal: AbortSignal) => Promise<WireReply>;

// Нет fetch-прокси, следования Location и повторов библиотеки. Завершаемся после close.
export const nodeExchange: Exchange = (input, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new Error('почтовый запрос отменён')); return; }
  const url = new URL(input.url);
  const send = url.protocol === 'https:' ? httpsRequest : url.protocol === 'http:' ? httpRequest : null;
  if (!send) { reject(new Error('неверный почтовый транспорт')); return; }
  let pending: { reply: WireReply } | { error: true } | undefined;
  let response: IncomingMessage | undefined;
  let metadata: Pick<WireReply, 'status' | 'headers'> | undefined;
  const request = send(url, {
    method: 'POST', headers: { ...input.headers, 'content-length': String(Buffer.byteLength(input.body)), connection: 'close' },
    signal, agent: false, maxHeaderSize: 8192,
  });
  const fail = () => { pending ??= { error: true }; response?.destroy(); request.destroy(); };
  request.on('error', fail);
  request.once('close', () => {
    if (pending && 'reply' in pending && !signal.aborted) resolve(pending.reply);
    else if (metadata) resolve(Object.freeze({ ...metadata, body: '', incomplete: true }));
    else reject(new Error('почтовый транспорт недоступен'));
  });
  request.once('response', (reply) => {
    response = reply;
    const retry = reply.headers['retry-after'];
    metadata = Object.freeze({
      status: reply.statusCode ?? 0,
      headers: Object.freeze({ 'retry-after': typeof retry === 'string' && retry.length <= 128 && /^[\x20-\x7e]*$/.test(retry) ? retry : undefined }),
    });
    const chunks: Buffer[] = [];
    let length = 0;
    reply.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > input.maxResponseBytes) { fail(); return; }
      chunks.push(chunk);
    });
    reply.on('error', fail);
    reply.on('aborted', fail);
    reply.once('end', () => {
      if (pending) return;
      pending = { reply: Object.freeze({
        ...metadata!,
        body: Buffer.concat(chunks).toString('utf8'),
      }) };
      request.destroy();
    });
  });
  request.end(input.body);
});
export async function boundedExchange(
  exchange: Exchange, request: WireRequest, parent: AbortSignal, timeoutMs: number,
): Promise<WireReply> {
  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try { return await exchange(request, signal); } finally { clearTimeout(timer); }
}
