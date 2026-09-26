// Ссылки D-NNN и П-NNN - то, по чему агент ищет контекст. Висячая ссылка или два
// решения с одним номером ведут следующую сессию не туда (ROADMAP, "Слабые места").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;

function definitions(file: string, prefix: string): string[] {
  const re = new RegExp(`^\\*\\*(${prefix}-\\d{3})\\.`, 'gm');
  return [...readFileSync(join(REPO, file), 'utf8').matchAll(re)].map((m) => m[1]!);
}

test('каждая ссылка D-/П- ведёт на существующую запись, номера не повторяются', () => {
  const defs = [...definitions('docs/DECISIONS.md', 'D'), ...definitions('docs/PITFALLS.md', 'П')];
  const dupes = defs.filter((d, i) => defs.indexOf(d) !== i);
  assert.deepEqual(dupes, [], 'один номер у двух записей');

  const files = spawnSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n');
  assert.ok(files.length > 10, 'git ls-files ничего не вернул');
  const known = new Set(defs);
  const dangling: string[] = [];
  for (const file of files) {
    if (!/\.(md|ts|tsx|js|yml|yaml|sh|json)$/.test(file) || file === 'pnpm-lock.yaml') continue;
    const text = readFileSync(join(REPO, file), 'utf8');
    for (const [ref] of text.matchAll(/(?<![\p{L}\d])[DП]-\d{3}(?!\d)/gu)) {
      if (!known.has(ref)) dangling.push(`${file}: ${ref}`);
    }
  }
  assert.deepEqual(dangling, [], 'ссылки на несуществующие записи');
});
