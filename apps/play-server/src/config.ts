import { ID_RE } from '../../../packages/manifest/src/index.ts';

export interface PlayConfig {
  /** Базовый хост: игра живёт на <id>.<baseHost>, служебное — на самом baseHost. */
  baseHost: string;
  port: number;
  host: string;
  /** Кому разрешено встраивать игры (CSP frame-ancestors). */
  hubOrigins: string[];
  dataDir: string;
}

function parseOrigin(o: string): string {
  const u = new URL(o);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`GF_HUB_ORIGINS: "${o}" — только http(s)`);
  return u.origin;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): PlayConfig {
  const baseHost = (env.GF_PLAY_BASE_HOST ?? 'play.localhost').toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(baseHost)) throw new Error(`GF_PLAY_BASE_HOST: "${baseHost}" — не похоже на имя хоста`);
  const port = Number(env.GF_PLAY_PORT ?? 4100);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`GF_PLAY_PORT: "${env.GF_PLAY_PORT}"`);
  const hubOrigins = (env.GF_HUB_ORIGINS ?? 'http://localhost:3000 http://hub.localhost:3000')
    .split(/\s+/)
    .filter(Boolean)
    .map(parseOrigin);
  return {
    baseHost,
    port,
    host: env.GF_PLAY_HOST ?? '127.0.0.1',
    hubOrigins,
    dataDir: env.GF_DATA_DIR ?? '.data',
  };
}

/** Разбор заголовка Host: id игры, служебный хост или чужой. */
export function classifyHost(hostHeader: string | undefined, baseHost: string):
  | { kind: 'game'; id: string }
  | { kind: 'root' }
  | { kind: 'unknown' } {
  if (!hostHeader) return { kind: 'unknown' };
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '');
  if (host === baseHost) return { kind: 'root' };
  const suffix = `.${baseHost}`;
  if (!host.endsWith(suffix)) return { kind: 'unknown' };
  const id = host.slice(0, -suffix.length);
  if (!ID_RE.test(id)) return { kind: 'unknown' };
  return { kind: 'game', id };
}
