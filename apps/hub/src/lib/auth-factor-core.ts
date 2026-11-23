// Контроллер не принимает userId/verifiedAt/UV из HTTP. Исходные снимки берутся
// до crypto, затем процедуры сравнивают их под SQL-блокировками.
import { randomUUID } from 'node:crypto';
import { verifyPassword, hashPassword } from 'better-auth/crypto';
import { BACKUP_WARNING, FACTOR_POLICY, MIN_PASSWORD_LENGTH, backupCodes, backupHash, bearerHash,
  randomBearer, totpSecret, validBackup, validBearer, verifyTotp,
  type FactorKeys, type FactorStore, type UvSnapshot } from '@gf/db';

export const FACTOR_CONTEXT_COOKIE = '__Host-gf-factor-context';
export const FACTOR_ENROL_COOKIE = '__Host-gf-factor-enrol';
export const FACTOR_REAUTH_COOKIE = '__Host-gf-factor-reauth';
export type OriginalSession = { id: string; bearer: string };
const newSession = () => ({ id: randomUUID(), token: randomBearer(), issuance: randomUUID() });
// Хэш-приманка для неизвестного email: тот же алгоритм, что у настоящих паролей. Лениво -
// чтобы импорт модуля (и сборка Next) не считал scrypt.
let decoy: Promise<string> | undefined;
const decoyHash = () => decoy ??= hashPassword(randomBearer());

