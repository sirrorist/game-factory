import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventory, placeItem, canPlaceItem, autoPlaceItem, calculateInventoryStats, findOverlaps } from '../src/core/inventory.ts';
import type { InventoryItem } from '../src/core/types.ts';
const staff = (): InventoryItem => ({ id: 'staff', name: 'Посох', category: 'weapon', rarity: 'common', element: 'physical', shape: [{x:0,y:0},{x:0,y:1}], rotation:0, weight:2 });
const rune = (): InventoryItem => ({id:'loot', name:'Руна', category:'rune', rarity:'common', element:'ice', shape:[{x:0,y:0}], rotation:0, weight:1});
test('предпросмотр поворота не меняет размещение, вес и пояс', () => {
 const g=createInventory(3,2),s=staff();placeItem(g,s,0,0);g.quickSlots[0]=s.id;
 assert.equal(canPlaceItem(g,s,1,0,90),true);
 assert.equal(s.rotation,0);assert.equal(s.gridX,0);assert.equal(g.slots[3]?.itemId,s.id);
 assert.equal(calculateInventoryStats(g).totalWeight,2);assert.equal(g.quickSlots[0],s.id);
});
test('лут не занимает зарезервированные клетки и не вытесняет предмет при отказе', () => {
 const g=createInventory(2,2),s=staff();placeItem(g,s,0,0);autoPlaceItem(g,rune());
 assert.equal(placeItem(g,s,1,0,90),false);assert.equal(s.rotation,0);assert.equal(s.gridX,0);
 assert.equal(g.items.size,2);assert.deepEqual(findOverlaps(g),[]);
});
test('успешный перенос с поворотом атомарно очищает старые клетки', () => {
 const g=createInventory(3,2),s=staff();placeItem(g,s,0,0);g.quickSlots[0]=s.id;
 assert.equal(placeItem(g,s,1,0,90),true);assert.equal(s.rotation,90);
 assert.equal(g.slots[0]?.itemId,null);assert.equal(g.slots[3]?.itemId,null);
 assert.equal(g.quickSlots[0],s.id);assert.deepEqual(findOverlaps(g),[]);
});
