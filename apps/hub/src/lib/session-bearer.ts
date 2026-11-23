import { timingSafeEqual } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';

export const SESSION_COOKIE = '__Host-gf-session';
/** Проверяется именно cookie запроса, не token из результата запроса к БД. */
export async function verifiedSessionBearer(headers: Headers, secret: string): Promise<string | null> {
  const values=(headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+'='));
  if(values.length!==1)return null;
  let value:string;
  try {value=decodeURIComponent(values[0]!.slice(SESSION_COOKIE.length+1));}catch{return null;}
  if(value.length>512)return null;
  const dot=value.lastIndexOf('.'),token=value.slice(0,dot),signature=value.slice(dot+1);
  if(dot<0 || !/^[A-Za-z0-9_-]{32,256}$/.test(token))return null;
  const expected=Buffer.from(await makeSignature(token,secret)),actual=Buffer.from(signature);
  return actual.length===expected.length&&timingSafeEqual(actual,expected)?token:null;
}
export async function signedSessionCookie(token: string, secret: string): Promise<string> {
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw new Error('неверный формат сессии');
  return `${SESSION_COOKIE}=${encodeURIComponent(token+'.'+await makeSignature(token,secret))}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800`;
}
