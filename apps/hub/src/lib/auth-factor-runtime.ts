// Действия B (D-066, D-071) для маршрута /api/account/security/[action]: собирает factorHttp
// из базы, ключа факторов и секрета входа. Без базы, origin или ключа - 503, а не вход без B.

import { factorKeysFromEnv, factorStore } from '@gf/db';
import { factorController } from './auth-factor-core.ts';
import { factorHttp } from './auth-factor-http.ts';
import { hubAuth, hubAuthSecret } from './auth.ts';
import { hubOrigin } from './config.ts';
import { hubDb } from './db.ts';
import { sessionAccess } from './session-access.ts';

let handle: ReturnType<typeof factorHttp> | undefined;
// Сломанная конфигурация не перечитывает файлы ключей на каждый запрос: отказ держится 10 с.
let brokenUntil = 0;

function createHandle() {
  const db = hubDb(), origin = hubOrigin(), auth = hubAuth();
  if (!db || !origin || !auth) throw new Error('для действий B нужны база и origin хаба');
  return factorHttp({ enabled: true, origin, secret: hubAuthSecret(),
    control: factorController(factorStore(db), factorKeysFromEnv()),
    async session(headers) {
      const current = await sessionAccess(auth, db, headers);
      return current ? { id: current.sessionId, email: current.user.email } : null;
    } });
}

export async function handleFactorAction(req: Request, action: string): Promise<Response> {
  if (!handle) {
    try {
      if (Date.now() < brokenUntil) throw new Error('повтор отказа конфигурации');
      handle = createHandle();
    } catch (error) {
      if (Date.now() >= brokenUntil) {
        brokenUntil = Date.now() + 10_000;
        // Только имя и код ошибки: message чужих библиотек и fs не контролируем.
        const name = error instanceof Error && /^\w{1,40}$/.test(error.name) ? error.name : 'unknown';
        const code = (error as { code?: unknown })?.code;
        console.warn(`gf-auth: действия B не настроены: ошибка=${name}${typeof code === 'string' && /^[A-Z_]{1,20}$/.test(code) ? ` код=${code}` : ''}`);
      }
      return Response.json({ code: 'temporarily_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  }
  return handle(req, action);
}
