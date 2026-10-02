'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons.tsx';
import { Button } from '@/components/ui/button.tsx';
import { authClient } from '@/lib/auth-client.ts';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = (): void => {
    router.push('/account');
    router.refresh();
  };

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email: String(form.get('email')), password: String(form.get('password')) });
    setBusy(false);
    if (error) setError(error.status === 429 ? (error.message ?? 'Слишком много попыток') : 'Неверная почта или пароль');
    else done();
  }

  async function withPasskey(): Promise<void> {
    setBusy(true);
    setError(null);
    const r = await authClient.signIn.passkey();
    setBusy(false);
    if (r?.error) setError('Passkey не подошёл или вход отменён');
    else done();
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="gf-form" onSubmit={submit} data-testid="login-form">
        <label className="gf-field">
          <span>Почта</span>
          <input className="gf-input" name="email" type="email" autoComplete="username webauthn" required />
        </label>
        <label className="gf-field">
          <span>Пароль</span>
          <input className="gf-input" name="password" type="password" autoComplete="current-password" required />
        </label>
        {error ? (
          <p className="gf-form__error" role="alert" data-testid="login-error">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          Войти
        </Button>
      </form>
      <Button variant="ghost" disabled={busy} onClick={() => void withPasskey()}>
        <Icon name="user" />
        Войти с passkey
      </Button>
    </div>
  );
}
