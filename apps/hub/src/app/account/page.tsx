import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session.ts';
import { PasskeyPanel } from './passkey-panel.tsx';

export const metadata: Metadata = { title: 'Учётная запись' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">{user.name}</h1>
        <p className="text-muted-foreground" data-testid="account-email">
          {user.email}
        </p>
      </div>
      <PasskeyPanel />
      <p className="text-sm text-muted-foreground">
        Пароль меняется на сервере: <code>admin.ts set-password</code> (docs/OPERATIONS.md) - писем у хаба пока нет.
      </p>
    </section>
  );
}
