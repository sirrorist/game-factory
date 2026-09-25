// Обход и копирование дерева файлов игры с отказом от всего подозрительного:
// симлинков, скрытых файлов, путей за пределами корня.

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface GameFile {
  /** Путь относительно корня через "/". */
  path: string;
  data: Buffer;
}

export const LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
};

export function collectFiles(root: string): GameFile[] {
  const out: GameFile[] = [];
  let total = 0;

  const walk = (dir: string): void => {
    const names = readdirSync(dir).sort();
    for (const name of names) {
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join('/');
      if (name.startsWith('.')) {
        throw new Error(`скрытый файл "${rel}" в пакете игры: убери его или переименуй`);
      }
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw new Error(`симлинк "${rel}" в пакете игры запрещён`);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) throw new Error(`"${rel}": не обычный файл`);
      if (st.size > LIMITS.maxFileBytes) throw new Error(`"${rel}": файл больше ${LIMITS.maxFileBytes} байт`);
      total += st.size;
      if (total > LIMITS.maxTotalBytes) throw new Error(`пакет игры больше ${LIMITS.maxTotalBytes} байт`);
      out.push({ path: rel, data: readFileSync(full) });
      if (out.length > LIMITS.maxFiles) throw new Error(`в пакете игры больше ${LIMITS.maxFiles} файлов`);
    }
  };

  walk(root);
  return out;
}

/** Хеш содержимого пакета: одинаковые файлы дают одинаковый хеш независимо от дат. */
export function hashFiles(files: GameFile[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    h.update(f.path);
    h.update('\0');
    h.update(createHash('sha256').update(f.data).digest());
  }
  return h.digest('hex');
}
