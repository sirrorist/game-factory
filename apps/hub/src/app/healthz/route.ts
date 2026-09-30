// Живость хаба вместе с базой: 200 - база отвечает, 503 - нет. Маршрут открыт всем, поэтому
// наружу - одно слово, без причины: не настроена, нет связи или ошибка настройки - видно только
// в журнале хаба. Ответ живёт 5 секунд: поток запросов не должен занимать пул соединений,
// на котором работают сохранения и очки.

import { ping } from '@gf/db';
import { hubDb } from '@/lib/db.ts';

export const dynamic = 'force-dynamic';

const TTL_MS = 5000;
let last: { at: number; ok: boolean } | null = null;

async function check(): Promise<boolean> {
  try {
    const db = hubDb();
    if (!db) {
      console.error('healthz: база не настроена (нет GF_DATABASE_URL / GF_DB_HOST)');
      return false;
    }
    if (await ping(db)) return true;
    console.error('healthz: база не отвечает');
    return false;
  } catch (e) {
    console.error('healthz: ошибка настройки базы:', e instanceof Error ? e.message : e);
    return false;
  }
}

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (!last || now - last.at >= TTL_MS) last = { at: now, ok: await check() };
  return last.ok ? new Response('ok\n') : new Response('unavailable\n', { status: 503 });
}
