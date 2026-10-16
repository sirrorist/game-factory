'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client.ts';
import { Button } from '@/components/ui/button.tsx';
import { Icon } from '@/components/icons.tsx';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gf-sign-out"
      aria-label="Выйти"
      title="Выйти"
      disabled={busy}
      data-testid="sign-out"
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        router.push('/');
        router.refresh();
      }}
    >
      <Icon name="back" className="gf-sign-out__icon" />
      <span className="gf-sign-out__text">Выйти</span>
    </Button>
  );
}
