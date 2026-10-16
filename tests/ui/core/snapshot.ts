import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ROOT, outputFor, safeName } from './paths.ts';
import type { Snapshot } from './types.ts';
import { validateManifest } from '../../../packages/manifest/src/index.ts';

export function ensureNewBaseline(destination: string): void {
  if (existsSync(destination)) throw new Error('База уже существует и не перезаписывается. Для нового сравнения укажи другой --run.');
}

export function archiveAfter(out: string): void {
  if (!existsSync(join(out, 'after'))) return;
  const history = join(out, 'history'); mkdirSync(history, { recursive: true });
  const archive = mkdtempSync(join(history, new Date().toISOString().replaceAll(':', '-') + '-'));
  for (const name of ['after', 'report.json', 'live-report.json', 'tool-smoke.json', 'viewer-report.json', 'shots', 'diff', 'live', 'viewer', 'acceptance', 'boundary', 'wallet-review']) {
    if (existsSync(join(out, name))) renameSync(join(out, name), join(archive, name));
  }
}

export function publishSnapshot(out: string, side: 'before' | 'after', content: string, metadata: { ref: string; version: string; sourceHash?: string }): Snapshot {
  if (side === 'before') ensureNewBaseline(join(out, side));
  mkdirSync(out, { recursive: true });
  const stage = mkdtempSync(join(out, '.build-'));
  cpSync(content, stage, { recursive: true });
  const snapshot = { ...metadata, hash: createHash('sha256').update(readFileSync(join(stage, 'index.html'))).digest('hex'), builtAt: new Date().toISOString() };
  writeFileSync(join(stage, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  if (side === 'after') archiveAfter(out);
  renameSync(stage, join(out, side));
  return snapshot;
}

export function snapshotSource(id: string, ref?: string) {
  safeName(id);
  const game = join(ROOT, 'games', id);
  if (!existsSync(join(game, 'game.json'))) throw new Error('Не найдена игра: ' + id);
  const temporary = mkdtempSync(join(ROOT, 'test-results', 'ui-source-'));
  const source = join(temporary, 'games', id);
  let revision: string;
  if (ref) {
    if (ref.startsWith('-')) throw new Error('Некорректный git ref');
    revision = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    const archive = execFileSync('git', ['archive', revision, `games/${id}`, 'tsconfig.game.json', 'tsconfig.base.json', 'packages/game-sdk/gf-sdk.js'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
  } else {
    revision = `${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()} + рабочие файлы`;
    cpSync(game, source, { recursive: true, filter: path => !path.split(sep).some(part => ['node_modules', 'dist', 'concepts'].includes(part)) });
    for (const file of ['tsconfig.game.json', 'tsconfig.base.json']) cpSync(join(ROOT, file), join(temporary, file));
  }
  return { game, source, revision };
}

export function buildGameSnapshot(id: string, side: 'before' | 'after', ref?: string, instrument?: (source: string) => void): Snapshot {
  const out = outputFor(id), destination = join(out, side);
  if (side === 'before') ensureNewBaseline(destination);
  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  const { game, source, revision } = snapshotSource(id, ref);
  const parsed = validateManifest(JSON.parse(readFileSync(join(source, 'game.json'), 'utf8')));
  if (!parsed.ok) throw new Error('Невалидный game.json: ' + parsed.errors.join('; '));
  const manifest = parsed.manifest;
  if (manifest.id !== id) throw new Error('ID в манифесте не совпал с именем игры');
  if (manifest.entry !== 'index.html') throw new Error('UI-сравнение пока требует entry=index.html');
  const safeContent = (name: string) => {
    const path = resolve(source, name), rel = relative(source, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Каталог сборки выходит за игру');
    return path;
  };
  let content: string;
  if (manifest.toolchain === 'vite-ts') {
    symlinkSync(join(game, 'node_modules'), join(source, 'node_modules'), 'junction');
    instrument?.(source);
    const require = createRequire(join(game, 'package.json'));
    const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    execFileSync(process.execPath, [vite, 'build', '--config', join(source, 'vite.config.ts')], { cwd: source, stdio: 'inherit' });
    content = safeContent(manifest.output ?? 'dist');
  } else if (manifest.toolchain === 'static') content = safeContent(manifest.source ?? 'src');
  else throw new Error('Неизвестный toolchain: ' + manifest.toolchain);
  // Временная сборка/исходники доверены разработчику; раздаётся только каталог результата.
  if (!realpathSync(content).startsWith(realpathSync(source) + sep)) throw new Error('Каталог результата вне временной игры');
  const sdk = ref ? resolve(source, '../../packages/game-sdk/gf-sdk.js') : join(ROOT, 'packages/game-sdk/gf-sdk.js');
  cpSync(sdk, join(content, 'gf-sdk.js'));
  return publishSnapshot(out, side, content, { ref: revision, version: manifest.version });
}
