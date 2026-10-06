// Каталог игр - реестр, который пишет `gf build` (этап 0). На этапе 1 - Postgres.

import { ID_RE } from '@gf/manifest';
import { dataPaths, readRegistry, type RegistryEntry } from '@gf/registry';
import { hubConfig } from './config.ts';
import { isPrerelease } from './prerelease.ts';

export interface CatalogGame {
  entry: RegistryEntry;
  /** Версия до 1.0.0 - видна только владельцу (lib/prerelease.ts, D-060). */
  prerelease: boolean;
  gameOrigin: string;
  coverUrl: string | null;
  download: { url: string; bytes: number } | null;
}

function toCatalogGame(entry: RegistryEntry): CatalogGame {
  const cfg = hubConfig();
  const { manifest } = entry;
  return {
    entry,
    prerelease: isPrerelease(entry.version),
    gameOrigin: cfg.gameOrigin(entry.id),
    // Версия в адресе даёт обложке долгий кеш на сервере игр (server.ts, serveRoot).
    coverUrl: manifest.cover
      ? `${cfg.playRootOrigin}/covers/${entry.id}?v=${encodeURIComponent(entry.version)}`
      : null,
    download:
      manifest.offline && entry.export
        ? { url: `${cfg.playRootOrigin}/exports/${encodeURIComponent(entry.export.file)}`, bytes: entry.export.bytes }
        : null,
  };
}

/** Кто смотрит: пререлизы - только владельцу. По умолчанию - гость: забытый флаг не открывает лишнего. */
export interface Viewer {
  owner: boolean;
}

const GUEST: Viewer = { owner: false };

export function listGames(viewer: Viewer = GUEST): CatalogGame[] {
  const registry = readRegistry(dataPaths(hubConfig().dataDir));
  return registry.games
    .filter((g) => g.manifest.kind === 'static')
    .sort((a, b) => a.manifest.title.localeCompare(b.manifest.title, 'ru'))
    .map(toCatalogGame)
    .filter((g) => viewer.owner || !g.prerelease);
}

export function findGame(id: string, viewer: Viewer = GUEST): CatalogGame | null {
  // id идёт в поддомен и в пути: всё, что не похоже на id, даже не ищем.
  if (!ID_RE.test(id)) return null;
  // Пререлиз гостю - "не найдено", как несуществующая игра: витрина о нём не говорит.
  return listGames(viewer).find((g) => g.entry.id === id) ?? null;
}
