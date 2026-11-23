// Сессия запроса с правами - для SSR (session.ts) и маршрутов B. Без Next: проверяется
// node:test на временной БД. Правило одно для всех потребителей (план B, раздел 2):
// действующая сессия, поколение, статус и доказательство B по исходному bearer.

import { factorStore, readSessionAccess, type AnyDb } from '@gf/db';
import { APIError } from 'better-auth/api';
import type { createHubAuth } from './auth-core.ts';

type Auth = Pick<ReturnType<typeof createHubAuth>, 'api'>;

export async function sessionAccess(auth: Auth, db: AnyDb, headers: Headers) {
  let current;
  try {
    current = await auth.api.getSession({ headers });
  } catch (error) {
    // Хук Better Auth отказывает недействительной сессии исключением - для страницы это гость.
    if (error instanceof APIError && error.statusCode === 401) return null;
    throw error;
  }
  if (!current) return null;
  const user = await readSessionAccess(db, current.session.id);
  // Повтор проверки хука: страница не должна зависеть от того, что хук стоит на этом пути.
  if (!user || !await factorStore(db).access(current.session.id, current.session.token)) return null;
  return { sessionId: current.session.id, user };
}
