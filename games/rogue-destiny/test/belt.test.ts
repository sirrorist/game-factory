import test from 'node:test';
import assert from 'node:assert/strict';
import { beltItem } from '../src/core/belt.ts';
import { createInventory, placeItem, removeItem } from '../src/core/inventory.ts';
import type { InventoryItem } from '../src/core/types.ts';
const potion = (id: string): InventoryItem => ({ id, name: id, category: 'potion', rarity: 'common', element: 'physical', shape: [{ x: 0, y: 0 }], weight: 0.3, rotation: 0, healAmount: 30 });
test('расход выбранного бинта переводит пояс на следующий, а не даёт бесконечное лечение', () => {
  const grid = createInventory();
  placeItem(grid, potion('a'), 0, 0); placeItem(grid, potion('b'), 1, 0);
  grid.quickSlots[2] = 'b';
  assert.equal(beltItem(grid, 2)?.id, 'b');
  removeItem(grid, 'b'); assert.equal(beltItem(grid, 2)?.id, 'a');
  removeItem(grid, 'a'); assert.equal(beltItem(grid, 2), null);
});
test('перемещение сохраняет выбранный предмет пояса, чужая категория не активируется', () => {
  const grid = createInventory(); const item = potion('a');
  placeItem(grid, item, 0, 0); grid.quickSlots[2] = 'a';
  placeItem(grid, item, 2, 0);
  assert.equal(grid.quickSlots[2], 'a');
  grid.quickSlots[0] = 'a'; assert.equal(beltItem(grid, 0), null);
});
test('заражённое соседство блокирует бинт до очистки', async () => {
 const { infectInventory, cleanseInventory } = await import('../src/core/inventory.ts');
 const g=createInventory();placeItem(g,potion('a'),0,0);infectInventory(g);
 assert.equal(beltItem(g,2),null);cleanseInventory(g);assert.equal(beltItem(g,2)?.id,'a');
});
