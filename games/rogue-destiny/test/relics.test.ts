import test from 'node:test';
import assert from 'node:assert/strict';
import { shrineRelic, weaponPrice } from '../src/core/relics.ts';
test('святая реликвия безопасна, адская сильнее и требует здоровье', () => {
 const holy=shrineRelic(1),infernal=shrineRelic(2);
 assert.equal(weaponPrice(holy).health,0);assert.equal(weaponPrice(infernal).health,4);
 assert.ok(infernal.damage!>holy.damage!);assert.notEqual(holy.id,infernal.id);
});

import { libraryRelic, damageFragileRelics } from '../src/core/relics.ts';
import { createInventory, placeItem, removeItem, calculateInventoryStats, getScrollMultiplier } from '../src/core/inventory.ts';
test('линза усиливает соседний свиток, трескается и перестаёт усиливать при поломке', () => {
  const grid = createInventory(6, 4), lens = libraryRelic(1);
  const scroll = { ...shrineRelic(1), id: 'scroll', category: 'scroll' as const, shape: [{x:0,y:0}] };
  placeItem(grid,lens,0,0); placeItem(grid,scroll,0,1);
  assert.equal(calculateInventoryStats(grid).scrollMultiplier,1.25);
  const distant = { ...scroll, id:'distant' };
  placeItem(grid,distant,4,3);
  assert.equal(getScrollMultiplier(grid,distant.id),1);
  assert.equal(getScrollMultiplier(grid,scroll.id),1.25);
  assert.equal(damageFragileRelics(grid,0),false);
  assert.equal(damageFragileRelics(grid,NaN),false);
  assert.equal(lens.durability,20);
  placeItem(grid,scroll,5,3);
  assert.equal(calculateInventoryStats(grid).scrollMultiplier,1);
  placeItem(grid,scroll,1,1);
  assert.equal(calculateInventoryStats(grid).scrollMultiplier,1.25);
  for(let i=0;i<6;i++) damageFragileRelics(grid,10);
  assert.equal(lens.durability,0);
  assert.equal(calculateInventoryStats(grid).scrollMultiplier,1);
});

test('цепь держит броню до первого перемещения, отказ размещения её не рвёт', () => {
 const grid=createInventory(),chain=libraryRelic(2);assert.equal(chain.relicEffect,'chain');
 assert.ok(placeItem(grid,chain,0,0));assert.equal(calculateInventoryStats(grid).totalArmor,6);
 assert.equal(placeItem(grid,chain,99,99),false);assert.equal(chain.isSevered,false);
 placeItem(grid,chain,0,0);assert.equal(chain.isSevered,false);
 placeItem(grid,chain,1,0);assert.equal(chain.isSevered,true);assert.equal(calculateInventoryStats(grid).totalArmor,0);
 placeItem(grid,chain,0,0);assert.equal(chain.isSevered,true);
});
test('поворот и выкладывание рвут цепь; она не усиливает свитки как линза', () => {
 const grid=createInventory(),chain=libraryRelic(2);
 placeItem(grid,chain,0,0);placeItem(grid,chain,0,0,90);assert.equal(chain.isSevered,true);
 const other=libraryRelic(4);placeItem(grid,other,4,0);
 assert.equal(calculateInventoryStats(grid).totalArmor,6);
 removeItem(grid,other.id);assert.equal(other.isSevered,true);
 placeItem(grid,other,4,0);assert.equal(calculateInventoryStats(grid).totalArmor,0);
 const paper={...shrineRelic(1),id:'paper',category:'scroll' as const,shape:[{x:0,y:0}]};placeItem(grid,paper,3,0);
 assert.equal(getScrollMultiplier(grid,paper.id),1);
});

import { oracleFocus } from '../src/core/relics.ts';
test('фокусы Оракула предлагают разные стили парирования',()=>{
 assert.equal(oracleFocus(1).parryType,'siphon');assert.equal(oracleFocus(2).parryType,'reflect');assert.equal(oracleFocus(3).parryType,'both');
 assert.ok(oracleFocus(1).weight<oracleFocus(2).weight);assert.equal(oracleFocus(3).rarity,'holy');
});
