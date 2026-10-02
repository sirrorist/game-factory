import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { hubAuth } from '@/lib/auth.ts';
import { currentUser } from '@/lib/session.ts';
import { LoginForm } from './login-form.tsx';

export const metadata: Metadata = { title: 'Вход' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUser()) redirect('/account');
  return (
    <section className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">Вход</h1>
        <p className="text-muted-foreground">
          Пока входит только владелец хаба. Играть можно и без входа - рекорды и сохранения останутся в этом браузере.
        </p>
      </div>
      {hubAuth() ? <LoginForm /> : <p className="text-muted-foreground">Вход недоступен: база хаба не настроена.</p>}
    </section>
  );
}
