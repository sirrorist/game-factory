// Клиент входа для браузера (компоненты 'use client'). Каждый запрос к /api/auth несёт
// CSRF-токен из куки `__Host-gf-csrf` - без него proxy.ts отвечает 403 (lib/csrf.ts).

import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/react';
import { CSRF_COOKIE, CSRF_HEADER } from './csrf-names.ts';

function csrfToken(): string {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : '';
}

export const authClient = createAuthClient({
  plugins: [passkeyClient()],
  fetchOptions: {
    onRequest(ctx) {
      ctx.headers.set(CSRF_HEADER, csrfToken());
    },
  },
});
