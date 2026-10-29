// Проверяемый без Next HTTP-контракт; серверные права не зависят от UI.
import { consumeAuthAction, hasPendingAuthAction, TOKEN_RE, MIN_PASSWORD_LENGTH, type AnyDb, type AuthPurpose } from '@gf/db';
import { hashPassword } from '../../../../packages/db/src/admin.ts';
import { checkCsrf } from './csrf.ts';
import { CSRF_COOKIE, CSRF_HEADER } from './csrf-names.ts';
import { clientIp, ipKey } from './login-guard.ts';
import type { AuthMailKeys } from '@gf/db';
import type { AuthMailStore } from '@gf/db';

export const AUTH_BROWSER_COOKIE = '__Host-gf-mail-browser';
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
export function cookieValue(cookie: string | null, name: string) {
  return cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
}
async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/json' || !req.body) return null;
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000); timer.unref();
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 4096) { await reader.cancel(); return null; } chunks.push(value); }
    // cancel завершает read с done=true; это не EOF и не разрешение разобрать накопленный JSON.
    if (timedOut) return null;
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; } finally { clearTimeout(timer); reader.releaseLock(); }
}
const exact = (body: Record<string, unknown>, fields: string[]) => Object.keys(body).sort().join(',') === fields.sort().join(',');
export function authActionHttp(deps: { db: AnyDb; origin: string; keys: AuthMailKeys; store: AuthMailStore;
  enabled: boolean; session: (headers: Headers) => Promise<{ id: string } | null> }) {
  return async (req: Request, purpose: AuthPurpose, action: 'request' | 'consume') => {
    const reply = (body: object, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
    if (!deps.enabled) return reply({ code: 'disabled' }, 404);
    if (req.method !== 'POST') return reply({ code: 'method_not_allowed' }, 405, { allow: 'POST' });
    const csrf = checkCsrf({ method: req.method, origin: req.headers.get('origin'),
      cookie: cookieValue(req.headers.get('cookie'), CSRF_COOKIE), header: req.headers.get(CSRF_HEADER) }, deps.origin);
    if (!csrf.ok) return reply({ code: 'forbidden' }, 403);
    const body = await readBody(req); if (!body) return reply({ code: 'invalid_request' }, 400);
    try {
      if (action === 'request') {
        if (!exact(body, ['email', 'intent']) || typeof body.email !== 'string' || body.email.length > 254 ||
          typeof body.intent !== 'string' || !deps.keys.validIntent(body.intent)) return reply({ code: 'invalid_request' }, 400);
        const browser = deps.keys.browser(cookieValue(req.headers.get('cookie'), AUTH_BROWSER_COOKIE));
        const result = await deps.store.request({ email: body.email, purpose, intent: body.intent, browser: browser.id, ip: ipKey(clientIp(req.headers)) });
        const extra: Record<string, string> = { 'set-cookie': `${AUTH_BROWSER_COOKIE}=${browser.cookie}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000` };
        if (result.retryAfter) return reply({ code: 'source_limited' }, 429, { ...extra, 'retry-after': String(result.retryAfter) });
        return reply({ code: 'request_received' }, 202, extra);
      }
      const fields = purpose === 'reset' ? ['token', 'password'] : ['token'];
      if (!exact(body, fields) || typeof body.token !== 'string' || !TOKEN_RE.test(body.token) ||
        (purpose === 'reset' && (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH || body.password.length > 128))) return reply({ code: 'invalid_request' }, 400);
      const session = await deps.session(req.headers);
      if (!await hasPendingAuthAction(deps.db, body.token, purpose)) return reply({ code: 'invalid' }, 400);
      const passwordHash = purpose === 'reset' ? await hashPassword(body.password as string) : undefined;
      const result = await consumeAuthAction(deps.db, { token: body.token, purpose, passwordHash, sessionId: session?.id });
      return reply({ code: result }, result === 'ok' ? 200 : result === 'conflict' ? 409 : 400);
    } catch { return reply({ code: 'temporarily_unavailable' }, 503); }
  };
}
