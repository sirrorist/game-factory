// Шапка: гостю - "Войти", вошедшему - имя (ссылка на /account) и "Выйти".

import Link from 'next/link';
import { currentUser } from '@/lib/session.ts';
import { buttonVariants } from '@/components/ui/button.tsx';
import { Icon } from '@/components/icons.tsx';
import { SignOutButton } from './sign-out-button.tsx';

export async function UserMenu() {
  const user = await currentUser();
  if (!user) {
    return (
      <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-testid="sign-in-link">
        <Icon name="user" />
        Войти
      </Link>
    );
  }
  return (
    <>
      <Link href="/account" className="gf-user" data-testid="user-name">
        <Icon name="user" />
        {user.name}
      </Link>
      <SignOutButton />
    </>
  );
}
