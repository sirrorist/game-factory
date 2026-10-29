// Сессия текущего запроса для серверных компонентов. База не настроена - гость, как раньше (D-024).

import { headers } from 'next/headers';
import { cache } from 'react';
import { can, readSessionAccess, type Permission, type UserRole } from '@gf/db';
import { hubAuth } from './auth.ts';
import { hubDb } from './db.ts';

export interface HubUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active';
}

// cache: шапка, навигация и страница спрашивают сессию в одном запросе - в базу идём один раз.
export const currentUser = cache(async (): Promise<HubUser | null> => {
  const auth = hubAuth();
  if (!auth) return null;
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const db = hubDb();
  if (!db) return null;
  const current = await readSessionAccess(db, s.session.id);
  return current ? { id: current.id, name: current.name, email: current.email, role: current.role, status: 'active' } : null;
});

/** Владение играми/отдельные допуски пререлизов подключаются в 2А-04. */
export async function currentWithPermission(permission: Permission): Promise<HubUser | null> {
  const current = await currentUser();
  return can(current, permission) ? current : null;
}
