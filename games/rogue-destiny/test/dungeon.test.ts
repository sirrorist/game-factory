import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor, enterRoom, canUnlockMetroidvania } from '../src/core/dungeon.ts';
import { createPlayer } from '../src/core/player.ts';
import { createInventory, placeItem } from '../src/core/inventory.ts';
import type { InventoryItem } from '../src/core/types.ts';

test('генерация этажа создаёт граф со стартовой комнатой и Эфирным Разломом', () => {
  const floor = generateFloor(1);
  assert.equal(floor.rooms.length, 6);
  assert.ok(floor.rooms[0]);
  assert.equal(floor.rooms[0]!.hasAetherRift, true);
  assert.equal(floor.rooms[0]!.isRevealed, true);
  assert.ok(floor.connections.length >= 5);
});

test('вход в неисследованную комнату открывает её и расходует свет по прогрессу', () => {
  const floor = generateFloor(1);
  const p = createPlayer();
  assert.equal(p.lightSupply, 100);

  const res = enterRoom(floor, 'room_1', p);
  assert.equal(res.newlyRevealed, true);
  assert.equal(res.lightSpent, 15);
  assert.equal(p.lightSupply, 85); // 100 - 15 = 85

  // Повторный вход в уже открытую комнату не тратит свет
  const res2 = enterRoom(floor, 'room_1', p);
  assert.equal(res2.newlyRevealed, false);
  assert.equal(res2.lightSpent, 0);
  assert.equal(p.lightSupply, 85);
});

test('метроидвания-замки проверяют предметы инвентаря и знания Кодекса', () => {
  const inv = createInventory(4, 4);
  const codex = new Set<string>();

  // Замок: Терновые лозы (требует огонь)
  const brambleCheck1 = canUnlockMetroidvania('brambles', inv, codex);
  assert.equal(brambleCheck1.canUnlock, false);

  const fireTorch: InventoryItem = {
    id: 'torch',
    name: 'Факел',
    category: 'weapon',
    rarity: 'common',
    element: 'fire',
    shape: [{ x: 0, y: 0 }],
    weight: 1.0,
    rotation: 0,
  };
  placeItem(inv, fireTorch, 0, 0);

  const brambleCheck2 = canUnlockMetroidvania('brambles', inv, codex);
  assert.equal(brambleCheck2.canUnlock, true);

  // Замок: Рунический шифр (требует знание Кодекса)
  const cipherCheck1 = canUnlockMetroidvania('runeCipher', inv, codex);
  assert.equal(cipherCheck1.canUnlock, false);

  codex.add('sylvan_ciphers');
  const cipherCheck2 = canUnlockMetroidvania('runeCipher', inv, codex);
  assert.equal(cipherCheck2.canUnlock, true);
});
test('этажи различаются, но повторная загрузка номера восстанавливает карту', () => {
  assert.deepEqual(generateFloor(2), generateFloor(2));
  assert.notDeepEqual(generateFloor(2).rooms, generateFloor(3).rooms);
});
test('seed меняет карту партии и воспроизводится при загрузке', () => {
 assert.deepEqual(generateFloor(1,12345),generateFloor(1,12345));
 assert.notDeepEqual(generateFloor(1,12345).rooms,generateFloor(1,54321).rooms);
});
test('свиток разведки не отменяет расход света при первом посещении', () => {
 const f=generateFloor(1),p=createPlayer();const room=f.rooms.find(r=>r.id==='room_1')!;
 room.isRevealed=true;
 const first=enterRoom(f,room.id,p);assert.equal(first.newlyRevealed,false);assert.equal(first.lightSpent,15);assert.equal(p.lightSupply,85);
 assert.equal(enterRoom(f,room.id,p).lightSpent,0);
});
test('эфирный барьер и бездна требуют способности, а не открываются по умолчанию', () => {
 const inv=createInventory();
 assert.equal(canUnlockMetroidvania('elementalWard',inv,new Set()).canUnlock,false);
 assert.equal(canUnlockMetroidvania('elementalWard',inv,new Set(['elemental_ward'])).canUnlock,true);
 assert.equal(canUnlockMetroidvania('chasm',inv,new Set()).canUnlock,false);
 assert.equal(canUnlockMetroidvania('chasm',inv,new Set(['aether_step'])).canUnlock,true);
 assert.equal(canUnlockMetroidvania('illusionary',inv,new Set(['true_sight'])).canUnlock,true);
});

test('новые seed получают необязательный реликварий с разными преградами', () => {
 const locks=new Set<string>();
 for(let seed=1;seed<=6;seed++) {
  const floor=generateFloor(1,seed),vault=floor.rooms.find(room=>room.type==='vault')!;
  assert.ok(vault);assert.equal(vault.unlocked,undefined);locks.add(vault.lockType!);
  assert.ok(floor.connections.some(([a,b])=>a===vault.id||b===vault.id));
 }
 assert.equal(locks.size,6);assert.ok(!generateFloor(1).rooms.some(room=>room.type==='vault'));
});
test('инструменты имеют назначение, заражённые предметы не открывают пути', () => {
 const inv=createInventory();
 const tool: import('../src/core/types.ts').InventoryItem={id:'tool',name:'Крюк',category:'tool' as const,rarity:'rare' as const,element:'physical' as const,shape:[{x:0,y:0}],weight:1,rotation:0 as const,utility:'grapple' as const};
 placeItem(inv,tool,0,0);
 assert.equal(canUnlockMetroidvania('chasm',inv,new Set()).canUnlock,true);
 assert.equal(canUnlockMetroidvania('submerged',inv,new Set()).canUnlock,false);
 assert.equal(canUnlockMetroidvania('runeCipher',inv,new Set()).canUnlock,false);
 tool.isSpoiled=true;
 assert.equal(canUnlockMetroidvania('chasm',inv,new Set()).canUnlock,false);
});


import { refreshSoundGates } from '../src/core/dungeon.ts';
test('звуковая дверь закрывается с тяжёлым ранцем, но не запирает героя внутри', () => {
 const floor=generateFloor(1,3),room=floor.rooms.find(room=>room.type==='vault')!;
 room.lockType='soundTrap';room.unlocked=true;
 const inv=createInventory();
 placeItem(inv,{id:'heavy',name:'Груз',category:'tool',rarity:'common',element:'physical',shape:[{x:0,y:0}],weight:7,rotation:0},0,0);
 assert.deepEqual(refreshSoundGates(floor,inv,room.x,room.y),[]);assert.equal(room.unlocked,true);
 assert.deepEqual(refreshSoundGates(floor,inv,0,0),[room.id]);assert.equal(room.unlocked,false);
 assert.deepEqual(refreshSoundGates(floor,inv,0,0),[]);
});
