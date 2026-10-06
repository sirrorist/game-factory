/**
 * Очередь уведомлений без DOM: не больше трёх на экране, повтор того же текста не плодит
 * новую плашку, а продлевает старую со счётчиком (приёмка владельца, пункт 7).
 */

export interface Notice {
  id: number;
  text: string;
  count: number;
  expiresAt: number;
}

export const NOTICE_LIMIT = 3;
/** Время показа, мс: 4.2 с не хватало, чтобы дочитать длинную строку в бою. */
export const NOTICE_TTL = 6000;

let nextId = 1;

/** Новое уведомление в очередь; возвращает новый массив, старые - в начале. */
export function pushNotification(list: readonly Notice[], text: string, now: number): Notice[] {
  const alive = list.filter((n) => n.expiresAt > now);
  const same = alive.find((n) => n.text === text);
  if (same) {
    return alive.map((n) => (n === same ? { ...n, count: n.count + 1, expiresAt: now + NOTICE_TTL } : n));
  }
  const next = [...alive, { id: nextId++, text, count: 1, expiresAt: now + NOTICE_TTL }];
  return next.slice(Math.max(0, next.length - NOTICE_LIMIT));
}

/** Убрать истёкшие. */
export function pruneNotifications(list: readonly Notice[], now: number): Notice[] {
  return list.filter((n) => n.expiresAt > now);
}
