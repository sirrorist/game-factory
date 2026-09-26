// Сервер игр: отдаёт опубликованные версии по поддоменам <id>.<baseHost>.
//
// Это «грязная» сторона: здесь живёт чужой код, поэтому сервер ничего не знает
// о пользователях хаба, не держит секретов и отдаёт только то, что есть в реестре.
// Все защитные заголовки описаны в docs/SECURITY.md — правь их там и здесь вместе.

import { createHash } from 'node:crypto';
import { createReadStream, lstatSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { isSafeRelativePath } from '../../../packages/manifest/src/index.ts';
import { contentTag, createRegistryReader, dataPaths, type RegistryEntry } from '../../../packages/registry/src/index.ts';
import { classifyHost, type PlayConfig } from './config.ts';
import { mimeFor } from './mime.ts';

const PERMISSIONS_POLICY = [
  'camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()', 'serial=()',
  'hid=()', 'bluetooth=()', 'midi=()', 'display-capture=()', 'publickey-credentials-get=()',
  'clipboard-read=()', 'fullscreen=(self)', 'gamepad=(self)', 'autoplay=(self)',
].join(', ');

export function gameCsp(hubOrigins: string[]): string {
  return [
    "default-src 'self'",
    // unsafe-inline: офлайн-сборки кладут скрипт внутрь HTML. Цена приемлема,
    // потому что у каждой игры свой origin — XSS в игре не выходит за её пределы.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${hubOrigins.join(' ')}`,
  ].join('; ');
}

// Служебный хост отдаёт только архивы и обложки. sandbox глушит скрипты в SVG,
// если обложку откроют напрямую.
const ROOT_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/** Путь запроса → относительный путь файла, либо null для всего подозрительного. */
export function requestPath(rawUrl: string | undefined): string | null {
  if (!rawUrl || !rawUrl.startsWith('/')) return null;
  const raw = rawUrl.split('?')[0]!.split('#')[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded === '/') return '';
  const rel = decoded.slice(1);
  return isSafeRelativePath(rel) ? rel : null;
}

function safeFile(root: string, rel: string): string | null {
  const full = resolve(join(root, ...rel.split('/')));
  if (!full.startsWith(resolve(root) + sep)) return null;
  try {
    const st = lstatSync(full);
    return st.isFile() && !st.isSymbolicLink() ? full : null;
  } catch {
    return null;
  }
}

function streamFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  headers: Record<string, string>,
): void {
  // 304 - для всего, что отдаётся с ETag: файлов игр, обложек и архивов.
  if (headers.ETag && req.headers['if-none-match'] === headers.ETag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const size = lstatSync(file).size;
  res.writeHead(200, { ...headers, 'Content-Length': String(size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

export function createPlayServer(config: PlayConfig): Server {
  const paths = dataPaths(config.dataDir);
  const registry = createRegistryReader(paths);
  const csp = gameCsp(config.hubOrigins);

  const findGame = (id: string): RegistryEntry | undefined => registry().games.find((g) => g.id === id);

  function serveGame(req: IncomingMessage, res: ServerResponse, id: string): void {
    const entry = findGame(id);
    if (!entry) return send(res, 404, 'игра не найдена');

    // Service Worker пережил бы смену и даже снятие версии и продолжал бы отдавать
    // старое содержимое с origin игры. На этапе 0 игры без SW, поэтому запрещаем.
    if (req.headers['service-worker'] === 'script') return send(res, 403, 'service worker запрещён');

    const rel = requestPath(req.url);
    if (rel === null) return send(res, 404, 'не найдено');
    const target = rel === '' ? entry.manifest.entry : rel;

    const mime = mimeFor(target);
    if (!mime) return send(res, 403, 'тип файла не разрешён');
    const file = safeFile(paths.versionDir(entry.id, entry.version), target);
    if (!file) return send(res, 404, 'не найдено');

    streamFile(req, res, file, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      ETag: `"${contentTag(entry)}-${createHash('sha1').update(target).digest('hex').slice(0, 8)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': PERMISSIONS_POLICY,
      'Content-Security-Policy': csp,
      'X-GF-Game': `${entry.id}@${entry.version}`,
    });
  }

  function serveRoot(req: IncomingMessage, res: ServerResponse): void {
    const base = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': ROOT_CSP,
    };
    const rel = requestPath(req.url);
    if (rel === 'healthz') return send(res, 200, 'ok', base);

    const exportMatch = rel?.match(/^exports\/([a-z0-9-]+-[0-9A-Za-z.-]+\.zip)$/);
    if (exportMatch) {
      const name = exportMatch[1]!;
      const entry = registry().games.find((g) => g.export?.file === name);
      if (!entry || !entry.export) return send(res, 404, 'архив не найден', base);
      const file = safeFile(paths.exportsDir, name);
      if (!file) return send(res, 404, 'архив не найден', base);
      return streamFile(req, res, file, {
        ...base,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-cache',
        ETag: `"${entry.export.sha256.slice(0, 32)}"`,
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
    }

    const coverMatch = rel?.match(/^covers\/([a-z0-9-]+)$/);
    if (coverMatch) {
      const entry = findGame(coverMatch[1]!);
      const cover = entry?.manifest.cover;
      if (!entry || !cover) return send(res, 404, 'обложки нет', base);
      const mime = mimeFor(cover);
      const file = safeFile(paths.versionDir(entry.id, entry.version), cover);
      if (!file || !mime?.startsWith('image/')) return send(res, 404, 'обложки нет', base);
      // Хаб просит обложку с ?v=<version>: версия неизменяема, значит и адрес с ней
      // навсегда значит одни и те же байты - браузер может не спрашивать год.
      // Без версии или со старой (хаб ещё не видел новый реестр) - только с проверкой,
      // иначе под старым адресом надолго застрянет чужое содержимое.
      const v = new URL(req.url ?? '/', 'http://x').searchParams.get('v');
      // Обложку показывает хаб с другого origin - отсюда cross-origin.
      return streamFile(req, res, file, {
        ...base,
        'Content-Type': mime,
        'Cache-Control': v === entry.version ? 'public, max-age=31536000, immutable' : 'no-cache',
        ETag: `"${contentTag(entry)}-cover"`,
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
    }

    return send(res, 404, 'не найдено', base);
  }

  return createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'только GET и HEAD', { Allow: 'GET, HEAD' });
    }
    const host = classifyHost(req.headers.host, config.baseHost);
    switch (host.kind) {
      case 'game':
        return serveGame(req, res, host.id);
      case 'root':
        return serveRoot(req, res);
      default:
        return send(res, 404, 'неизвестный хост');
    }
  });
}
