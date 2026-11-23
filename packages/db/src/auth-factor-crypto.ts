// Bearer и backup нельзя восстановить из БД. TOTP, напротив, нужен verifier,
// поэтому шифруется отдельным ключом с привязкой к пользователю и фактору.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FACTOR_POLICY = Object.freeze({ stepMs: 30_000, digits: 6, window: 1,
  contextMs: 300_000, pendingMs: 600_000, freshMs: 300_000, backupCount: 10 });
export const BACKUP_WARNING = 'Коды показываются только один раз. Сохраните их офлайн: например, запишите на бумаге и уберите в безопасное место. Каждый код даёт возможность восстановить доступ к аккаунту. Не передавайте его другим людям.';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomBearer(): string { return randomBytes(32).toString('base64url'); }
export function validBearer(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}
export function bearerHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function backupHash(userId: string, code: string): string {
  return createHash('sha256').update(`gf-backup-v1\0${userId}\0${code}`).digest('hex');
}
export function backupCodes(userId: string) {
  const codes = Array.from({ length: FACTOR_POLICY.backupCount }, () => randomBytes(16).toString('base64url'));
  return { codes, hashes: codes.map(code => backupHash(userId, code)) };
}
export function validBackup(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value)
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}
export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; text += ALPHABET[(value >>> bits) & 31]; }
  }
  if (bits) text += ALPHABET[(value << (5 - bits)) & 31];
  return text;
}
export function totpSecret(): string { return base32(randomBytes(20)); }
function secretBytes(secret: string): Buffer {
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('неверный формат секрета фактора');
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | ALPHABET.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
/** RFC 6238/4226; digits=8 используется только официальными тестовыми векторами. */
export function totpCode(secret: string, step: number, digits = 6): string {
  if (!Number.isSafeInteger(step) || step < 0 || ![6, 8].includes(digits)) throw new Error('неверный шаг фактора');
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secretBytes(secret)).update(counter).digest();
  const offset = mac.at(-1)! & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code) || !Number.isSafeInteger(now) || now < 0) return null;
  const current = Math.floor(now / FACTOR_POLICY.stepMs);
  let matched: number | null = null;
  for (let step = Math.max(0, current - FACTOR_POLICY.window); step <= current + FACTOR_POLICY.window; step++) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) matched = step;
  }
  return matched;
}

export function factorKeys(keys: readonly Buffer[]) {
  if (!keys.length || keys.length > 4 || keys.some(key => key.length !== 32)) throw new Error('нужен отдельный 32-байтный ключ факторов');
  const ring = new Map(keys.map(key => [bearerHash(key.toString('base64url')).slice(0, 16), Buffer.from(key)]));
  const keyId = [...ring.keys()][0]!;
  function aad(userId: string, factorId: string, id: string) {
    return Buffer.from(JSON.stringify(['gf-factor-v1', userId, factorId, id]));
  }
  return Object.freeze({ keyId,
    seal(secret: string, userId: string, factorId: string) {
      secretBytes(secret);
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', ring.get(keyId)!, nonce);
      cipher.setAAD(aad(userId, factorId, keyId));
      return { keyId, ciphertext: Buffer.concat([nonce, cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url') };
    },
    open(value: { keyId: string; ciphertext: string }, userId: string, factorId: string): string {
      const key = ring.get(value.keyId);
      if (!key || value.ciphertext.length > 256) throw new Error('секрет фактора недоступен');
      const raw = Buffer.from(value.ciphertext, 'base64url');
      if (raw.length < 29) throw new Error('секрет фактора недоступен');
      const cipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      cipher.setAAD(aad(userId, factorId, value.keyId)); cipher.setAuthTag(raw.subarray(-16));
      const secret = Buffer.concat([cipher.update(raw.subarray(12, -16)), cipher.final()]).toString('utf8');
      secretBytes(secret); return secret;
    },
  });
}
export type FactorKeys = ReturnType<typeof factorKeys>;
export function factorKeysFromEnv(env: NodeJS.ProcessEnv = process.env): FactorKeys {
  const file = env.GF_AUTH_FACTOR_KEY_FILE;
  if (!file) throw new Error('не задан файл отдельного ключа факторов');
  const files = [file, ...(env.GF_AUTH_FACTOR_OLD_KEY_FILES?.split(':').filter(Boolean) ?? [])];
  if (files.length > 4 || files.some(name => [env.GF_AUTH_MAIL_KEY_FILE, env.GF_AUTH_SECRET_FILE].includes(name))) {
    throw new Error('ключи факторов должны быть отдельными');
  }
  return factorKeys(files.map(name => readFileSync(name)));
}
