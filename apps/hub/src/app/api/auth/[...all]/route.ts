// Все запросы Better Auth: /api/auth/*. CSRF и Origin уже проверил proxy.ts.
// Вход по паролю и смена пароля - через LoginGuard (lib/guarded-auth.ts): перебор банит адрес,
// каждый отказ - строка в журнале.

import { hubAuth } from '@/lib/auth.ts';
import { guardedAuthRequest } from '@/lib/guarded-auth.ts';

export const dynamic = 'force-dynamic';

function unavailable(): Response {
  return Response.json({ message: 'вход недоступен: база хаба не настроена' }, { status: 503 });
}

async function handle(request: Request): Promise<Response> {
  const auth = hubAuth();
  if (!auth) return unavailable();
  return guardedAuthRequest(request, auth.handler);
}

export { handle as GET, handle as POST };
