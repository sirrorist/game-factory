// Реестр опубликованных игр и раскладка хранилища.
// Этап 0: файлы на диске (GF_DATA_DIR). Этап 1-2: реестр переезжает в Postgres,
// файлы — в S3 (MinIO); раскладка ключей остаётся той же, что и путей здесь.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { GameManifest } from '../../manifest/src/index.ts';

export interface ExportInfo {
  file: string;
  bytes: number;
  sha256: string;
}

export interface RegistryEntry {
  id: string;
  version: string;
  manifest: GameManifest;
  hash: string;
  files: number;
  bytes: number;
  publishedAt: string;
  export?: ExportInfo;
}

export interface Registry {
  schema: 1;
  updatedAt: string;
  games: RegistryEntry[];
}

export interface DataPaths {
  root: string;
  registry: string;
  gamesDir: string;
  exportsDir: string;
  versionDir(id: string, version: string): string;
  versionMeta(id: string, version: string): string;
  exportFile(id: string, version: string): string;
}

export function dataPaths(dataDir: string): DataPaths {
  const root = resolve(dataDir);
  const gamesDir = join(root, 'storage', 'games');
  const exportsDir = join(root, 'storage', 'exports');
  return {
    root,
    registry: join(root, 'registry.json'),
    gamesDir,
    exportsDir,
    versionDir: (id, version) => join(gamesDir, id, version),
    versionMeta: (id, version) => join(gamesDir, id, `${version}.meta.json`),
    exportFile: (id, version) => join(exportsDir, `${id}-${version}.zip`),
  };
}

export function emptyRegistry(): Registry {
  return { schema: 1, updatedAt: new Date(0).toISOString(), games: [] };
}

export function readRegistry(paths: DataPaths): Registry {
  if (!existsSync(paths.registry)) return emptyRegistry();
  const parsed = JSON.parse(readFileSync(paths.registry, 'utf8')) as Registry;
  if (parsed.schema !== 1 || !Array.isArray(parsed.games)) {
    throw new Error(`${paths.registry}: неизвестный формат реестра`);
  }
  return parsed;
}

/** Запись через временный файл и rename: читатель никогда не увидит половину JSON. */
export function writeRegistry(paths: DataPaths, registry: Registry): void {
  mkdirSync(dirname(paths.registry), { recursive: true });
  const sorted: Registry = {
    ...registry,
    updatedAt: new Date().toISOString(),
    games: [...registry.games].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const tmp = `${paths.registry}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n');
  renameSync(tmp, paths.registry);
}

/**
 * Метка содержимого версии: начало ETag у файлов игры и обложки. По ней `gf check-prod`
 * сверяет сборку с продом (D-044) - формат не менять молча.
 */
export function contentTag(entry: RegistryEntry): string {
  return entry.hash.slice(0, 16);
}

/** Реестр с кешем по mtime: сервер игр перечитывает файл только когда тот изменился. */
export function createRegistryReader(paths: DataPaths): () => Registry {
  let cachedMtime = -1;
  let cached: Registry = emptyRegistry();
  return () => {
    let mtime: number;
    try {
      mtime = statSync(paths.registry).mtimeMs;
    } catch {
      return emptyRegistry();
    }
    if (mtime !== cachedMtime) {
      cached = readRegistry(paths);
      cachedMtime = mtime;
    }
    return cached;
  };
}
