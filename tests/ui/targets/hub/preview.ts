// Изолированные UI-примеры: реальные компоненты, без настоящего входа/API.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, outputFor } from '../../core/paths.ts';
import { ensureNewBaseline, publishSnapshot } from '../../core/snapshot.ts';
import { startComparison } from '../../core/server.ts';
import { snapshotEvidence, toolHash as hashTool } from '../../core/evidence.ts';
import { PROFILES } from '../../core/profiles.ts';
import { HUB_SCENES as SCENES } from './config.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const HUB = join(ROOT, 'apps/hub');
export const OUT = outputFor('hub');
const require = createRequire(join(HUB, 'package.json'));
const viteRequire = createRequire(join(ROOT, 'packages/vite-config/package.json'));
const { build } = await import(pathToFileURL(join(dirname(viteRequire.resolve('vite/package.json')), 'dist/node/index.js')).href) as { build: (options: Record<string, unknown>) => Promise<unknown> };
const tailwind = require('@tailwindcss/postcss');
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

async function captureBaseline(ref: string): Promise<void> {
  ensureNewBaseline(join(OUT, 'before'));
  ensureNewBaseline(join(OUT, 'before-source'));
  if (ref.startsWith('-')) throw new Error('Некорректный git ref');
  const revision = git('rev-parse', '--verify', `${ref}^{commit}`).trim();
  mkdirSync(OUT, { recursive: true });
  const temporary = mkdtempSync(join(OUT, 'source-'));
  const archive = execFileSync('git', ['archive', revision, 'apps/hub'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
  cpSync(join(temporary, 'apps/hub'), join(OUT, 'before-source'), { recursive: true });
  writeFileSync(join(OUT, 'baseline-ref.txt'), revision);
}

function uiFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? uiFiles(path) : /\.(tsx|css)$/.test(path) ? [path] : [];
  });
}

export async function buildSnapshot(side: 'before' | 'after', ref?: string): Promise<void> {
  if (side === 'before') await captureBaseline(ref ?? 'HEAD');
  const source = side === 'before' ? join(OUT, 'before-source') : HUB;
  mkdirSync(OUT, { recursive: true });
  const stage = mkdtempSync(join(OUT, `render-${side}-`));
  const built = mkdtempSync(join(OUT, `.hub-build-${side}-`));
  const files = [...uiFiles(join(source, 'src')), join(source, 'src/lib/utils.ts')];
  const hash = createHash('sha256');
  for (const file of files) {
    const relative = file.slice(source.length + 1);
    const target = join(stage, relative);
    mkdirSync(resolve(target, '..'), { recursive: true });
    cpSync(file, target);
    hash.update(relative).update(readFileSync(file));
  }
  if (!existsSync(join(stage, 'node_modules'))) symlinkSync(join(HUB, 'node_modules'), join(stage, 'node_modules'), 'dir');
  cpSync(join(HERE, 'entry.jsx'), join(stage, 'entry.jsx'));
  writeFileSync(join(stage, 'index.html'), '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Game Factory — UI-пример</title></head><body><div id="root"></div><script type="module" src="/entry.jsx"></script></body></html>');
  const mocks = join(stage, 'mocks.jsx');
  cpSync(join(HERE, 'mocks.jsx'), mocks);
  // Программная сборка Vite меняет NODE_ENV процесса. Возвращаем окружение вызова,
  // чтобы следующая dev-команда не принимала side effect билдера за запуск прода.
  const inheritedNodeEnv = process.env.NODE_ENV;
  try { await build({
    configFile: false, root: stage, publicDir: join(source, 'public'),
    esbuild: { jsx: 'automatic' },
    resolve: { alias: [{ find: '@', replacement: join(stage, 'src') }] },
    css: { postcss: { plugins: [tailwind({ base: stage })] } },
    plugins: [{
      name: 'hub-ui-examples', enforce: 'pre',
      transform(code: string, id: string) {
        if (id.startsWith(stage + sep) && /\.(tsx|jsx)$/.test(id)) return code.replace(/^['"]use client['"];?/, '');
        return null;
      },
      resolveId(id: string) {
        if (['@/lib/session.ts', '@/lib/auth.ts', '@/lib/auth-client.ts', '@/lib/catalog.ts', 'next/navigation', '@gf/hub-bridge'].includes(id)
          || /\/src\/lib\/(session|auth|auth-client|catalog)\.ts$/.test(id)) return mocks;
        if (id === 'next/link') return '\0hub-ui-link';
        return null;
      },
      load(id: string) { if (id === '\0hub-ui-link') return `export { Link as default } from ${JSON.stringify(mocks)};`; return null; },
    }],
    build: { outDir: built, emptyOutDir: true, target: 'esnext' },
  }); } finally {
    if (inheritedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = inheritedNodeEnv;
  }
  const metadata = { ref: side === 'before' ? readFileSync(join(OUT, 'baseline-ref.txt'), 'utf8') : `${git('rev-parse', 'HEAD').trim()} + рабочие файлы`,
    version: 'Game Factory', sourceHash: hash.digest('hex'),
  };
  publishSnapshot(OUT, side, built, metadata);
}

export function hubEvidence(runner: string) {
  return { snapshots: snapshotEvidence(OUT), toolHash: hashTool([runner, 'adapter.ts', 'config.ts', 'entry.jsx', 'mocks.jsx', 'preview.ts'].map(f => join(HERE, f))) };
}

export function hubComparison() {
  return { id: 'hub', title: 'Game Factory', out: OUT, profiles: PROFILES, scenes: SCENES,
    liveLabel: 'Открыть страницу', themes: ['dark', 'light'], shotPath: 'shots/{side}-{profile}-{theme}-{scene}.png', hasDiff: false,
    description: 'UI-примеры: реальные страницы и компоненты, данные — образцы. Настоящий вход, API и игра в iframe здесь не проверяются.',
    transformHtml: (html: string, url: URL) => url.pathname === '/' && !url.searchParams.has('scene')
      ? '<!doctype html><html lang="ru"><body style="margin:0;background:#0b0f17;color:#9ba7c1;font:16px system-ui">Область игры</body></html>' : html,
    validateReport: (report: unknown) => {
      try { const current = hubEvidence('check.ts'), saved = report as typeof current;
        return JSON.stringify({ snapshots: saved.snapshots, toolHash: saved.toolHash }) === JSON.stringify(current);
      } catch { return false; }
    } };
}

export async function startHubComparison(port = 0) {
  return startComparison(hubComparison(), port);
}
