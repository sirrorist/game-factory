import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// Архитектурная граница: новый потребитель не должен обходить общий жизненный цикл.
test('реальные попапы хаба используют общую основу', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const foundation = fileURLToPath(new URL('./popup.tsx', import.meta.url));
  const scan = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? scan(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []);
  const bypasses = scan(root).filter(path => path !== foundation).filter(path => /<dialog\b|role=["']dialog["']/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(bypasses.map(path => relative(root, path)), [], 'Используй Popup: вход, выход и семантика уже заданы в общей основе');
});
