// Защита от CSRF - в одном месте, в proxy.ts (спецификация этапа 1, слайс 1.2), а не в каждом
// обработчике. Изменяющий запрос проходит, только если совпали ОБА признака:
//   1. Origin - ровно origin хаба. Запрос без Origin отвергается: браузеры шлют его на любой
//      POST/PUT/PATCH/DELETE, без него - не браузер со страницы хаба или старый клиент.
//   2. Токен в заголовке = токену в куке `__Host-gf-csrf` (двойная отправка). Чужая страница
//      куку не прочтёт, а поддомен игры не перезапишет: `__Host-` запрещает Domain (П-006).
// SameSite=Lax у сессии от CSRF не спасает: игры на поддоменах - тот же "site" (П-005).
//
// Модуль без Next и без `@/`-импортов: его гоняет node:test напрямую (test/csrf.test.ts).

import { randomBytes, timingSafeEqual } from 'node:crypto';

export { CSRF_COOKIE, CSRF_HEADER } from './csrf-names.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfInput {
  method: string;
  origin: string | null;
  cookie: string | undefined;
  header: string | null;
}

export type CsrfVerdict = { ok: true } | { ok: false; reason: string };

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Значение заголовка - в журнал: только символы origin, не длиннее 80. Иначе любой клиент
 * впишет в Origin текст строки `gf-auth: вход отклонён ip=…` с чужим адресом - и fail2ban
 * сервера забанит этот адрес по нашему журналу.
 */
export function logSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9.:/[\]-]/g, '_').slice(0, 80);
}

/** hubOrigin = null (хаб не настроен) - изменяющие запросы закрыты все: лучше отказ, чем дыра. */
export function checkCsrf(req: CsrfInput, hubOrigin: string | null): CsrfVerdict {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };
  if (!hubOrigin) return { ok: false, reason: 'origin хаба не настроен (GF_HUB_ORIGIN)' };
  if (!req.origin) return { ok: false, reason: 'нет Origin' };
  if (req.origin !== hubOrigin) return { ok: false, reason: `чужой Origin ${logSafe(req.origin)}` };
  if (!req.cookie || req.cookie.length < 32) return { ok: false, reason: 'нет CSRF-куки' };
  if (!req.header || !sameToken(req.header, req.cookie)) return { ok: false, reason: 'CSRF-токен не совпал' };
  return { ok: true };
}
