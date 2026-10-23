import { createProfiles, profileFingerprint, type RelayConfig } from '../src/config.ts';
import { createRelayServer } from '../src/server.ts';
import { parseMailRequest } from '../src/protocol.ts';
import type { Exchange, WireReply } from '../src/io.ts';

export const ORIGIN = 'https://hub.example.com';
export const SECRET = 'synthetic-service-secret-012345678901234567890';
export const API_KEY = 're_synthetic_api_key_012345678901234567890';
export const TOKEN = 'synthetic.token_0123456789';
export const OPERATION = '8a021d1a-22e9-4fdd-b68c-c20bbc64e9c2';
export const PROVIDER_ID = 'a8b994c5-203d-44b4-ae09-2c9737012c37';
export const profiles = createProfiles(ORIGIN, 'noreply@auth.example.com');
export const config: RelayConfig = Object.freeze({
  profiles, profilePin: profileFingerprint(profiles), hubOrigin: ORIGIN, serviceSecret: SECRET, apiKey: API_KEY,
});
export const input = Object.freeze({
  kind: 'reset-password.v1', to: 'player@example.com',
  url: ORIGIN + '/account/reset-password?token=' + TOKEN, operationId: OPERATION,
});
export const mail = parseMailRequest(JSON.stringify(input), ORIGIN);
export function reply(status = 200, name?: string, retry?: string): WireReply {
  return { status, headers: { 'retry-after': retry }, body: JSON.stringify(name ? { name, message: TOKEN + API_KEY } : { id: PROVIDER_ID }) };
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
export async function startRelay(options: NonNullable<Parameters<typeof createRelayServer>[1]> = {}) {
  const exchange: Exchange = options.exchange ?? (async () => reply());
  const server = createRelayServer(config, { ...options, exchange });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('нет тестового адреса');
  return {
    server, port: address.port, endpoint: 'http://127.0.0.1:' + address.port + '/v1/send',
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
