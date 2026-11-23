// Лимит перебора пароля на штатных маршрутах Better Auth: вход по email и смена пароля.
// Модуль без Next и без `@/`-импортов, чтобы node:test гонял его с подставным обработчиком;
// route.ts только передаёт сюда запрос и handler Better Auth.

import { clientIp, guardSubject, ipKey, passwordGuard, type LoginGuard } from './login-guard.ts';

export const SIGN_IN_PATH = '/api/auth/sign-in/email';
export const CHANGE_PASSWORD_PATH = '/api/auth/change-password';

/**
 * Email из тела - тем же разбором, что у Better Auth: вход принимает и JSON, и
 * x-www-form-urlencoded. Не прочитали - '' : такая неудача считается, но снять её нельзя.
 */
export async function requestEmail(request: Request): Promise<string> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  try {
    if (type === 'application/json') {
      const body: unknown = await request.clone().json();
      return guardSubject(typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined);
    }
    if (type === 'application/x-www-form-urlencoded') return guardSubject((await request.clone().formData()).get('email'));
  } catch {
    return '';
  }
  return '';
}

function banned(retryAfterS: number): Response {
  return Response.json(
    { message: `Слишком много неверных паролей. Попробуйте через ${Math.ceil(retryAfterS / 60)} мин.` },
    { status: 429, headers: { 'Retry-After': String(retryAfterS) } },
  );
}

/** Неверный текущий пароль у /change-password Better Auth - 400 с кодом INVALID_PASSWORD. */
async function wrongCurrentPassword(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  try {
    return ((await res.clone().json()) as { code?: unknown })?.code === 'INVALID_PASSWORD';
  } catch {
    return false;
  }
}

export async function guardedAuthRequest(
  request: Request,
  handler: (r: Request) => Promise<Response>,
  guard: LoginGuard = passwordGuard,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST' || (path !== SIGN_IN_PATH && path !== CHANGE_PASSWORD_PATH)) return handler(request);
  const ip = clientIp(request.headers);
  const key = ipKey(ip);
  const verdict = guard.check(key);
  if (verdict.banned) {
    // Формат строки держит фильтр fail2ban сервера: не менять без правки там.
    console.warn(`gf-auth: вход отклонён ip=${ip} причина=бан`);
    return banned(verdict.retryAfterS);
  }
  if (path === CHANGE_PASSWORD_PATH) {
    // Сессия уже есть, email в теле нет: неудачи считаются по адресу и успехом не снимаются.
    const res = await handler(request);
    if (await wrongCurrentPassword(res)) {
      const ban = guard.fail(key);
      console.warn(`gf-auth: смена пароля отклонена ip=${ip} причина=пароль${ban ? ` бан=${ban.bannedForS}с` : ''}`);
    }
    return res;
  }
  const subject = await requestEmail(request);
  const res = await handler(request);
  if (res.status === 401) {
    const ban = guard.fail(key, Date.now(), subject);
    console.warn(`gf-auth: вход отклонён ip=${ip} причина=пароль${ban ? ` бан=${ban.bannedForS}с` : ''}`);
  } else if (res.ok) guard.success(key, subject);
  return res;
}
