// Снимок доказательства входа живёт только в одном handler/api-вызове, не в cookie.
import { AsyncLocalStorage } from 'node:async_hooks';
import { lockAuthAccess, readEmailAccess, readPasskeyAccess, retryTransaction, schema, type AnyDb } from '@gf/db';
import type { BetterAuthOptions, DBAdapter, Where } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

type Proof = { userId: string; generation: number; sessionId?: string; passkeyId?: string };
type RequestAccess = { login?: Proof; session?: Proof; path?: string };
type Mutation = { model: string; data?: Record<string, unknown>; update?: Record<string, unknown>; where?: Where[] };
const mutations = new Set(['create', 'update', 'updateMany', 'delete', 'deleteMany', 'consumeOne', 'incrementOne']);

function denied(): never { throw new APIError('UNAUTHORIZED', { message: 'доступ изменён: повторите вход' }); }

export function authAccess(db: AnyDb) {
  const requests = new AsyncLocalStorage<RequestAccess>();
  const config = { provider: 'pg' as const, schema: { user: schema.user, session: schema.session,
    account: schema.account, verification: schema.verification, passkey: schema.passkey } };

  function adapter(options: BetterAuthOptions, connection: AnyDb = db, inTransaction = false): DBAdapter {
    const raw = drizzleAdapter(connection, config)(options);
    const guarded: DBAdapter = new Proxy(raw, { get(target, key) {
      // Нельзя выдать плагину исходный незащищённый adapter внутри transaction callback.
      if (key === 'transaction') return <T>(fn: (tx: DBAdapter) => Promise<T>) => inTransaction
        ? fn(guarded) : retryTransaction(db, (tx) => fn(adapter(options, tx, true)));
      if (key === 'findOne') return async (args: Parameters<DBAdapter['findOne']>[0]) => {
        const row = await target.findOne<Record<string, unknown>>(args);
        const state = requests.getStore();
        if (state && args.model === 'session' && row && !state.session) {
          if (typeof row.id === 'string' && typeof row.userId === 'string' && typeof row.securityGeneration === 'number') {
            // Поколение именно прочитанной сессии; не свежей учётки после сброса.
            state.session = { userId: row.userId, generation: row.securityGeneration, sessionId: row.id };
          }
        }
        return row;
      };
      const value = Reflect.get(target, key);
      if (!mutations.has(String(key))) return typeof value === 'function' ? value.bind(target) : value;
      return async (args: Mutation) => {
        if (args.model === 'verification') return Reflect.apply(value, target, [args]);
        if (key === 'consumeOne' || key === 'incrementOne') denied();
        const state = requests.getStore();
        const proof = args.model === 'session' && key === 'create' ? state?.login ?? state?.session
          : args.model === 'passkey' && state?.path === '/passkey/verify-authentication' ? state.login : state?.session;
        if (!proof || !['user', 'account', 'passkey', 'session'].includes(args.model)) denied();
        // Неавторизованный passkey-вход может только увеличить counter своего ключа.
        if (!proof.sessionId && !(args.model === 'session' && key === 'create')
          && !(args.model === 'passkey' && key === 'update' && proof.passkeyId
            && Object.keys(args.update ?? {}).every((field) => field === 'counter'))) denied();

        const write = async (tx: AnyDb) => {
          const txAdapter = drizzleAdapter(tx, config)(options);
          let deleteExpired = false;
          if (args.model === 'session' && key === 'delete' && args.where?.length) {
            const rows = await txAdapter.findMany<Record<string, unknown>>({ model: 'session', where: args.where });
            // get-session удаляет истёкшую строку. Это исключение только для удаления
            // самой исходной сессии; оно не разрешает refresh или изменение credentials.
            deleteExpired = rows.length === 1 && rows[0]?.id === proof.sessionId;
          }
          // Порядок всегда user → credentials/session. До криптографии блокировок нет.
          if (!await lockAuthAccess(tx, proof, deleteExpired)) denied();
          const field = args.model === 'user' ? 'id' : 'userId';
          let input = args;
          if (key === 'create') {
            if (args.data?.[field] !== proof.userId) denied();
            if (args.model === 'session') input = { ...args, data: { ...args.data, securityGeneration: proof.generation } };
          } else {
            // Поддерживаемые auth-вызовы адресуют одну учётку; расширение требует ревью.
            if (!args.where?.length || args.where.some((w) => w.connector === 'OR')) denied();
            if (['userId', 'securityGeneration', 'id'].some((f) => Object.hasOwn(args.update ?? {}, f))) denied();
            const rows = await txAdapter.findMany<Record<string, unknown>>({ model: args.model, where: args.where });
            if (!rows.length && (key === 'update' || key === 'incrementOne')) denied();
            if (rows.some((row) => row[field] !== proof.userId || (proof.passkeyId && args.model === 'passkey' && row.id !== proof.passkeyId))) denied();
            input = { ...args, where: [...args.where, { field, value: proof.userId }] };
          }
          return Reflect.apply(Reflect.get(txAdapter, key), txAdapter, [input]);
        };
        const result = await (inTransaction ? write(connection) : retryTransaction(db, write));
        if (state?.path === '/change-password' && args.model === 'account' && key === 'update'
          && typeof args.update?.password === 'string' && result) {
          // Штатный revokeOtherSessions удалит и исходную сессию. Новая опирается на
          // только что проверенный пароль и прежнее поколение, не на удалённую cookie.
          state.login = { userId: proof.userId, generation: proof.generation };
        }
        return result;
      };
    } });
    return guarded;
  }

  return { database: (options: BetterAuthOptions) => adapter(options),
    run: <T>(fn: () => T): T => requests.run({}, fn),
    async before(path: string, body: Record<string, unknown> | undefined) {
      const state = requests.getStore();
      if (!state) denied();
      state.path = path;
      // Снимок берётся до чтения credential библиотекой и до проверки подписи/пароля.
      if (path === '/sign-in/email' && typeof body?.email === 'string') {
        const row = await readEmailAccess(db, body.email);
        if (row?.status === 'active') state.login = { userId: row.id, generation: row.securityGeneration };
      } else if (path === '/passkey/verify-authentication') {
        const response = body?.response;
        if (response && typeof response === 'object' && 'id' in response && typeof response.id === 'string') {
          const row = await readPasskeyAccess(db, response.id);
          if (row) state.login = { userId: row.user.id, generation: row.user.securityGeneration, passkeyId: row.passkey.id };
        }
      }
    },
    sessionGeneration(userId: string): number | null {
      const state = requests.getStore();
      const proof = state?.login ?? state?.session;
      return proof?.userId === userId ? proof.generation : null;
    },
  };
}
