import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectFiles, hashFiles } from './files.ts';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'gf-files-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

test('обход сортирован и даёт пути через /', () => {
  const root = tree({ 'b.js': 'b', 'a/index.html': 'a' });
  assert.deepEqual(collectFiles(root).map((f) => f.path), ['a/index.html', 'b.js']);
});

test('скрытые файлы и симлинки отвергаются', () => {
  assert.throws(() => collectFiles(tree({ '.env': 'SECRET=1' })), /скрытый/);
  const root = tree({ 'a.txt': 'a' });
  symlinkSync('/etc/passwd', join(root, 'link'));
  assert.throws(() => collectFiles(root), /симлинк/);
});

test('хеш зависит от содержимого и путей, но не от порядка', () => {
  const a = { path: 'a', data: Buffer.from('1') };
  const b = { path: 'b', data: Buffer.from('2') };
  assert.equal(hashFiles([a, b]), hashFiles([b, a]));
  assert.notEqual(hashFiles([a]), hashFiles([{ path: 'a', data: Buffer.from('2') }]));
  assert.notEqual(hashFiles([a]), hashFiles([{ path: 'c', data: Buffer.from('1') }]));
});
