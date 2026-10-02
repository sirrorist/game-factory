import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInventory,
  placeItem,
  removeItem,
  canPlaceItem,
  calculateInventoryStats,
  scrollFusion,
  getRotatedCoords,
} from '../src/core/inventory.ts';
import type { InventoryItem } from '../src/core/types.ts';

test('создание инвентаря задаёт корректные размеры и пустые ячейки', () => {
  const inv = createInventory(4, 4);
  assert.equal(inv.width, 4);
  assert.equal(inv.height, 4);
  assert.equal(inv.slots.length, 16);
  assert.equal(inv.items.size, 0);
});

test('размещение предметов проверяет границы сетки и занятые ячейки', () => {
  const inv = createInventory(4, 4);
  const sword: InventoryItem = {
    id: 'sword_1',
    name: 'Рунный меч',
    category: 'weapon',
    rarity: 'common',
    element: 'physical',
    shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }], // 1x2 вертикально
    weight: 3.5,
    rotation: 0,
    damage: 15,
  };

  assert.equal(canPlaceItem(inv, sword, 0, 0), true);
  assert.equal(placeItem(inv, sword, 0, 0), true);
  assert.equal(inv.items.size, 1);

  // Нельзя положить другой предмет поверх занятой ячейки
  const shield: InventoryItem = {
    id: 'shield_1',
    name: 'Ветхий щит',
    category: 'shield',
    rarity: 'common',
    element: 'physical',
    shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    weight: 4.0,
    rotation: 0,
    defense: 8,
  };

  assert.equal(canPlaceItem(inv, shield, 0, 0), false);
  assert.equal(canPlaceItem(inv, shield, 1, 0), true);
  assert.equal(placeItem(inv, shield, 1, 0), true);

  // Выход за границы
  assert.equal(canPlaceItem(inv, shield, 3, 3), false);

  // Удаление предмета
  assert.equal(removeItem(inv, 'sword_1'), true);
  assert.equal(inv.items.size, 1);
  assert.equal(canPlaceItem(inv, sword, 0, 0), true);
});

test('расчёт характеристик инвентаря определяет вес и резонанс огня с клинком', () => {
  const inv = createInventory(5, 5);

  const sword: InventoryItem = {
    id: 'blade',
    name: 'Клинок',
    category: 'weapon',
    rarity: 'common',
    element: 'physical',
    shape: [{ x: 0, y: 0 }],
    weight: 2.0,
    rotation: 0,
    damage: 10,
  };

  const fireStone: InventoryItem = {
    id: 'fire_stone',
    name: 'Огненный кристалл',
    category: 'rune',
    rarity: 'rare',
    element: 'fire',
    shape: [{ x: 0, y: 0 }],
    weight: 1.0,
    rotation: 0,
  };

  placeItem(inv, sword, 1, 1);
  placeItem(inv, fireStone, 2, 1); // сосед справа

  const stats = calculateInventoryStats(inv);
  assert.equal(stats.totalWeight, 3.0);
  assert.equal(stats.weightClass, 'light');
  assert.equal(stats.bonusFireDamage, 6); // Резонанс огня активирован!
});

test('слияние свитков объединяет совместимые стихии в составное заклинание', () => {
  const fireScroll: InventoryItem = {
    id: 's_fire',
    name: 'Свиток Искр',
    category: 'scroll',
    rarity: 'common',
    element: 'fire',
    shape: [{ x: 0, y: 0 }],
    weight: 0.5,
    rotation: 0,
  };

  const poisonScroll: InventoryItem = {
    id: 's_poison',
    name: 'Свиток Токсина',
    category: 'scroll',
    rarity: 'common',
    element: 'poison',
    shape: [{ x: 0, y: 0 }],
    weight: 0.5,
    rotation: 0,
  };

  const fused = scrollFusion(fireScroll, poisonScroll);
  assert.ok(fused);
  assert.equal(fused.name, 'Свиток Чумного Пламени');
  assert.equal(fused.damage, 35);
});

test('вращение предметов нормализует координаты для 0, 90, 180 и 270 градусов', () => {
  // L-образная фигура из 3 клеток: [0,0], [0,1], [1,1]
  const lShape = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];

  const rot0 = getRotatedCoords(lShape, 0);
  assert.deepEqual(rot0, [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);

  const rot90 = getRotatedCoords(lShape, 90);
  // При 90 градусах координаты нормализованы и все >= 0
  for (const c of rot90) {
    assert.ok(c.x >= 0 && c.y >= 0);
  }
  assert.equal(rot90.length, 3);

  const rot180 = getRotatedCoords(lShape, 180);
  for (const c of rot180) {
    assert.ok(c.x >= 0 && c.y >= 0);
  }

  const rot270 = getRotatedCoords(lShape, 270);
  for (const c of rot270) {
    assert.ok(c.x >= 0 && c.y >= 0);
  }
});
