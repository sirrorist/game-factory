import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createAuthMiddleware } from '../../../apps/hub/node_modules/better-auth/dist/api/index.mjs';
import type { BetterAuthPlugin } from '../../../apps/hub/node_modules/better-auth/dist/index.mjs';

const origin = 'https://hub.example';

export function barrier() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  return { entered, release, pause: async () => {
    enter(); await resume;
  } };
}

export function cookies(response: Response) {
  return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

// Подмена только точки ожидания: проверку пароля и запись выполняет настоящая библиотека.
export function pausePassword(path: string, gate: ReturnType<typeof barrier>): BetterAuthPlugin {
  return { id: 'test-pause-password', hooks: { before: [{ matcher: (ctx) => ctx.path === path,
    handler: createAuthMiddleware(async (ctx) => {
      const original = ctx.context.password;
      ctx.context.password = { ...original, verify: async (input) => {
        await gate.pause(); return original.verify(input);
      } };
    }),
  }] } };
}

// Минимальный тестовый аутентификатор: настоящий P-256/COSE, подпись и WebAuthn-ответы.
export function authenticator() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x!, 'base64url'),
    Buffer.from('225820', 'hex'), Buffer.from(jwk.y!, 'base64url')]);
  const id = randomBytes(32);
  const rpHash = createHash('sha256').update(new URL(origin).hostname).digest();
  function clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }
  return { id: id.toString('base64url'), publicKey,
    authentication(challenge: string) {
      const data = clientData('webauthn.get', challenge);
      const authData = Buffer.concat([rpHash, Buffer.from([5, 0, 0, 0, 1])]);
      const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(data).digest()]), pair.privateKey);
      return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key',
        clientExtensionResults: {}, response: { clientDataJSON: data.toString('base64url'),
          authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url') } };
    },
    registration(challenge: string) {
      const authData = Buffer.concat([rpHash, Buffer.from([0x45, 0, 0, 0, 0]), Buffer.alloc(16), Buffer.from([0, id.length]), id, publicKey]);
      // CBOR map {fmt:'none', attStmt:{}, authData:bytes}; длина authData < 256.
      const attestation = Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746158', 'hex'),
        Buffer.from([authData.length]), authData]);
      return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key',
        clientExtensionResults: {}, response: { clientDataJSON: clientData('webauthn.create', challenge).toString('base64url'),
          attestationObject: attestation.toString('base64url'), transports: ['internal'] } };
    },
  };
}

// Инструментируем и adapter внутри transaction callback, сохраняя настоящую запись.
export function pauseAdapter(path: string, operation: 'findOne' | 'create', gate: ReturnType<typeof barrier>,
  observed?: (insideTransaction: boolean) => void): BetterAuthPlugin {
  function wrap<T extends object>(adapter: T, insideTransaction = false): T {
    return new Proxy(adapter, { get(target, key) {
      const value = Reflect.get(target, key);
      if (key === 'transaction' && typeof value === 'function') {
        return (fn: (tx: object) => Promise<unknown>) => Reflect.apply(value, target,
          [(tx: object) => fn(wrap(tx, true))]);
      }
      if (key !== operation || typeof value !== 'function') return typeof value === 'function' ? value.bind(target) : value;
      return async (args: { model: string }) => {
        if (operation === 'create' && args.model === 'passkey') {
          observed?.(insideTransaction); await gate.pause();
        }
        const result = await Reflect.apply(value, target, [args]);
        if (operation === 'findOne' && args.model === 'passkey') {
          observed?.(insideTransaction); await gate.pause();
        }
        return result;
      };
    } });
  }
  return { id: `test-pause-${path}`, init(ctx) { return { context: { adapter: wrap(ctx.adapter) } }; } };
}
