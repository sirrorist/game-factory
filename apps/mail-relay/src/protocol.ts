// Закрытый внутренний протокол: данные письма никогда не становятся диагностикой.
export const MAIL_KINDS = ['verify-email.v1', 'reset-password.v1'] as const;
export type MailKind = typeof MAIL_KINDS[number];
export type MailRequest = Readonly<{ kind: MailKind; to: string; url: string; operationId: string }>;
export const EXPIRY_HEADER = 'x-gf-mail-expires-at';
export type Outcome = 'accepted' | 'not_accepted' | 'unknown';
export const RESULT_CODES = [
  'accepted_by_provider', 'invalid_request', 'unauthorized', 'unavailable', 'overloaded',
  'cancelled', 'transport_error', 'provider_error', 'rate_limited', 'quota_exhausted',
  'idempotency_conflict', 'concurrent_request', 'operation_expired',
] as const;
export type ResultCode = typeof RESULT_CODES[number];
export type MailResult = Readonly<{ outcome: Outcome; code: ResultCode; retryAfterSeconds?: number }>;
export const LIMITS = Object.freeze({
  connections: 8, parallel: 2, headerBytes: 8192, bodyBytes: 16384,
  upstreamBytes: 16384, replyBytes: 1024, headerMs: 3000, bodyMs: 3000,
  totalMs: 12000, attemptMs: 5000, clientMs: 15000, pauseMs: 500,
  operationMs: 24 * 60 * 60 * 1000,
  operationSafetyMs: 1000,
});
export class MailInputError extends Error {
  constructor() { super('неверный формат почтового запроса'); }
}
export function result(outcome: Outcome, code: ResultCode, retryAfterSeconds?: number): MailResult {
  return Object.freeze({ outcome, code, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) });
}
export function validSecret(value: string): boolean { return /^[A-Za-z0-9_-]{32,256}$/.test(value); }
export function validMailbox(value: string): boolean {
  if (!value || value.length > 254 || /[^\x21-\x7e]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const local = parts[0]!;
  const domain = parts[1]!;
  if (local.length > 64 || !/^[A-Za-z0-9!#$%&'*+/=?^_\x60{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_\x60{|}~-]+)*$/.test(local)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && domain.length <= 253 && labels.every(
    (label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label),
  ) && !/^[0-9.]+$/.test(domain);
}
export function canonicalOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.origin === value && !url.username && !url.password) return value;
  } catch { /* Не отражаем исходную конфигурацию. */ }
  throw new MailInputError();
}
export function isMailKind(value: string): value is MailKind { return MAIL_KINDS.some((kind) => kind === value); }

// Только плоские строковые поля. JSON.parse сам по себе теряет дубли ключей.
export function parseStringObject(source: string): Record<string, string> {
  if (Buffer.byteLength(source) > LIMITS.bodyBytes) throw new MailInputError();
  let at = 0;
  const skip = () => { while (at < source.length && /[ \t\r\n]/.test(source[at]!)) at++; };
  const char = (expected: string) => { skip(); if (source[at++] !== expected) throw new MailInputError(); };
  const string = (): string => {
    skip();
    const start = at;
    if (source[at++] !== '"') throw new MailInputError();
    while (at < source.length) {
      const value = source[at++];
      if (value === '\\') { at++; continue; }
      if (value === '"') {
        try {
          const parsed: unknown = JSON.parse(source.slice(start, at));
          if (typeof parsed === 'string' && !/[\x00-\x1f\x7f]/.test(parsed)) return parsed;
        } catch { /* Только фиксированная ошибка. */ }
        throw new MailInputError();
      }
    }
    throw new MailInputError();
  };
  char('{'); skip();
  const output: Record<string, string> = Object.create(null);
  if (source[at] !== '}') {
    for (;;) {
      const key = string();
      if (Object.hasOwn(output, key) || Object.keys(output).length >= 4) throw new MailInputError();
      char(':'); output[key] = string(); skip();
      if (source[at] !== ',') break;
      at++;
    }
  }
  char('}'); skip();
  if (at !== source.length) throw new MailInputError();
  return output;
}
export function parseMailRequest(source: string, hubOrigin: string): MailRequest {
  const data = parseStringObject(source);
  if (Object.keys(data).sort().join(',') !== 'kind,operationId,to,url' || !isMailKind(data.kind!)) throw new MailInputError();
  const { kind, to, url: raw, operationId } = data as Record<string, string> & { kind: MailKind };
  if (!validMailbox(to!) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId!)) throw new MailInputError();
  if (!raw || Buffer.byteLength(raw) > 2048 || raw !== raw.trim() || raw.includes('#') || /[\x00-\x20\x7f]/.test(raw)) throw new MailInputError();
  let url: URL;
  try { url = new URL(raw); } catch { throw new MailInputError(); }
  const path = kind === 'verify-email.v1' ? '/account/verify-email' : '/account/reset-password';
  const params = [...url.searchParams.entries()];
  const token = params[0]?.[1] ?? '';
  if (url.origin !== canonicalOrigin(hubOrigin) || url.protocol !== 'https:' ||
      url.username || url.password || url.pathname !== path || url.href !== raw ||
      params.length !== 1 || params[0]?.[0] !== 'token' || !/^[A-Za-z0-9._~-]{1,1024}$/.test(token) ||
      url.search !== '?token=' + token) throw new MailInputError();
  return Object.freeze({ kind, to: to!, url: raw, operationId: operationId! });
}
export function parseMailResult(value: unknown): MailResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['outcome', 'code', 'retryAfterSeconds'].includes(key))) return null;
  if (!['accepted', 'not_accepted', 'unknown'].includes(String(data.outcome)) ||
      !RESULT_CODES.includes(data.code as ResultCode)) return null;
  if ((data.outcome === 'accepted') !== (data.code === 'accepted_by_provider')) return null;
  const retry = data.retryAfterSeconds;
  if (retry !== undefined && (typeof retry !== 'number' || !Number.isSafeInteger(retry) || retry < 0)) return null;
  return result(data.outcome as Outcome, data.code as ResultCode, retry as number | undefined);
}
