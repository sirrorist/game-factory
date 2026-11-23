// Конфигурация без Next/окружения: те же HTTP-обработчики проверяются на временной БД.
import { passkey } from '@better-auth/passkey';
import { factorStore, MIN_PASSWORD_LENGTH, readEmailAccess, readSessionAccess, type AnyDb } from '@gf/db';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { authAccess, invalidLogin } from './auth-access.ts';
import { SESSION_TTL_S } from './session-bearer.ts';

export const SESSION_COOKIE = '__Host-gf-session';

// Сессия учётки с обязательным вторым фактором ходит в Better Auth только сюда: чтение, выход,
// имя профиля. Пароль, passkey, email и выдача сессий - через /api/account/security. Белый
// список: новый путь Better Auth или плагина закрыт, пока его не внесут сюда после ревью.
const REQUIRED_ALLOWED = new Set(['/get-session', '/sign-out', '/update-user', '/list-sessions',
  '/revoke-session', '/revoke-sessions', '/revoke-other-sessions', '/passkey/list-user-passkeys']);

export function createHubAuth(db: AnyDb, origin: string, secret: string, plugins: BetterAuthPlugin[] = []) {
  const access = authAccess(db), factors = factorStore(db);
  const auth = betterAuth({
    appName: 'Game Factory',
    baseURL: origin,
    secret,
    trustedOrigins: [origin],
    database: access.database,
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
    // Удаление потребует отдельного процесса; прямое delete-user не обходит guards.
    user: { deleteUser: { enabled: false } },
    session: {
      cookieCache: { enabled: false },
      // Строго 30 дней от входа, без скользящего продления (D-071).
      expiresIn: SESSION_TTL_S,
      disableSessionRefresh: true,
      additionalFields: { securityGeneration: { type: 'number', input: false, returned: false, defaultValue: 0 } },
    },
    // Новая многоуровневая политика Q3 — следующий шаг; существующую защиту сохраняем.
    rateLimit: { enabled: true, storage: 'memory', customRules: { '/sign-in/email': { window: 60, max: 10 } } },
    advanced: {
      useSecureCookies: false,
      cookiePrefix: '__Host-gf',
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      cookies: { session_token: { name: SESSION_COOKIE } },
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (newSession) => {
            const generation = access.sessionGeneration(newSession.userId);
            if (generation === null) return false;
            return { data: { ...newSession, securityGeneration: generation } };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Штатные JWT/GET recovery не являются альтернативой платформенному одноразовому POST.
        if (/^\/(?:send-verification-email|verify-email|request-password-reset|reset-password|forget-password)(?:\/|$)/.test(ctx.path)) {
          throw new APIError('FORBIDDEN', { message: 'используйте платформенное действие' });
        }
        if (ctx.path === '/sign-in/email' && typeof ctx.body?.email === 'string') {
          ctx.body.email = ctx.body.email.trim().toLowerCase();
          const row = await readEmailAccess(db, ctx.body.email);
          if (row && typeof ctx.body.password === 'string' && await factors.required(row.id)) {
            // Вход только через B. Работа - как у Better Auth для неизвестного email (хэш пароля
            // и общий 401), без проверки пароля: ни ответ, ни время его не подтверждают.
            await ctx.context.password.hash(ctx.body.password);
            invalidLogin();
          }
        }
        await access.before(ctx.path, ctx.body);
        // Профиль/пароль/регистрация не являются способом назначить права.
        if (ctx.body && ['role', 'status', 'securityGeneration', 'security_generation', 'emailVerified', 'email_verified', 'authActionsNotBefore', 'auth_actions_not_before']
          .some((field) => Object.hasOwn(ctx.body, field))) {
          throw new APIError('BAD_REQUEST', { message: 'поля доступа не изменяются через профиль' });
        }
        if (ctx.path === '/sign-out') return;
        const current = await getSessionFromCtx(ctx);
        // Доказательство B проверяется по исходному bearer: сессия owner без TOTP/UV - не сессия.
        if (current && (!await readSessionAccess(db, current.session.id)
          || !await factors.access(current.session.id, current.session.token))) {
          throw new APIError('UNAUTHORIZED', { message: 'сессия недействительна' });
        }
        if (current && !REQUIRED_ALLOWED.has(ctx.path) && await factors.required(current.user.id)) {
          throw new APIError('FORBIDDEN', { message: 'для этой учётки - через раздел безопасности' });
        }
      }),
    },
    // nextCookies добавляется вызывающим последним; тестам Next-контекст не нужен.
    plugins: [passkey({ rpID: new URL(origin).hostname, rpName: 'Game Factory', origin }), ...plugins],
  });
  // Одинаковая изоляция для HTTP и server API; $context не выдаёт доказательство входа.
  return { ...auth,
    handler: (request: Request) => access.run(() => auth.handler(request)),
    api: new Proxy(auth.api, { get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? (...args: unknown[]) => access.run(() => Reflect.apply(value, target, args)) : value;
    } }),
  };
}
