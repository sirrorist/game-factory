import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventory, placeItem, calculateInventoryStats, cleanseInventory } from '../src/core/inventory.ts';
import { tickInventoryHazards, inventoryWarnings } from '../src/core/inventory-hazards.ts';
import type { InventoryItem } from '../src/core/types.ts';
const item=(id:string,category:InventoryItem['category'],element:InventoryItem['element'],rarity:InventoryItem['rarity']='common'):InventoryItem=>({id,name:id,category,element,rarity,shape:[{x:0,y:0}],weight:1,rotation:0});
test('бумага горит за 8 игровых секунд одинаково на 30/144 Гц, пояс и вес очищаются',()=>{
 for(const fps of [30,144]) {
  const grid=createInventory();placeItem(grid,item('fire','rune','fire'),0,0);placeItem(grid,item('scroll','scroll','ice'),1,0);grid.quickSlots[3]='scroll';
  for(let i=0;i<7*fps;i++) tickInventoryHazards(grid,1/fps);
  assert.ok(grid.items.has('scroll'));
  for(let i=0;i<fps;i++) tickInventoryHazards(grid,1/fps);
  assert.equal(grid.items.has('scroll'),false);assert.equal(grid.quickSlots[3],null);assert.equal(calculateInventoryStats(grid).totalWeight,1);
 }
});
test('перестановка спасает припасы; вычисление характеристик не портит предметы',()=>{
 const grid=createInventory();const potion=item('heal','potion','physical');placeItem(grid,item('poison','rune','poison'),0,0);placeItem(grid,potion,1,0);
 const before=JSON.stringify(potion);calculateInventoryStats(grid);assert.equal(JSON.stringify(potion),before);
 tickInventoryHazards(grid,4);assert.equal(potion.isSpoiled,undefined);
 placeItem(grid,potion,4,3);tickInventoryHazards(grid,3);assert.equal(potion.poisonTime,0);assert.equal(potion.isSpoiled,undefined);assert.deepEqual(inventoryWarnings(grid),[]);
 placeItem(grid,potion,1,0);tickInventoryHazards(grid,6);assert.equal(potion.isSpoiled,true);
 cleanseInventory(grid);assert.equal(potion.isSpoiled,false);assert.equal(potion.poisonTime,0);
});
test('святой источник сохраняет бонус без порчи или ослабления соседних припасов',()=>{
 for(const element of ['fire','poison','ice'] as const) {
  const grid=createInventory();placeItem(grid,item('source','rune',element,'holy'),1,1);placeItem(grid,item('paper','scroll','physical'),0,1);placeItem(grid,item('heal','potion','physical'),2,1);placeItem(grid,item('staff','weapon','physical'),1,2);
  tickInventoryHazards(grid,20);assert.equal(grid.items.size,4);assert.equal(grid.items.get('heal')!.isSpoiled,undefined);assert.equal(calculateInventoryStats(grid).healingMultiplier,1);
  const stats=calculateInventoryStats(grid);assert.equal(element==='fire'?stats.bonusFireDamage:element==='poison'?stats.bonusPoisonDamage:stats.bonusCritRate,element==='fire'?6:element==='poison'?5:0.12);
 }
});
test('пауза/некорректное время не продвигают горение',()=>{
 const grid=createInventory();placeItem(grid,item('fire','rune','fire'),0,0);const scroll=item('paper','scroll','physical');placeItem(grid,scroll,1,0);
 for(const dt of [0,-1,NaN,Infinity]) tickInventoryHazards(grid,dt);
 assert.equal(scroll.burnTime,undefined);
});
