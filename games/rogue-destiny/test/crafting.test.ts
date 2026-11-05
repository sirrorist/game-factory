import test from 'node:test';
import assert from 'node:assert/strict';
import { fuseScrolls } from '../src/core/crafting.ts';
import { createInventory, placeItem } from '../src/core/inventory.ts';
import type { InventoryItem } from '../src/core/types.ts';
const scroll = (id: string, element: InventoryItem['element']): InventoryItem => ({ id, name: id, category: 'scroll', rarity: 'common', element, shape: [{ x: 0, y: 0 }], weight: 0.3, rotation: 0 });
test('слияние заменяет два свитка одним и переносит привязку пояса', () => {
 const g = createInventory(); placeItem(g, scroll('a', 'fire'), 0, 0); placeItem(g, scroll('b', 'poison'), 1, 0); g.quickSlots[3] = 'a';
 const result = fuseScrolls(g, 'a', 'b'); assert.ok(result); assert.equal(g.items.size, 1); assert.equal(g.quickSlots[3], result.id);
});
test('нет места для результата: исходные предметы и пояс возвращаются', () => {
 const g = createInventory(3, 1); placeItem(g, scroll('a', 'fire'), 0, 0); placeItem(g, scroll('b', 'poison'), 2, 0);
 const filler = { ...scroll('x', 'physical'), category: 'rune' as const }; placeItem(g, filler, 1, 0); g.quickSlots[3] = 'a';
 assert.equal(fuseScrolls(g, 'a', 'b'), null); assert.equal(g.items.size, 3); assert.equal(g.quickSlots[3], 'a');
});
test('один свиток не может служить двумя ингредиентами', () => {
 const g=createInventory(); placeItem(g,scroll('a','fire'),0,0); assert.equal(fuseScrolls(g,'a','a'),null); assert.equal(g.items.size,1);
});
