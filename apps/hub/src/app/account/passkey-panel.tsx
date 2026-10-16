'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { authClient } from '@/lib/auth-client.ts';
import { Icon } from '@/components/icons.tsx';

interface Passkey {
  id: string;
  name?: string | null;
  createdAt?: Date | string | null;
}

/** Passkey владельца: список, добавить, удалить. Ключ не уходит наружу и не фишится (D-047, Р4). */
export function PasskeyPanel() {
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  async function load(): Promise<void> {
    const { data, error } = await authClient.passkey.listUserPasskeys();
    if (error) setError('Не удалось загрузить passkey');
    else setKeys((data ?? []) as Passkey[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(): Promise<void> {
    setNoticeDismissed(false);
    setError(null);
    const r = await authClient.passkey.addPasskey({ name: navigator.platform || 'устройство' });
    if (r?.error) setError('Passkey не добавлен: устройство отказало или добавление отменено');
    await load();
  }

  async function remove(id: string): Promise<void> {
    setNoticeDismissed(false);
    setError(null);
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) setError('Не удалось удалить passkey');
    await load();
  }

  return (
    <section className="gf-passkey-panel" aria-label="Passkey" data-first-screen-anchor>
      <div className="gf-passkey-heading">
        <h2 className="font-display text-xl font-semibold">Passkey</h2>
        <Button size="sm" onClick={() => void add()}>Добавить passkey</Button>
      </div>
      {error && !noticeDismissed ? (
        <div className="gf-passkey-notice" role="alert">
          <p>{error}</p>
          <button type="button" className="gf-passkey-notice-close" aria-label="Закрыть сообщение"
            onClick={() => setNoticeDismissed(true)}><Icon name="close" /></button>
        </div>
      ) : null}
      {keys === null ? (
        <p className="text-muted-foreground" role="status">{error ? 'Список ключей недоступен.' : 'Загрузка…'}</p>
      ) : null}
      {keys?.length === 0 ? <p className="text-muted-foreground">Пока нет - вход только по паролю.</p> : null}
      {keys?.length ? (
        <ul className="gf-passkey-list" data-testid="passkeys">
          {keys.map((k) => (
            <li key={k.id} className="gf-passkey-item">
              <span className="gf-passkey-name">{k.name || 'без названия'}</span>
              <Button variant="ghost" size="sm" onClick={() => void remove(k.id)}>
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
