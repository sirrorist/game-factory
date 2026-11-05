import test from 'node:test';
import assert from 'node:assert/strict';
import { learnCodex } from '../src/core/codex.ts';
import { parseMetaProgress } from '../src/core/saves.ts';
import { canUnlockMetroidvania } from '../src/core/dungeon.ts';
import { createInventory } from '../src/core/inventory.ts';
test('Кодекс переживает сохранение и открывает шифр в новом забеге', () => {
 const progress=parseMetaProgress(null);assert.equal(learnCodex(progress,'sylvan_ciphers'),true);
 assert.equal(learnCodex(progress,'sylvan_ciphers'),false);
 const restored=parseMetaProgress(JSON.parse(JSON.stringify(progress)));
 assert.deepEqual(restored.codex,['sylvan_ciphers']);
 assert.equal(canUnlockMetroidvania('runeCipher',createInventory(),new Set(restored.codex)).canUnlock,true);
});
test('повреждённые и неизвестные записи не попадают в Кодекс', () => {
 assert.deepEqual(parseMetaProgress({codex:['true_sight','__proto__',null,'true_sight']}).codex,['true_sight']);
 assert.deepEqual(parseMetaProgress({codex:{}}).codex,[]);
});
