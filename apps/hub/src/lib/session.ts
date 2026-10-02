// Сессия текущего запроса для серверных компонентов. База не настроена - гость, как раньше (D-024).

import { headers } from 'next/headers';
import { cache } from 'react';
import { hubAuth } from './auth.ts';

export interface HubUser {
  id: string;
  name: string;
  email: string;
}

// cache: шапка, навигация и страница спрашивают сессию в одном запросе - в базу идём один раз.
export const currentUser = cache(async (): Promise<HubUser | null> => {
  const auth = hubAuth();
  if (!auth) return null;
  const s = await auth.api.getSession({ headers: await headers() });
  return s ? { id: s.user.id, name: s.user.name, email: s.user.email } : null;
});

/**
 * Владелец хаба: ему видны Web kit и пререлизы игр (D-060). Сейчас учётка есть только у
 * владельца - регистрации нет (D-058), поэтому вошедший и есть владелец. Появятся учётки
 * игроков (этап 2) - проверка роли встаёт сюда, и все закрытые разделы получат её разом.
 */
export async function currentOwner(): Promise<HubUser | null> {
  return currentUser();
}
