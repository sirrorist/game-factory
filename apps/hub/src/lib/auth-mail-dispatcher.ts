import type { AuthMailStore } from '@gf/db';
import type { PreparedMail } from './mail-client.ts';
import type { MailResult } from '../../../mail-relay/src/protocol.ts';

/** Один relay.send на запись. Потерянный результат никогда не превращается в новый ID. */
export function authMailDispatcher(store: AuthMailStore, send: (mail: PreparedMail, signal: AbortSignal) => Promise<MailResult>) {
  let active = 0, stopped = false;
  const controllers = new Set<AbortController>();
  return {
    async tick() {
      if (stopped || active >= 2) return;
      active++;
      const controller = new AbortController(); controllers.add(controller);
      let id: string | undefined;
      try {
        const claimed = await store.claim();
        if (!claimed) return;
        id = claimed.id;
        // Даже отменённый после claim процесс оставляет консервативный unknown.
        const outcome = controller.signal.aborted ? 'unknown' : (await send(claimed.mail, controller.signal)).outcome;
        await store.finish(id, outcome);
      } catch {
        if (id) { try { await store.finish(id, 'unknown'); } catch { /* persisted started будет unknown, без повторной отправки */ } }
        // Исключения драйвера/HTTP могут содержать bearer. Исходный error не журналируется.
      } finally { active--; controllers.delete(controller); }
    },
    stop() { stopped = true; for (const c of controllers) c.abort(); },
  };
}
