import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ru, plural } from '../src/i18n/ru.ts';

const srcDir = resolve(import.meta.dirname, '../src');

// Все .ts под src, кроме самого языкового файла.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) return path.endsWith('i18n') ? [] : sources(path);
    return path.endsWith('.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

// Обходит дерево: строка, функция (зовём с единицами) или вложенный объект/массив.
function leaves(node: unknown, path: string, out: [string, string][]): void {
  if (typeof node === 'string') out.push([path, node]);
  else if (typeof node === 'function') out.push([path, String(node(...Array(node.length).fill(1)))]);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) leaves(v, `${path}.${k}`, out);
  else assert.fail(`${path}: недопустимое значение ${String(node)}`);
}

test('Каждое значение ru - непустая строка или функция, возвращающая непустую строку', () => {
  const out: [string, string][] = [];
  leaves(ru, 'ru', out);
  assert.ok(out.length > 100, 'ключей слишком мало - обход сломан');
  for (const [path, text] of out) assert.ok(text.trim().length > 0, `${path}: пусто`);
});

test('Каждый раздел и подраздел ru используется в src/', () => {
  const code = sources(srcDir).join('\n');
  for (const [section, value] of Object.entries(ru)) {
    assert.ok(code.includes(`ru.${section}`), `раздел ${section} нигде не используется`);
    for (const key of Object.keys(value)) {
      const dotted = `ru.${section}.${key}`, bracket = `ru.${section}['${key}']`;
      assert.ok(code.includes(dotted) || code.includes(bracket), `${dotted} нигде не используется`);
    }
  }
});

test('Склонение по числу: 1 монета, 2 монеты, 5 монет, 11 монет, 21 монета', () => {
  const coins = (n: number) => plural(n, 'монета', 'монеты', 'монет');
  assert.deepEqual([1, 2, 5, 11, 12, 14, 21, 22, 25, 100, 111].map(coins),
    ['монета', 'монеты', 'монет', 'монет', 'монет', 'монет', 'монета', 'монеты', 'монет', 'монет', 'монет']);
});
