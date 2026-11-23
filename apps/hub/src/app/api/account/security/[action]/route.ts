// Вход с вторым фактором, настройка TOTP, backup-коды и восстановление (B, D-066, D-071).
// CSRF, белый список действий и лимиты - в lib/auth-factor-http.ts; proxy.ts тоже проверяет CSRF.
import { handleFactorAction } from '@/lib/auth-factor-runtime.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  return handleFactorAction(req, (await ctx.params).action);
}
