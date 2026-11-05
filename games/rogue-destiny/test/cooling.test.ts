import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../src/core/player.ts';
import { createInventory, placeItem, calculateInventoryStats } from '../src/core/inventory.ts';
import { coolIntoItem, coolIntoWater, tickSteamPoison, createSteamState, rekindleStarterCatalyst } from '../src/core/cooling.ts';
import { libraryRelic } from '../src/core/relics.ts';

test('кристалл принимает жар по оставшейся ёмкости и теряет резонанс при поломке',()=>{
 const player=createPlayer(),grid=createInventory();player.aetherHeat=100;
 const crystal={...libraryRelic(1),element:'fire' as const,durability:3};placeItem(grid,crystal,0,0);
 const weapon={...crystal,id:'weapon',category:'weapon' as const,element:'physical' as const,shape:[{x:0,y:0}],damage:18};placeItem(grid,weapon,0,1);
 assert.equal(calculateInventoryStats(grid).bonusFireDamage,6);
 assert.equal(coolIntoItem(player,grid,crystal.id).heat,15);assert.equal(player.aetherHeat,85);assert.equal(crystal.durability,0);
 assert.equal(calculateInventoryStats(grid).bonusFireDamage,0);assert.equal(coolIntoItem(player,grid,crystal.id).heat,0);
});
test('оружие тупится за отвод, испорченный предмет и холодный герой не меняются',()=>{
 const player=createPlayer(),grid=createInventory();const weapon={...libraryRelic(1),id:'staff',category:'weapon' as const,damage:18};placeItem(grid,weapon,0,0);
 player.aetherHeat=50;assert.equal(coolIntoItem(player,grid,weapon.id).heat,25);assert.equal(weapon.damage,16);assert.equal(player.hp,100);
 weapon.isSpoiled=true;assert.equal(coolIntoItem(player,grid,weapon.id).heat,0);assert.equal(player.aetherHeat,25);
 weapon.isSpoiled=false;player.aetherHeat=10;assert.equal(coolIntoItem(player,grid,weapon.id).heat,0);
});
test('пар даёт 4 урона без серой травмы одинаково при 30/144 Гц, повтор запрещён до рассеивания',()=>{
 for(const fps of [30,144]) {
  const player=createPlayer(),steam=createSteamState();player.aetherHeat=100;
  assert.equal(coolIntoWater(player,steam,4,5).heat,35);assert.equal(coolIntoWater(player,steam,4,5).heat,0);
  for(let i=0;i<5*fps;i++)tickSteamPoison(player,steam,1/fps);
  assert.equal(player.hp,96);assert.equal(player.greyHp,0);assert.equal(steam.remaining,0);assert.equal(steam.x,4);
 }
});
test('яд уважает паузу, сохранённый остаток и Нить Судьбы',()=>{
 const player=createPlayer(),steam=createSteamState();player.aetherHeat=50;coolIntoWater(player,steam,0,0);tickSteamPoison(player,steam,1.5);
 const copy={...steam};const hp=player.hp;for(const dt of [0,-1,NaN])tickSteamPoison(player,copy,dt);assert.equal(player.hp,hp);
 player.hp=1;player.threadsOfFate=1;assert.equal(tickSteamPoison(player,copy,0.5).fate,true);assert.equal(player.threadsOfFate,0);
 tickSteamPoison(player,copy,1);assert.equal(player.isDead,true);
});


test('Разлом восстанавливает стартовый катализатор, чужие реликвии не чинит',()=>{
 const grid=createInventory(),lens=libraryRelic(1);lens.durability=0;placeItem(grid,lens,0,0);
 assert.equal(rekindleStarterCatalyst(grid),false);
 const crystal={...lens,id:'fire_stone_starter',category:'rune' as const,element:'fire' as const,shape:[{x:0,y:0}],durability:0,maxDurability:12};placeItem(grid,crystal,4,0);
 assert.equal(rekindleStarterCatalyst(grid),true);assert.equal(crystal.durability,12);assert.equal(lens.durability,0);
 assert.equal(rekindleStarterCatalyst(grid),false);
});
