import { authActionHttp } from './auth-actions-http.ts';
import { authMailKeysFromEnv } from '@gf/db';
import { authMailStore } from '@gf/db';
import { authMailDispatcher } from './auth-mail-dispatcher.ts';
import { hubMailClientFromEnv } from './mail-client.ts';
import { hubOrigin } from './config.ts';
import { hubDb } from './db.ts';
import { hubAuth } from './auth.ts';

let runtime: ReturnType<typeof createRuntime> | undefined;
function createRuntime() {
  const db = hubDb(), origin = hubOrigin();
  if (!db || !origin) throw new Error('для закрытого auth-стенда нужны база и origin');
  const keys = authMailKeysFromEnv(), store = authMailStore(db, keys, origin);
  const handle = authActionHttp({ db, origin, keys, store, enabled: true,
    async session(headers) { return (await hubAuth()?.api.getSession({ headers }))?.session ?? null; } });
  return { store, handle };
}
export async function handleAuthAction(req: Request, purpose: 'verify' | 'reset', action: 'request' | 'consume') {
  if (process.env.GF_AUTH_ACTIONS_ENABLED !== 'closed-test') return Response.json({ code: 'disabled' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  try { return await (runtime ??= createRuntime()).handle(req, purpose, action); }
  catch { return Response.json({ code: 'temporarily_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
}
let stop: (() => void) | undefined;
export function startAuthMailDispatcher() {
  if (stop || process.env.GF_AUTH_ACTIONS_ENABLED !== 'closed-test' || process.env.GF_AUTH_MAIL_DISPATCHER !== 'closed-test') return;
  const { store } = runtime ??= createRuntime();
  const client = hubMailClientFromEnv();
  const dispatcher = authMailDispatcher(store, (mail, signal) => client.send(mail, signal));
  const timer = setInterval(() => { void dispatcher.tick(); }, 1000); timer.unref();
  stop = () => { clearInterval(timer); dispatcher.stop(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
