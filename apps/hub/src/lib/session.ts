// Сессия текущего запроса для серверных компонентов. База не настроена - гость, как раньше (D-024).

import { headers } from 'next/headers';
import { hubAuth } from './auth.ts';

export interface HubUser {
  id: string;
  name: string;
  email: string;
}

export async function currentUser(): Promise<HubUser | null> {
  const auth = hubAuth();
  if (!auth) return null;
  const s = await auth.api.getSession({ headers: await headers() });
  return s ? { id: s.user.id, name: s.user.name, email: s.user.email } : null;
}
