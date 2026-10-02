// Proxy (бывший middleware, Next 16): CSRF-проверка всех изменяющих запросов хаба в одном
// месте (lib/csrf.ts) и выдача CSRF-куки. Статика Next и шрифты сюда не заходят (matcher).

import { NextResponse, type NextRequest } from 'next/server';
import { hubOrigin } from '@/lib/config.ts';
import { checkCsrf, CSRF_COOKIE, CSRF_HEADER, newCsrfToken } from '@/lib/csrf.ts';

export function proxy(request: NextRequest): NextResponse {
  const cookie = request.cookies.get(CSRF_COOKIE)?.value;
  const verdict = checkCsrf(
    { method: request.method, origin: request.headers.get('origin'), cookie, header: request.headers.get(CSRF_HEADER) },
    hubOrigin(),
  );
  if (!verdict.ok) {
    console.warn(`gf-csrf: отказ ${request.method} ${request.nextUrl.pathname}: ${verdict.reason}`);
    return NextResponse.json({ message: 'запрос отклонён: проверка CSRF' }, { status: 403 });
  }
  const res = NextResponse.next();
  if (!cookie) {
    // Не HttpOnly: токен читает клиент хаба и шлёт заголовком. Strict - на чужие сайты не уходит вовсе.
    res.cookies.set({ name: CSRF_COOKIE, value: newCsrfToken(), secure: true, httpOnly: false, sameSite: 'strict', path: '/' });
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|fonts/|icon.svg|healthz).*)'],
};
