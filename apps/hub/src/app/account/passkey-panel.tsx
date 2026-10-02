'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { authClient } from '@/lib/auth-client.ts';

interface Passkey {
  id: string;
  name?: string | null;
  createdAt?: Date | string | null;
}

/** Passkey владельца: список, добавить, удалить. Ключ не уходит наружу и не фишится (D-047, Р4). */
export function PasskeyPanel() {
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const { data, error } = await authClient.passkey.listUserPasskeys();
    if (error) setError('Не удалось загрузить passkey');
    else setKeys((data ?? []) as Passkey[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(): Promise<void> {
    setError(null);
    const r = await authClient.passkey.addPasskey({ name: navigator.platform || 'устройство' });
    if (r?.error) setError('Passkey не добавлен: устройство отказало или добавление отменено');
    await load();
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) setError('Не удалось удалить passkey');
    await load();
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold">Passkey</h2>
      {keys === null ? <p className="text-muted-foreground">загрузка…</p> : null}
      {keys?.length === 0 ? <p className="text-muted-foreground">Пока нет - вход только по паролю.</p> : null}
      {keys?.length ? (
        <ul className="flex flex-col gap-2" data-testid="passkeys">
          {keys.map((k) => (
            <li key={k.id} className="gf-row">
              <span className="flex-1">{k.name || 'без названия'}</span>
              <Button variant="ghost" size="sm" onClick={() => void remove(k.id)}>
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="gf-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button size="sm" onClick={() => void add()}>
          Добавить passkey
        </Button>
      </div>
    </div>
  );
}
