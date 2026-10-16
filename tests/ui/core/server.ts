import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { extname, relative, resolve, sep, join } from 'node:path';
import { UI } from './paths.ts';
import type { Comparison, Snapshot } from './types.ts';
import { treeHash } from './evidence.ts';

export function assertDevelopment(): void {
  if (process.env.NODE_ENV === 'production') throw new Error('UI-сравнение — только dev: запуск с NODE_ENV=production запрещён');
}

export function servedFile(directory: string, pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(p => p.startsWith('.'))) return null;
  try {
    const root = realpathSync(directory);
    const file = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
    if (!file.startsWith(root + sep) || !existsSync(file)) return null;
    const actual = realpathSync(file);
    return actual.startsWith(root + sep) && !relative(root, actual).split(sep).some(p => p.startsWith('.')) && statSync(actual).isFile() ? actual : null;
  } catch { return null; }
}

async function listen(directory: string, port: number, transform?: Comparison['transformHtml'], viewer?: { html: () => string; config: () => unknown }) {
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); }
    catch { res.writeHead(400).end(); return; }
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (viewer && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/config.json')) {
      try {
        const json = url.pathname === '/config.json';
        const body = json ? JSON.stringify(viewer.config()) : viewer.html();
        res.writeHead(200, { 'Content-Type': mime[json ? '.json' : '.html']!, 'Cache-Control': 'no-store' }).end(req.method === 'HEAD' ? undefined : body);
      } catch { res.writeHead(503).end('Артефакты сравнения обновляются'); }
      return;
    }
    const file = servedFile(directory, url.pathname);
    if (!file) { res.writeHead(404).end(); return; }
    try {
      let body: string | Buffer = readFileSync(file);
      if (extname(file) === '.html' && transform) body = transform(body.toString(), url);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500).end('Не удалось прочитать артефакт'); }
  });
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

export async function startComparison(target: Comparison, port = 0) {
  assertDevelopment();
  const running: Awaited<ReturnType<typeof listen>>[] = [];
  const close = async () => { await Promise.all(running.map(s => new Promise<void>(accept => s.server.close(() => accept())))); };
  try {
    const before = await listen(target.beforeDirectory ?? join(target.out, 'before'), 0, target.transformHtml); running.push(before);
    const after = await listen(target.afterDirectory ?? join(target.out, 'after'), 0, target.transformHtml); running.push(after);
    let revision: Awaited<ReturnType<typeof listen>> | undefined;
    if (existsSync(join(target.out, 'revision-before', 'snapshot.json'))) {
      revision = await listen(join(target.out, 'revision-before'), 0, target.transformHtml); running.push(revision);
    }
    // Каталоги заменяются работающим CLI. Конфигурация должна читать их заново,
    // иначе новый after получает успешный статус предыдущего прогона.
    const readSnapshot = (directory: string, fallback?: Snapshot) => {
        const file = join(directory, 'snapshot.json');
        const snapshot = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Snapshot : fallback;
        if (!snapshot) throw new Error('Снимок ещё не готов: ' + directory);
        let artifactHash: string | null = null;
        try { artifactHash = treeHash(directory); } catch { /* Актуальность отчёта отдельно проверяется validateReport. */ }
        return { ...snapshot, artifactHash };
    };
    const config = () => {
      const snapshots = Object.fromEntries(['before', 'after'].map(side => {
        const directory = side === 'before' ? target.beforeDirectory : target.afterDirectory;
        return [side, readSnapshot(directory ?? join(target.out, side), target.snapshots?.[side])];
      }));
      const reportPath = join(target.out, 'report.json');
      let report: { status?: string; complete?: boolean; failed?: number | null } | null = null;
      try { if (existsSync(reportPath)) report = JSON.parse(readFileSync(reportPath, 'utf8')); }
      catch { /* Во время записи неполный отчёт не подтверждает сборку. */ }
      if (report?.status === 'finished' && target.validateReport && !target.validateReport(report)) report = { status: 'stale', complete: false, failed: null };
      return { id: target.id, title: target.title, profiles: target.profiles, scenes: target.scenes, after: after.url, report, snapshots,
      liveLabel: target.liveLabel ?? 'Играть', description: target.description,
      themes: target.themes, shotPath: target.shotPath ?? 'shots/{side}/{profile}/{scene}.png', hasDiff: target.hasDiff ?? true,
      references: [{ id: 'before', label: `Исходная ${snapshots.before!.version}`, url: before.url, snapshot: snapshots.before, shots: 'shots/before' },
        ...(revision ? [{ id: 'revision', label: 'Сохранённая промежуточная', url: revision.url, snapshot: readSnapshot(join(target.out, 'revision-before')), shots: 'revision-shots' }] : [])] };
    };
    const html = () => readFileSync(join(UI, 'compare.html'), 'utf8').replace('/*CONFIG*/null', JSON.stringify(config()).replaceAll('<', '\\u003c'));
    writeFileSync(join(target.out, 'index.html'), html());
    const viewer = await listen(target.out, port, undefined, { html, config }); running.push(viewer);
    return { before: before.url, after: after.url, url: viewer.url, close };
  } catch (error) { await close(); throw error; }
}
