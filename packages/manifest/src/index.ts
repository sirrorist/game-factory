// Манифест игры (game.json): единственное, что хаб знает об игре.
// Валидатор без зависимостей: его исполняют CLI и сервер игр, а им
// лишние пакеты не нужны. Синхронность с game.schema.json держит тест.

export const GAME_KINDS = ['static', 'server'] as const;
export const TOOLCHAINS = ['static', 'vite-ts', 'prebuilt', 'rust-wasm', 'godot', 'docker'] as const;
export const PERMISSIONS = [
  'saves',
  'leaderboard',
  'multiplayer',
  'fullscreen',
  'pointer-lock',
  'gamepad',
  'audio',
] as const;

// Имена, которые нельзя отдать игре: они совпадают со служебными поддоменами.
export const RESERVED_IDS = [
  'www', 'api', 'admin', 'hub', 'play', 'cdn', 'static', 'assets',
  'exports', 'covers', 'mail', 'auth', 'status', 'docs',
] as const;

export type GameKind = (typeof GAME_KINDS)[number];
export type Toolchain = (typeof TOOLCHAINS)[number];
export type Permission = (typeof PERMISSIONS)[number];

export interface GameManifest {
  $schema?: string;
  id: string;
  title: string;
  version: string;
  description?: string;
  kind: GameKind;
  toolchain: Toolchain;
  /** Папка с исходниками относительно папки игры (для toolchain static). */
  source?: string;
  /** Папка с результатом сборки относительно папки игры (для сборочных toolchain). */
  output?: string;
  /** Входной HTML относительно корня сборки. */
  entry: string;
  /** Игру можно скачать архивом и открыть через file://. */
  offline: boolean;
  permissions: Permission[];
  tags: string[];
  cover?: string;
  authors?: string[];
}

export type ValidationResult =
  | { ok: true; manifest: GameManifest; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const TAG_RE = /^[a-z0-9-]{1,24}$/;

const KNOWN_KEYS = new Set([
  '$schema', 'id', 'title', 'version', 'description', 'kind', 'toolchain', 'source',
  'output', 'entry', 'offline', 'permissions', 'tags', 'cover', 'authors',
]);

/** Путь внутри пакета игры: относительный, без выхода наверх и без сюрпризов. */
export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0 || p.length > 200) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split('/');
  return parts.every((s) => s !== '' && s !== '.' && s !== '..' && !s.startsWith('.'));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['манифест должен быть JSON-объектом'], warnings };
  }
  const m = input as Record<string, unknown>;

  for (const key of Object.keys(m)) {
    if (!KNOWN_KEYS.has(key)) errors.push(`неизвестное поле "${key}" (опечатка?)`);
  }

  const str = (key: string, required: boolean): string | undefined => {
    const v = m[key];
    if (v === undefined) {
      if (required) errors.push(`нет обязательного поля "${key}"`);
      return undefined;
    }
    if (typeof v !== 'string') {
      errors.push(`"${key}" должно быть строкой`);
      return undefined;
    }
    return v;
  };

  const id = str('id', true);
  if (id !== undefined) {
    if (!ID_RE.test(id)) {
      errors.push(`"id" = "${id}": только a-z, 0-9 и дефис, 1-40 символов, без дефиса по краям (это поддомен)`);
    } else if ((RESERVED_IDS as readonly string[]).includes(id)) {
      errors.push(`"id" = "${id}" зарезервирован под служебный поддомен`);
    }
  }

  const title = str('title', true);
  if (title !== undefined && (title.trim().length === 0 || title.length > 80)) {
    errors.push('"title": от 1 до 80 символов');
  }

  const version = str('version', true);
  if (version !== undefined && !VERSION_RE.test(version)) {
    errors.push(`"version" = "${version}": нужен semver, например 1.0.0`);
  }

  const description = str('description', false);
  if (description !== undefined && description.length > 500) {
    errors.push('"description": не длиннее 500 символов');
  }

  const kind = str('kind', true);
  if (kind !== undefined && !(GAME_KINDS as readonly string[]).includes(kind)) {
    errors.push(`"kind" = "${kind}": допустимо ${GAME_KINDS.join(', ')}`);
  }

  const toolchain = str('toolchain', true);
  if (toolchain !== undefined && !(TOOLCHAINS as readonly string[]).includes(toolchain)) {
    errors.push(`"toolchain" = "${toolchain}": допустимо ${TOOLCHAINS.join(', ')}`);
  }

  for (const key of ['source', 'output', 'entry', 'cover'] as const) {
    const v = str(key, key === 'entry');
    if (v !== undefined && !isSafeRelativePath(v)) {
      errors.push(`"${key}" = "${v}": нужен относительный путь без "..", "/" в начале, "\\" и скрытых файлов`);
    }
  }
  const entry = m.entry;
  if (typeof entry === 'string' && !entry.endsWith('.html')) {
    errors.push('"entry" должен указывать на .html');
  }
  const cover = m.cover;
  if (typeof cover === 'string' && !/\.(png|jpe?g|webp|svg)$/.test(cover)) {
    errors.push('"cover": png, jpg, webp или svg');
  }

  if (typeof m.offline !== 'boolean') {
    errors.push('"offline" обязателен и должен быть true или false');
  } else if (m.offline && kind === 'server') {
    errors.push('"offline": true возможен только для kind "static": у серверной игры нет file://-режима');
  }

  if (!isStringArray(m.permissions)) {
    errors.push('"permissions" обязателен: массив строк, можно пустой');
  } else {
    const seen = new Set<string>();
    for (const p of m.permissions) {
      if (!(PERMISSIONS as readonly string[]).includes(p)) errors.push(`"permissions": неизвестное право "${p}"`);
      if (seen.has(p)) errors.push(`"permissions": "${p}" повторяется`);
      seen.add(p);
    }
  }

  if (!isStringArray(m.tags)) {
    errors.push('"tags" обязателен: массив строк, можно пустой');
  } else {
    if (m.tags.length > 10) errors.push('"tags": не больше 10');
    for (const t of m.tags) if (!TAG_RE.test(t)) errors.push(`"tags": "${t}" — только a-z, 0-9, дефис, до 24 символов`);
  }

  if (m.authors !== undefined && !(isStringArray(m.authors) && m.authors.length <= 10)) {
    errors.push('"authors": массив строк, не больше 10');
  }

  if (toolchain === 'static' && m.output !== undefined) {
    errors.push('"output" не нужен для toolchain "static": отдаётся папка "source"');
  }
  if (toolchain !== undefined && toolchain !== 'static' && m.source !== undefined) {
    warnings.push(`"source" игнорируется для toolchain "${toolchain}": берётся "output"`);
  }
  if (kind === 'server') {
    warnings.push('kind "server" запланирован на этап 3: сейчас такую игру не собрать и не запустить');
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, manifest: m as unknown as GameManifest, warnings };
}

/** Папка, из которой берутся файлы игры для публикации. */
export function contentDir(manifest: GameManifest): string {
  if (manifest.toolchain === 'static') return manifest.source ?? 'src';
  return manifest.output ?? 'dist';
}
