// Все запросы Better Auth: /api/auth/*. CSRF и Origin уже проверил proxy.ts.
// Вход по паролю - через LoginGuard: перебор банит адрес, каждый отказ - строка в журнале.

import { hubAuth } from '@/lib/auth.ts';
import { clientIp, ipKey, LoginGuard } from '@/lib/login-guard.ts';

export const dynamic = 'force-dynamic';

const guard = new LoginGuard();

function unavailable(): Response {
  return Response.json({ message: 'вход недоступен: база хаба не настроена' }, { status: 503 });
}

async function signIn(request: Request, handler: (r: Request) => Promise<Response>): Promise<Response> {
  const ip = clientIp(request.headers);
  const key = ipKey(ip);
  const verdict = guard.check(key);
  if (verdict.banned) {
    // Формат строки держит фильтр fail2ban сервера: не менять без правки там.
    console.warn(`gf-auth: вход отклонён ip=${ip} причина=бан`);
    return Response.json(
      { message: `Слишком много неверных паролей. Попробуйте через ${Math.ceil(verdict.retryAfterS / 60)} мин.` },
      { status: 429, headers: { 'Retry-After': String(verdict.retryAfterS) } },
    );
  }
  const res = await handler(request);
  if (res.status === 401) {
    const ban = guard.fail(key);
    console.warn(`gf-auth: вход отклонён ip=${ip} причина=пароль${ban ? ` бан=${ban.bannedForS}с` : ''}`);
  } else if (res.ok) guard.success(key);
  return res;
}

async function handle(request: Request): Promise<Response> {
  const auth = hubAuth();
  if (!auth) return unavailable();
  if (request.method === 'POST' && new URL(request.url).pathname === '/api/auth/sign-in/email') {
    return signIn(request, auth.handler);
  }
  return auth.handler(request);
}

export { handle as GET, handle as POST };
