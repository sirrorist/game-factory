import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function authMailKeys(keys: readonly Buffer[]) {
  if (!keys.length || keys.some(k => k.length !== 32)) throw new Error('нужен отдельный ключ почты из 32 байт');
  const ring = new Map(keys.map(k => [createHash('sha256').update(k).digest('hex').slice(0, 16), Buffer.from(k)]));
  const currentId = [...ring.keys()][0]!;
  const active = ring.get(currentId)!;
  const counterKey = Buffer.from(keys.at(-1)!);
  return Object.freeze({
    currentId,
    seal(value: unknown, context: string, keyId = currentId): string {
      const key = ring.get(keyId); if (!key) throw new Error('ключ почты недоступен');
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(`${keyId}:${context}`));
      return Buffer.concat([nonce,
        cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
    },
    open(value: string, keyId: string, context: string): unknown {
      const key = ring.get(keyId); if (!key || value.length > 32_768) throw new Error('снимок письма недоступен');
      const raw = Buffer.from(value, 'base64url'); if (raw.length < 29) throw new Error('снимок письма недоступен');
      const cipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      cipher.setAAD(Buffer.from(`${keyId}:${context}`)); cipher.setAuthTag(raw.subarray(-16));
      return JSON.parse(Buffer.concat([cipher.update(raw.subarray(12, -16)), cipher.final()]).toString('utf8')) as unknown;
    },
    digest(scope: string, value: string) { return createHmac('sha256', counterKey).update(`${scope}\0${value}`).digest('hex'); },
    intent(now = Date.now()) {
      const body = `${randomUUID()}.${now}`;
      return `${body}.${createHmac('sha256', active).update(`intent:${body}`).digest('hex')}`;
    },
    validIntent(value: string, now = Date.now()) {
      const match = /^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[0-9]{13})\.([a-f0-9]{64})$/.exec(value);
      if (!match) return false;
      const createdAt = Number(match[1]!.split('.')[1]);
      if (now < createdAt || now - createdAt >= 86_400_000) return false;
      return [...ring.values()].some(key => timingSafeEqual(createHmac('sha256', key).update(`intent:${match[1]}`).digest(), Buffer.from(match[2]!, 'hex')));
    },
    browser(value?: string): { id: string; cookie: string } {
      const [id = '', signature = '', extra] = value?.split('.') ?? [];
      if (!extra && /^[a-f0-9]{32}$/.test(id) && /^[a-f0-9]{64}$/.test(signature)) {
        for (const key of ring.values()) {
          const expected = createHmac('sha256', key).update(`browser:${id}`).digest();
          if (timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return { id, cookie: value! };
        }
      }
      const fresh = randomBytes(16).toString('hex');
      return { id: fresh, cookie: `${fresh}.${createHmac('sha256', active).update(`browser:${fresh}`).digest('hex')}` };
    },
  });
}
export function authMailKeysFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!env.GF_AUTH_MAIL_KEY_FILE) throw new Error('не настроен файл ключа почты');
  const files = [env.GF_AUTH_MAIL_KEY_FILE, ...(env.GF_AUTH_MAIL_OLD_KEY_FILES?.split(':').filter(Boolean) ?? [])];
  // Ротация требует сохранения старых ключей на срок активных намерений; fallback отсутствует.
  if (files.length > 4) throw new Error('слишком много ключей почты');
  return authMailKeys(files.map(file => readFileSync(file)));
}
export type AuthMailKeys = ReturnType<typeof authMailKeys>;
