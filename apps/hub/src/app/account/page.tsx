import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FirstScreen } from '@/components/first-screen.tsx';
import { currentUser } from '@/lib/session.ts';
import { PasskeyPanel } from './passkey-panel.tsx';
import { PasswordHelp } from './password-help.tsx';

export const metadata: Metadata = { title: 'Учётная запись' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <FirstScreen anchor>
      <div className="gf-account-page">
        <header className="gf-account-profile" data-first-screen-anchor>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Учётная запись</p>
          <h1 className="font-display text-3xl font-bold tracking-tight">{user.name}</h1>
          <p className="text-muted-foreground" data-testid="account-email">{user.email}</p>
        </header>
        <PasskeyPanel />
        <PasswordHelp>
          <p>Пароль меняется на сервере: <code>admin.ts set-password</code> (docs/OPERATIONS.md) — писем у хаба пока нет.</p>
        </PasswordHelp>
      </div>
    </FirstScreen>
  );
}
