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
