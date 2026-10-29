import { handleAuthAction } from '@/lib/auth-actions-runtime.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export function POST(req: Request) { return handleAuthAction(req, 'reset', 'consume'); }
