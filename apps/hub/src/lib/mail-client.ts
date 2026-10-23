// Серверный клиент; сам не открывает auth-маршруты и не выдаёт recovery-токены.
import { randomUUID } from 'node:crypto';
import { boundedExchange, nodeExchange, type Exchange } from '../../../mail-relay/src/io.ts';
import { secretFile } from '../../../mail-relay/src/config.ts';
import { canonicalOrigin, EXPIRY_HEADER, LIMITS, parseMailRequest, parseMailResult, result, validSecret, type MailRequest, type MailResult } from '../../../mail-relay/src/protocol.ts';

export type PreparedMail = Readonly<{ body: string; createdAt: number }>;
type Input = Omit<MailRequest, 'operationId'>;
type ClientConfig = Readonly<{ endpoint: string; hubOrigin: string; serviceSecret: string }>;
type ClientOptions = { exchange?: Exchange; now?: () => number; timeoutMs?: number };

export function restorePreparedMail(saved: unknown, origin: string): PreparedMail {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('неверный снимок письма');
  const value = saved as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'body,createdAt' || typeof value.body !== 'string' ||
      typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new Error('неверный снимок письма');
  parseMailRequest(value.body, origin);
  return Object.freeze({ body: value.body, createdAt: value.createdAt });
}
export function createHubMailClient(config: ClientConfig, options: ClientOptions = {}) {
  try {
    canonicalOrigin(config.hubOrigin);
    const endpoint = new URL(config.endpoint);
    if (!validSecret(config.serviceSecret) || !['mail-relay', '127.0.0.1'].includes(endpoint.hostname) ||
        !['http:', 'https:'].includes(endpoint.protocol) || endpoint.pathname !== '/v1/send' ||
        endpoint.search || endpoint.hash || endpoint.username || endpoint.password || endpoint.href !== config.endpoint) throw new Error();
  } catch { throw new Error('неверная конфигурация почтового клиента'); }
  const now = options.now ?? Date.now;
  const exchange = options.exchange ?? nodeExchange;
  return Object.freeze({
    prepare(input: Input): PreparedMail {
      const request = parseMailRequest(JSON.stringify({ ...input, operationId: randomUUID() }), config.hubOrigin);
      return restorePreparedMail({ body: JSON.stringify(request), createdAt: now() }, config.hubOrigin);
    },
    async send(saved: PreparedMail, signal: AbortSignal = new AbortController().signal): Promise<MailResult> {
      let mail: PreparedMail;
      try { mail = restorePreparedMail(saved, config.hubOrigin); }
      catch { return result('not_accepted', 'invalid_request'); }
      if (signal.aborted) return result('not_accepted', 'cancelled');
      const age = now() - mail.createdAt;
      if (age < 0) return result('not_accepted', 'invalid_request');
      const expiresAt = mail.createdAt + LIMITS.operationMs;
      const remaining = expiresAt - now() - LIMITS.operationSafetyMs;
      if (!Number.isSafeInteger(expiresAt) || remaining < LIMITS.attemptMs) return result('unknown', 'operation_expired');
      try {
        const reply = await boundedExchange(exchange, {
          url: config.endpoint, body: mail.body,
          headers: { authorization: 'Bearer ' + config.serviceSecret, 'content-type': 'application/json', [EXPIRY_HEADER]: String(expiresAt) },
          maxResponseBytes: LIMITS.replyBytes,
        }, signal, Math.min(options.timeoutMs ?? LIMITS.clientMs, remaining));
        if (reply.incomplete || Buffer.byteLength(reply.body) > LIMITS.replyBytes) return result('unknown', 'transport_error');
        const parsed = parseMailResult(JSON.parse(reply.body));
        if (!parsed || ((reply.status === 202) !== (parsed.outcome === 'accepted'))) return result('unknown', 'transport_error');
        return parsed;
      } catch { return result('unknown', signal.aborted ? 'cancelled' : now() >= expiresAt - LIMITS.operationSafetyMs ? 'operation_expired' : 'transport_error'); }
    },
  });
}
export function hubMailClientFromEnv(env: NodeJS.ProcessEnv = process.env) {
  // В рабочей конфигурации не разрешаем превратить клиент в отправщик секрета наружу.
  if (env.GF_MAIL_RELAY_URL !== 'http://mail-relay:4102/v1/send') throw new Error('неверный адрес внутреннего почтового шлюза');
  return createHubMailClient({
    endpoint: env.GF_MAIL_RELAY_URL, hubOrigin: env.GF_HUB_ORIGIN ?? '',
    serviceSecret: secretFile(env.GF_MAIL_SERVICE_SECRET_FILE),
  });
}
