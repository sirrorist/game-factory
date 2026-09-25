// gf — CLI фабрики игр. Без зависимостей, запускается node напрямую (type stripping).
//
//   node tools/gf.ts list                    игры в games/ и их статус
//   node tools/gf.ts validate [id...]        проверить манифесты
//   node tools/gf.ts build [id...] [--replace]
//                                            собрать и опубликовать в локальное хранилище
//   node tools/gf.ts export [id...]          офлайн-архив для игр с offline: true
//   node tools/gf.ts new <id>                новая игра из шаблона templates/vite-ts
//
// Данные пишутся в GF_DATA_DIR (по умолчанию .data).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentDir, ID_RE, RESERVED_IDS, validateManifest, type GameManifest } from '../packages/manifest/src/index.ts';
import { dataPaths, readRegistry, writeRegistry, type DataPaths, type RegistryEntry } from '../packages/registry/src/index.ts';
import { collectFiles, hashFiles, type GameFile } from './lib/files.ts';
import { createZip } from './lib/zip.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// GF_GAMES_DIR — только для тестов CLI: чтобы `gf new` не мусорил в настоящих games/.
const GAMES_DIR = process.env.GF_GAMES_DIR ?? join(REPO, 'games');
const TEMPLATES_DIR = join(REPO, 'templates');
const SDK_FILE = join(REPO, 'packages', 'game-sdk', 'gf-sdk.js');
const SDK_NAME = 'gf-sdk.js';

class CliError extends Error {}

interface LoadedGame {
  dir: string;
  manifest: GameManifest;
  warnings: string[];
}

function listGameDirs(): string[] {
  if (!existsSync(GAMES_DIR)) return [];
  return readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(GAMES_DIR, d.name, 'game.json')))
    .map((d) => d.name)
    .sort();
}

