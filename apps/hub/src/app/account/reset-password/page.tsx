import { authMailKeysFromEnv } from '@gf/db';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AuthActionForm } from '../auth-action-form.tsx';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Восстановление доступа', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.GF_AUTH_ACTIONS_ENABLED !== 'closed-test') notFound();
  const params = await searchParams;
  const token = params.token;
  if (Object.keys(params).some(key => key !== 'token') || (token !== undefined && (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)))) notFound();
  const initialIntent = token === undefined ? authMailKeysFromEnv().intent() : undefined;
  // GET/preview не проверяет и не потребляет bearer; нужен явный submit.
  return <section className="gf-account-page"><h1>Восстановление доступа</h1><AuthActionForm purpose="reset" token={token} initialIntent={initialIntent} /></section>;
}