export function factorController(store: FactorStore, keys: FactorKeys) {
  async function reserved(cookie: string, source: string) {
    if (!validBearer(cookie)) return null;
    const hash = bearerHash(cookie), attempt = bearerHash(randomBearer());
    const reservation = await store.reserve(hash, bearerHash(source), attempt);
    return reservation ? { hash, attempt, reservation } : null;
  }
  return Object.freeze({ store,
    async password(email: string, password: string, source: string, original: OriginalSession | null = null) {
      if (email.length > 254 || password.length > 1024) return null;
      const snapshot = await store.snapshot(email.trim().toLowerCase(), null);
      // Без учётки scrypt всё равно считается: иначе по времени ответа видно, какой email существует.
      if (!snapshot?.account?.password) { await verifyPassword({ hash: await decoyHash(), password }); return null; }
      if (!await verifyPassword({ hash: snapshot.account.password, password })) return null;
      if (original && (await store.access(original.id,original.bearer))?.userId !== snapshot.user.id) return { kind: 'denied' as const };
      const cookie = randomBearer(), hash = bearerHash(cookie);
      const purpose = original ? snapshot.required ? 'reauth' : 'password' : 'login';
      if (!await store.passwordContext(snapshot,hash,purpose,original,bearerHash(source))) return { kind: 'denied' as const };
      if (snapshot.required) return { kind: 'totp' as const, cookie };
      const session = await store.passwordLogin(hash,newSession());
      return session ? { kind: 'session' as const, session } : { kind: 'denied' as const };
    },
    async totp(cookie: string, code: string, source: string) {
      const grant = await reserved(cookie,source); if (!grant) return null;
      if (!['login','reauth'].includes(grant.reservation.purpose)) return null;
      const snapshot = await store.snapshot(null,grant.hash);
      if (!snapshot?.factor || snapshot.factor.state !== 'active') return null;
      const f = snapshot.factor;
      const secret = keys.open({ keyId: f.key_id, ciphertext: f.ciphertext },snapshot.user.id,f.id);
      const step = verifyTotp(secret,code); if (step === null) return null;
      return store.totpLogin(grant.hash,grant.attempt,f,step,newSession());
    },
    async setup(original: OriginalSession) {
      const cookie = randomBearer();
      return await store.setup(original,bearerHash(cookie)) ? cookie : null;
    },
    async exchange(token: string) {
      if (!validBearer(token)) return null;
      const cookie = randomBearer();
      return await store.exchange(bearerHash(token),bearerHash(cookie)) ? cookie : null;
    },
    async pending(cookie: string) {
      if (!validBearer(cookie)) return null;
      const hash = bearerHash(cookie), snapshot = await store.snapshot(null,hash);
      if (!snapshot?.context || !['setup','enrol-cookie'].includes(snapshot.context.purpose)) return null;
      const id = randomUUID(), secret = totpSecret();
      const encrypted = keys.seal(secret,snapshot.user.id,id);
      return await store.pending(hash,id,encrypted) ? { secret } : null;
    },
    async complete(cookie: string, code: string, source: string, password?: string) {
      if (password !== undefined && (password.length < MIN_PASSWORD_LENGTH || password.length > 1024)) return null;
      const grant = await reserved(cookie,source); if (!grant) return null;
      if (!['setup','enrol-cookie'].includes(grant.reservation.purpose)) return null;
      // Новый пароль - только при enrolment после exchange/recover, где старого пароля нет.
      // В setup его принять нельзя: свежая сессия без старого пароля захватила бы учётку.
      if (password !== undefined && grant.reservation.purpose !== 'enrol-cookie') return null;
      const snapshot = await store.snapshot(null,grant.hash);
      if (!snapshot?.factor || snapshot.factor.state !== 'pending') return null;
      const f = snapshot.factor, secret = keys.open({ keyId: f.key_id, ciphertext: f.ciphertext },snapshot.user.id,f.id);
      const step = verifyTotp(secret,code); if (step === null) return null;
      const passwordHash = password === undefined ? null : await hashPassword(password);
      const codes = backupCodes(snapshot.user.id);
      return await store.complete(grant.hash,grant.attempt,f,step,codes.hashes,randomUUID(),passwordHash)
        ? { codes: codes.codes, warning: BACKUP_WARNING } : null;
    },
    async backupContext(source: string) {
      const cookie = randomBearer();
      return await store.backupContext(bearerHash(cookie),bearerHash(source)) ? cookie : null;
    },
    async recover(cookie: string, email: string, code: string, source: string) {
      if (!validBackup(code) || email.length > 254) return null;
      const grant = await reserved(cookie,source); if (!grant || grant.reservation.purpose !== 'backup') return null;
      const snapshot = await store.snapshot(email.trim().toLowerCase(),null); if (!snapshot) return null;
      const enrol = randomBearer(), exchanged = randomBearer();
      if (!await store.recover(grant.hash,grant.attempt,snapshot.user.id,backupHash(snapshot.user.id,code),bearerHash(enrol))) return null;
      return await store.exchange(bearerHash(enrol),bearerHash(exchanged)) ? exchanged : null;
    },
    async changePassword(original: OriginalSession, email: string, password: string, nextPassword: string) {
      if (nextPassword.length < MIN_PASSWORD_LENGTH || nextPassword.length > 1024 || password.length > 1024) return false;
      const snapshot = await store.snapshot(email,null);
      if (!snapshot?.account?.password || (await store.access(original.id,original.bearer))?.userId !== snapshot.user.id
        || !await verifyPassword({hash:snapshot.account.password,password})) return false;
      return store.passwordChange(original,{id:snapshot.account.id,password:snapshot.account.password},await hashPassword(nextPassword));
    },
    async rotate(original: OriginalSession) {
      const access=await store.access(original.id,original.bearer); if (!access) return null;
      const codes=backupCodes(access.userId);
      return await store.rotate(original,codes.hashes,randomUUID()) ? {codes:codes.codes,warning:BACKUP_WARNING} : null;
    },
    async uvContext(original: OriginalSession) {
      const cookie=randomBearer();return await store.uvContext(original,bearerHash(cookie)) ? cookie : null;
    },
    async uvFinish(snapshot: UvSnapshot, counter: number, contextCookie: string | null) {
      if (contextCookie !== null && !validBearer(contextCookie)) return null;
      const codes=backupCodes(snapshot.userId);
      const result=await store.uvFinish(snapshot,counter,contextCookie===null?null:bearerHash(contextCookie),newSession(),codes.hashes,randomUUID());
      if (!result) return null;
      return 'enrolled' in result ? {kind:'enrolled' as const,codes:codes.codes,warning:BACKUP_WARNING}
        : {kind:'session' as const,session:result};
    },
    policy: FACTOR_POLICY,
  });
}
export type FactorController = ReturnType<typeof factorController>;
