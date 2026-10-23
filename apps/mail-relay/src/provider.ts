import { setTimeout as delay } from 'node:timers/promises';
import { renderMail, type RelayConfig } from './config.ts';
import { boundedExchange, nodeExchange, type Exchange } from './io.ts';
import { LIMITS, result, type MailRequest, type MailResult, type ResultCode } from './protocol.ts';

export const RESEND_URL = 'https://api.resend.com/emails';
export type SendOptions = {
  expiresAt: number;
  operationDeadline?: number;
  exchange?: Exchange; now?: () => number; wallNow?: () => number;
  attemptMs?: number; pauseMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};
type Retry = { ms: number; seconds: number } | 'missing' | 'invalid';
export function retryAfter(value: string | undefined, now: number): Retry {
  if (value === undefined) return 'missing';
  let ms: number;
  if (/^[0-9]+$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds > 2147483) return 'invalid';
    ms = seconds * 1000;
  } else {
    const stamp = Date.parse(value);
    // Принимаем каноническую HTTP-date, не произвольный синтаксис Date.parse.
    if (!Number.isFinite(stamp) || new Date(stamp).toUTCString() !== value) return 'invalid';
    ms = Math.max(0, stamp - now);
  }
  if (ms > 2147483647) return 'invalid';
  return { ms, seconds: Math.ceil(ms / 1000) };
}
export async function sendMail(
  request: MailRequest, config: RelayConfig, signal: AbortSignal, deadline: number, options: SendOptions,
): Promise<MailResult> {
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? Date.now;
  if (!Number.isSafeInteger(options.expiresAt) || options.expiresAt < 0) return result('not_accepted', 'invalid_request');
  // Скачок системных часов назад не продлевает уже полученный остаток окна.
  const windowDeadline = Math.min(options.operationDeadline ?? Infinity, now() + options.expiresAt - wallNow() - LIMITS.operationSafetyMs);
  const windowRemaining = () => Math.min(windowDeadline - now(), options.expiresAt - wallNow() - LIMITS.operationSafetyMs);
  const attemptMs = options.attemptMs ?? LIMITS.attemptMs;
  const pauseMs = options.pauseMs ?? LIMITS.pauseMs;
  const wait = options.wait ?? ((ms, abort) => delay(ms, undefined, { signal: abort }));
  const exchange = options.exchange ?? nodeExchange;
  let body: string;
  try { body = JSON.stringify(renderMail(config.profiles[request.kind], request)); }
  catch { return result('not_accepted', 'unavailable'); }
  let uncertain = false;
  let started = false;
  let last: ResultCode = 'unavailable';
  let retrySeconds: number | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted || now() >= deadline) return result(started ? 'unknown' : 'not_accepted', 'cancelled');
    if (windowRemaining() < attemptMs) return result('unknown', 'operation_expired');
    let repeat = false;
    let pause = pauseMs;
    started = true;
    try {
      const reply = await boundedExchange(exchange, {
        url: RESEND_URL,
        headers: { authorization: 'Bearer ' + config.apiKey, 'content-type': 'application/json', 'idempotency-key': request.operationId },
        body, maxResponseBytes: LIMITS.upstreamBytes,
      }, signal, Math.min(attemptMs, deadline - now(), windowRemaining()));
      if (signal.aborted) return result('unknown', 'cancelled');
      const retry = retryAfter(reply.headers['retry-after'], wallNow());
      retrySeconds = typeof retry === 'object' ? retry.seconds : undefined;
      // После заголовков потеря тела не разрешает угадывать вид ошибки и повторять.
      if (reply.incomplete) return result('unknown', 'provider_error', retrySeconds);
      let data: unknown;
      try {
        if (Buffer.byteLength(reply.body) > LIMITS.upstreamBytes) throw new Error();
        data = JSON.parse(reply.body);
      } catch { return result('unknown', 'provider_error'); }
      const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
      if (reply.status >= 200 && reply.status < 300) {
        if (typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.id)) return result('unknown', 'provider_error');
        return result('accepted', 'accepted_by_provider');
      }
      const name = typeof record.name === 'string' ? record.name : '';
      if (reply.status === 409 && name === 'invalid_idempotent_request') return result('unknown', 'idempotency_conflict');
      if (reply.status === 429 && ['daily_quota_exceeded', 'monthly_quota_exceeded'].includes(name)) {
        return result(uncertain ? 'unknown' : 'not_accepted', 'quota_exhausted', retrySeconds);
      }
      if (reply.status === 429 && name === 'rate_limit_exceeded') {
        last = 'rate_limited';
        repeat = typeof retry === 'object';
      } else if (reply.status === 409 && name === 'concurrent_idempotent_requests') {
        last = 'concurrent_request'; uncertain = true; repeat = retry !== 'invalid';
      } else if ((reply.status === 500 && name === 'application_error') ||
                 (reply.status === 503 && name === 'service_unavailable')) {
        last = 'provider_error'; uncertain = true; repeat = retry !== 'invalid';
      } else {
        // Неизвестный 5xx не доказывает непринятие письма и не разрешает повтор.
        const unknownServerError = reply.status >= 500 && reply.status < 600;
        return result(uncertain || unknownServerError ? 'unknown' : 'not_accepted', 'provider_error', retrySeconds);
      }
      if (typeof retry === 'object') pause = retry.ms;
    } catch {
      uncertain = true; last = signal.aborted ? 'cancelled' : 'transport_error'; repeat = !signal.aborted;
    }
    if (!repeat || attempt === 1 || signal.aborted) break;
    if (pause + attemptMs > windowRemaining()) return result('unknown', 'operation_expired', retrySeconds);
    if (now() + pause + attemptMs > deadline) break;
    try { await wait(pause, signal); } catch { return result('unknown', 'cancelled'); }
  }
  return result(uncertain ? 'unknown' : 'not_accepted', last, retrySeconds);
}