function loadGame(name: string): LoadedGame {
  const dir = join(GAMES_DIR, name);
  const file = join(dir, 'game.json');
  if (!existsSync(file)) throw new CliError(`игра "${name}": нет ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new CliError(`игра "${name}": game.json не разбирается как JSON: ${(e as Error).message}`);
  }
  const r = validateManifest(raw);
  if (!r.ok) {
    throw new CliError(`игра "${name}": манифест невалиден:\n  - ${r.errors.join('\n  - ')}`);
  }
  if (r.manifest.id !== name) {
    throw new CliError(`игра "${name}": id в манифесте "${r.manifest.id}" не совпадает с именем папки`);
  }
  return { dir, manifest: r.manifest, warnings: r.warnings };
}

function selectGames(ids: string[]): string[] {
  const all = listGameDirs();
  if (ids.length === 0) return all;
  for (const id of ids) if (!all.includes(id)) throw new CliError(`игра "${id}" не найдена в games/`);
  return ids;
}

function runBuildScript(game: LoadedGame): void {
  const r = spawnSync('pnpm', ['--dir', game.dir, 'run', 'build'], { stdio: 'inherit' });
  if (r.status !== 0) throw new CliError(`игра "${game.manifest.id}": сборка упала (код ${r.status ?? r.signal})`);
}

function gatherContent(game: LoadedGame): GameFile[] {
  const { manifest } = game;
  switch (manifest.toolchain) {
    case 'static':
    case 'prebuilt':
      break;
    case 'vite-ts':
      runBuildScript(game);
      break;
    default:
      throw new CliError(`игра "${manifest.id}": toolchain "${manifest.toolchain}" запланирован, но ещё не поддерживается (docs/ROADMAP.md)`);
  }
  const root = join(game.dir, contentDir(manifest));
  if (!existsSync(root)) throw new CliError(`игра "${manifest.id}": нет папки ${root}`);
  let files: GameFile[];
  try {
    files = collectFiles(root);
  } catch (e) {
    throw new CliError(`игра "${manifest.id}": ${(e as Error).message}`);
  }
  const names = new Set(files.map((f) => f.path));
  if (!names.has(manifest.entry)) throw new CliError(`игра "${manifest.id}": нет входного файла ${manifest.entry}`);
  if (manifest.cover && !names.has(manifest.cover)) throw new CliError(`игра "${manifest.id}": нет обложки ${manifest.cover}`);

  // SDK подкладывается рядом, если HTML ссылается на него, а своего файла нет.
  const wantsSdk = files.some((f) => f.path.endsWith('.html') && f.data.toString('utf8').includes(SDK_NAME));
  if (wantsSdk && !names.has(SDK_NAME)) files.push({ path: SDK_NAME, data: readFileSync(SDK_FILE) });
  return files;
}

function writeVersion(paths: DataPaths, manifest: GameManifest, files: GameFile[], hash: string): void {
  const target = paths.versionDir(manifest.id, manifest.version);
  const tmp = `${target}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  for (const f of files) {
    const out = join(tmp, ...f.path.split('/'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, f.data);
  }
  rmSync(target, { recursive: true, force: true });
  renameSync(tmp, target);
  const bytes = files.reduce((s, f) => s + f.data.length, 0);
  writeFileSync(paths.versionMeta(manifest.id, manifest.version), JSON.stringify({ hash, files: files.length, bytes }, null, 2) + '\n');
}

function build(ids: string[], replace: boolean): void {
  const paths = dataPaths(process.env.GF_DATA_DIR ?? join(REPO, '.data'));
  const registry = readRegistry(paths);

  for (const name of selectGames(ids)) {
    const game = loadGame(name);
    const { manifest } = game;
    for (const w of game.warnings) console.warn(`! ${name}: ${w}`);
    if (manifest.kind === 'server') {
      console.warn(`- ${name}: kind "server" пропущен — серверные игры появятся на этапе 3`);
      continue;
    }

    const files = gatherContent(game);
    const hash = hashFiles(files);
    const bytes = files.reduce((s, f) => s + f.data.length, 0);
    const metaFile = paths.versionMeta(manifest.id, manifest.version);

    let status: string;
    if (existsSync(metaFile)) {
      const prev = JSON.parse(readFileSync(metaFile, 'utf8')) as { hash: string };
      if (prev.hash === hash) {
        status = 'без изменений';
      } else if (!replace) {
        throw new CliError(
          `игра "${name}": версия ${manifest.version} уже опубликована с другим содержимым.\n` +
            '  Опубликованная версия неизменяема: подними "version" в game.json.\n' +
            '  Для локальной отладки есть --replace (только на своей машине).',
        );
      } else {
        writeVersion(paths, manifest, files, hash);
        status = 'перезаписана (--replace)';
      }
    } else {
      writeVersion(paths, manifest, files, hash);
      status = 'опубликована';
    }

    const prev = registry.games.find((g) => g.id === manifest.id);
    const entry: RegistryEntry = {
      id: manifest.id,
      version: manifest.version,
      manifest,
      hash,
      files: files.length,
      bytes,
      publishedAt: prev && prev.version === manifest.version && prev.hash === hash ? prev.publishedAt : new Date().toISOString(),
    };
    // Архив остаётся в силе, только если он собран из этого же содержимого.
    if (prev?.export && prev.version === manifest.version && prev.hash === hash) entry.export = prev.export;
    registry.games = registry.games.filter((g) => g.id !== manifest.id).concat(entry);
    console.log(`✓ ${name}@${manifest.version}: ${status}, файлов ${files.length}, ${bytes} байт`);
  }

  writeRegistry(paths, registry);
}

/** Грабли file:// ловятся статически ещё до браузерного теста. */
export function offlineProblems(files: GameFile[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    const text = /\.(html|js|mjs|css)$/.test(f.path) ? f.data.toString('utf8') : '';
    if (f.path.endsWith('.html')) {
      for (const tag of text.match(/<script\b[^>]*>/gi) ?? []) {
        if (/type\s*=\s*["']?module/i.test(tag) && /\bsrc\s*=/i.test(tag)) {
          errors.push(`${f.path}: <script type="module" src=...> не грузится через file:// — нужна офлайн-сборка (один файл, классический скрипт)`);
        }
      }
    }
    if (/\.(js|mjs)$/.test(f.path)) {
      if (/\bfetch\s*\(/.test(text)) warnings.push(`${f.path}: fetch() не работает через file:// — проверь, что он не нужен для запуска`);
      if (/\bimport\s*\(/.test(text)) warnings.push(`${f.path}: динамический import() не работает через file://`);
    }
  }
  return { errors, warnings };
}

const README_TXT = (m: GameManifest): string => `${m.title} ${m.version}

Как запустить: открой index.html в браузере (двойной клик).
Интернет не нужен. Сохранения хранятся в браузере на этом компьютере.

How to play: open index.html in a browser. No internet required.

Собрано Game Factory.
`;

function exportGames(ids: string[]): void {
  const paths = dataPaths(process.env.GF_DATA_DIR ?? join(REPO, '.data'));
  const registry = readRegistry(paths);
  const targets = ids.length > 0 ? ids : registry.games.filter((g) => g.manifest.offline).map((g) => g.id);
  if (targets.length === 0) console.warn('нечего экспортировать: нет опубликованных игр с offline: true (сначала gf build)');

  for (const id of targets) {
    const entry = registry.games.find((g) => g.id === id);
    if (!entry) throw new CliError(`игра "${id}" не опубликована: сначала gf build ${id}`);
    if (!entry.manifest.offline) throw new CliError(`игра "${id}": offline: false — офлайн-архив для неё не делается`);
    if (entry.manifest.entry !== 'index.html') {
      throw new CliError(`игра "${id}": для офлайн-архива вход должен быть index.html в корне — человек будет искать именно его`);
    }

    const files = collectFiles(paths.versionDir(entry.id, entry.version));
    const problems = offlineProblems(files);
    for (const w of problems.warnings) console.warn(`! ${id}: ${w}`);
    if (problems.errors.length > 0) throw new CliError(`игра "${id}" не годится для офлайна:\n  - ${problems.errors.join('\n  - ')}`);

    const folder = `${entry.id}-${entry.version}`;
    const zip = createZip([
      ...files.map((f) => ({ name: `${folder}/${f.path}`, data: f.data })),
      { name: `${folder}/README.txt`, data: Buffer.from(README_TXT(entry.manifest), 'utf8') },
    ]);
    const out = paths.exportFile(entry.id, entry.version);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, zip);
    entry.export = {
      file: `${folder}.zip`,
      bytes: zip.length,
      sha256: createHash('sha256').update(zip).digest('hex'),
    };
    console.log(`✓ ${id}@${entry.version}: ${out} (${zip.length} байт)`);
  }
  writeRegistry(paths, registry);
}

/** Новая игра из шаблона: копия без node_modules и сборки, id и название — свои. */
function newGame(ids: string[]): void {
  const [id, ...extra] = ids;
  if (!id || extra.length > 0) throw new CliError('нужен ровно один id: gf new <id>');
  if (!ID_RE.test(id) || (RESERVED_IDS as readonly string[]).includes(id)) {
    throw new CliError(`"${id}" не годится в id: a-z, 0-9 и дефис, 1-40 символов, не служебное имя (это поддомен)`);
  }
  const target = join(GAMES_DIR, id);
  if (existsSync(target)) throw new CliError(`игра "${id}" уже есть: ${target}`);

  const template = join(TEMPLATES_DIR, 'vite-ts');
  cpSync(template, target, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(template.length + 1);
      const top = rel.split(/[\\/]/)[0] ?? '';
      return rel === '' || !(top === 'node_modules' || top === 'dist' || top.startsWith('.'));
    },
  });

  const manifestFile = join(target, 'game.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
  manifest.id = id;
  manifest.title = id;
  manifest.version = '0.1.0';
  manifest.tags = [];
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  const pkgFile = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as Record<string, unknown>;
  pkg.name = `@gf-game/${id}`;
  pkg.version = '0.1.0';
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

  console.log(`✓ ${target}\n  дальше: pnpm install, поправить title в game.json, pnpm games:build ${id}`);
}

function list(): void {
  const names = listGameDirs();
  if (names.length === 0) console.log('в games/ нет игр');
  for (const name of names) {
    try {
      const { manifest: m } = loadGame(name);
      console.log(`${m.id.padEnd(20)} ${m.version.padEnd(10)} ${m.kind}/${m.toolchain}${m.offline ? ' offline' : ''}  ${m.title}`);
    } catch (e) {
      console.log(`${name.padEnd(20)} ОШИБКА: ${(e as Error).message}`);
    }
  }
}

function validate(ids: string[]): void {
  let failed = 0;
  for (const name of selectGames(ids)) {
    try {
      const g = loadGame(name);
      for (const w of g.warnings) console.warn(`! ${name}: ${w}`);
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${(e as Error).message}`);
    }
  }
  if (failed > 0) throw new CliError(`невалидных манифестов: ${failed}`);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const ids = rest.filter((a) => !a.startsWith('--'));
  for (const f of flags) if (f !== '--replace') throw new CliError(`неизвестный флаг ${f}`);

  switch (command) {
    case 'list':
      return list();
    case 'validate':
      return validate(ids);
    case 'build':
      return build(ids, flags.has('--replace'));
    case 'export':
      return exportGames(ids);
    case 'new':
      return newGame(ids);
    default:
      throw new CliError('команды: list, validate [id...], build [id...] [--replace], export [id...], new <id>');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof CliError) {
      console.error(`gf: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
