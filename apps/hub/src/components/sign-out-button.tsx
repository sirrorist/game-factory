'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client.ts';
import { Button } from '@/components/ui/button.tsx';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      data-testid="sign-out"
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        router.push('/');
        router.refresh();
      }}
    >
      Выйти
    </Button>
  );
}
