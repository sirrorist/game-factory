import type { AnyDb } from './index.ts';

function conflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && (error.code === '40P01' || error.code === '40001')) return true;
  return 'cause' in error && error.cause !== error && conflict(error.cause);
}

/** Только транзакции БД без внешних эффектов; повторяется вся операция, максимум трижды. */
export async function retryTransaction<T>(db: AnyDb, operation: (tx: Parameters<Parameters<AnyDb['transaction']>[0]>[0]) => Promise<T>,
  config?: Parameters<AnyDb['transaction']>[1]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(operation, config); }
    catch (error) { if (attempt >= 2 || !conflict(error)) throw error; }
  }
}
