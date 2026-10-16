import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FirstScreen } from '@/components/first-screen.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { hubAuth } from '@/lib/auth.ts';
import { currentUser } from '@/lib/session.ts';
import { LoginForm } from './login-form.tsx';

export const metadata: Metadata = { title: 'Вход' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUser()) redirect('/account');
  return (
    <FirstScreen>
      <div className="gf-login-page">
        <header className="gf-login-heading">
          <h1 className="font-display text-3xl font-bold tracking-tight">Вход</h1>
          <p className="text-muted-foreground">
            Пока входит только владелец хаба.
          </p>
          <p className="gf-login-note text-muted-foreground">
            Играть можно без входа. Рекорды и сохранения останутся в этом браузере.
          </p>
        </header>
        {hubAuth() ? <LoginForm /> : (
          <div className="gf-login-unavailable">
            <p className="text-muted-foreground" role="status">Вход сейчас недоступен. Попробуй позже.</p>
            <Link href="/" className={buttonVariants({ variant: 'outline' })}>Перейти в каталог</Link>
          </div>
        )}
      </div>
    </FirstScreen>
  );
}
