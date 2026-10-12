// Чистая логика сундуков, 14 предметов и их эффектов (DESIGN.md, разделы 3.5, 5.3, 7.6).
// Без Three.js и DOM. Проверяется в test/chests.test.ts (node:test).

import {
  type ItemConfig,
  type ItemId,
  type ItemRarity,
  ITEM_CONFIGS,
  ITEMS_BY_RARITY,
  CHEST_BASE_RATES,
  CLOVER_RARITY_MULTIPLIER,
  INITIAL_CHEST_COUNT,
  MAX_ACTIVE_CHESTS,
} from './content.ts';
import type { Obstacle } from './movement.ts';

export interface ChestEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  opened: boolean;
}

/**
 * Расчёт вероятностей редкостей с учётом эффекта Клевера (DESIGN.md, раздел 5.3).
 * Клевер: шансы сундука сдвигаются к редким (×1.5 для редкого и выше за каждый стак).
 */
export function calculateRarityWeights(cloverCount = 0): Record<ItemRarity, number> {
  if (cloverCount <= 0) {
    return { ...CHEST_BASE_RATES };
  }

  const mult = Math.pow(CLOVER_RARITY_MULTIPLIER, cloverCount);
  const rare = CHEST_BASE_RATES.rare * mult;
  const epic = CHEST_BASE_RATES.epic * mult;
  const legendary = CHEST_BASE_RATES.legendary * mult;
  const rarePlus = rare + epic + legendary;

  // Если редкие и выше превысили 95%, оставляем минимум 5% на обычные и нормируем
  if (rarePlus >= 0.95) {
    const scale = 0.95 / rarePlus;
    return {
      common: 0.05,
      rare: rare * scale,
      epic: epic * scale,
      legendary: legendary * scale,
    };
  }

  return {
    common: 1.0 - rarePlus,
    rare,
    epic,
    legendary,
  };
}

/**
 * Ролл редкости предмета по весам с использованием переданного PRNG.
 */
export function rollItemRarity(cloverCount = 0, rnd: () => number = Math.random): ItemRarity {
  const weights = calculateRarityWeights(cloverCount);
  const r = rnd();

  let cumulative = weights.common;
  if (r < cumulative) return 'common';

  cumulative += weights.rare;
  if (r < cumulative) return 'rare';

  cumulative += weights.epic;
  if (r < cumulative) return 'epic';

  return 'legendary';
}

/**
 * Выбор предмета из сундука.
 * По указанию владельца: по умолчанию все предметы складываются без жестких ограничений.
 * Параметр allowUnstackableDuplicates позволяет при необходимости включить замену нескладывающихся
 * предметов на обычные по ТЗ ("Предмет 'нет' при повторном выпадении заменяется обычным").
 */
export function rollChestItem(
  ownedItems: ReadonlyMap<ItemId, number> = new Map(),
  cloverCount = 0,
  rnd: () => number = Math.random,
  allowUnstackableDuplicates = true,
): ItemConfig {
  const rarity = rollItemRarity(cloverCount, rnd);
  const items = ITEMS_BY_RARITY[rarity];
  const picked = items[Math.floor(rnd() * items.length)]!;

  if (!allowUnstackableDuplicates && !picked.stackable && (ownedItems.get(picked.id) ?? 0) > 0) {
    // Заменяем повторный нескладывающийся предмет на случайный обычный
    const commonItems = ITEMS_BY_RARITY.common;
    return commonItems[Math.floor(rnd() * commonItems.length)]!;
  }

  return picked;
}

/**
 * Создание начального набора сундуков на арене (6 штук по умолчанию, DESIGN.md).
 * Размещаются на расстоянии 14..48 м от центра на холмах, не пересекая препятствия.
 */
export function createInitialChests(
  obstacles: readonly Obstacle[] = [],
  getGroundHeight: (x: number, z: number) => number = () => 0,
  rnd: () => number = Math.random,
  count = INITIAL_CHEST_COUNT,
  arenaRadius = 65,
): ChestEntity[] {
  const chests: ChestEntity[] = [];

  for (let i = 0; i < count; i++) {
    const chest = spawnSingleChest(i + 1, chests, obstacles, getGroundHeight, rnd, arenaRadius);
    chests.push(chest);
  }

  return chests;
}

/**
 * Вспомогательная функция спавна одного сундука с поиском валидной точки на карте.
 */
function spawnSingleChest(
  id: number,
  existingChests: readonly ChestEntity[],
  obstacles: readonly Obstacle[],
  getGroundHeight: (x: number, z: number) => number,
  rnd: () => number,
  arenaRadius: number,
): ChestEntity {
  let bestX = 0;
  let bestZ = 0;

  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = rnd() * Math.PI * 2;
    // Дистанция от центра 14..min(48, arenaRadius - 6)
    const maxR = Math.min(48, arenaRadius - 6);
    const dist = 14.0 + rnd() * (maxR - 14.0);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    // Проверяем удаление от препятствий (камни, деревья)
    let collides = false;
    for (const obs of obstacles) {
      if (Math.hypot(x - obs.x, z - obs.z) < obs.radius + 1.6) {
        collides = true;
        break;
      }
    }
    if (collides) continue;

    // Проверяем удаление от других существующих сундуков
    for (const ch of existingChests) {
      if (!ch.opened && Math.hypot(x - ch.x, z - ch.z) < 6.0) {
        collides = true;
        break;
      }
    }
    if (collides) continue;

    bestX = x;
    bestZ = z;
    break;
  }

  const y = getGroundHeight(bestX, bestZ);
  return {
    id,
    x: bestX,
    y,
    z: bestZ,
    radius: 0.85,
    opened: false,
  };
}

export interface StepChestsResult {
  nextSpawnMinute: number;
  spawnedChest: ChestEntity | null;
}

/**
 * Шаг симуляции сундуков: спавн +1 сундука каждую полную минуту забега до потолка 10 (DESIGN.md).
 */
export function stepChests(
  chests: ChestEntity[],
  runTimeSec: number,
  lastSpawnMinute: number,
  obstacles: readonly Obstacle[] = [],
  getGroundHeight: (x: number, z: number) => number = () => 0,
  rnd: () => number = Math.random,
  arenaRadius = 65,
): StepChestsResult {
  const currentMinute = Math.floor(Math.max(0, runTimeSec) / 60);

  if (currentMinute > lastSpawnMinute) {
    const activeCount = chests.filter((c) => !c.opened).length;
    if (activeCount < MAX_ACTIVE_CHESTS) {
      const nextId = chests.length + 1;
      const newChest = spawnSingleChest(nextId, chests, obstacles, getGroundHeight, rnd, arenaRadius);
      chests.push(newChest);
      return {
        nextSpawnMinute: currentMinute,
        spawnedChest: newChest,
      };
    }
    return {
      nextSpawnMinute: currentMinute,
      spawnedChest: null,
    };
  }

  return {
    nextSpawnMinute: lastSpawnMinute,
    spawnedChest: null,
  };
}

/**
 * Честная 3D-проверка подбора сундука героем (MISTAKES.md ERR-01).
 * Проверяется трёхмерное расстояние между центром героя и центром сундука.
 */
export function checkChestPickup(
  chests: ChestEntity[],
  heroX: number,
  heroY: number,
  heroZ: number,
  heroRadius = 0.45,
): ChestEntity | null {
  const heroCenterY = heroY + 0.45;

  for (const chest of chests) {
    if (chest.opened) continue;

    const chestCenterY = chest.y + 0.35;
    const dx = heroX - chest.x;
    const dy = heroCenterY - chestCenterY;
    const dz = heroZ - chest.z;
    const dist3D = Math.hypot(dx, dy, dz);

    if (dist3D <= chest.radius + heroRadius) {
      chest.opened = true;
      return chest;
    }
  }

  return null;
}

/**
 * Расчёт перезарядки щита Зеркальной коры с гиперболическим сжатием (DESIGN.md, раздел 5.3):
 * CD = 10.0 / (1.0 + 0.35 * (stacks - 1))
 * Хард-кап: не менее 3.0 с.
 */
export function getMirrorBarkCooldown(stacks: number): number {
  if (stacks <= 0) return 10.0;
  const cd = 10.0 / (1.0 + 0.35 * Math.max(0, stacks - 1));
  return Math.max(3.0, cd);
}

/**
 * Прогрессивный скейл бонуса урона Тотема ярости (rage_totem, DESIGN.md 5.3):
 * +25% за первый стак, +15% за каждый последующий стак при HP < 50%.
 */
export function getRageTotemBonus(rageCount: number): number {
  if (rageCount <= 0) return 0;
  return 0.25 + (rageCount - 1) * 0.15;
}

/**
 * Множитель скорости бега от Перьев стрижа (swift_feather, DESIGN.md 5.3):
 * +6% за стак до 8 стаков (+48%), свыше 8 стаков — +2% за стак.
 * Хард-кап: +80% к скорости бега (максимум ×1.80, т.е. 10.8 м/с при базе 6.0 м/с).
 */
export function getSwiftFeatherMultiplier(count: number): number {
  if (count <= 0) return 1.0;
  let bonus = 0;
  if (count <= 8) {
    bonus = count * 0.06;
  } else {
    bonus = 8 * 0.06 + (count - 8) * 0.02;
  }
  bonus = Math.min(0.80, bonus);
  return 1.0 + bonus;
}

/**
 * Множитель радиуса сбора от Магнитного камешка (magnet_pebble, DESIGN.md 5.3):
 * Базовый радиус героя: 2.5 м.
 * +20% за стак до 5 стаков (софт-кап 5.0 м, т.е. +100%).
 * Свыше 5 стаков — +5% за стак.
 * Хард-кап: 7.5 м (максимум ×3.0 к базовому радиусу, т.е. бонус +200%).
 */
export function getMagnetPebbleMultiplier(count: number): number {
  if (count <= 0) return 1.0;
  let bonus = 0;
  if (count <= 5) {
    bonus = count * 0.20;
  } else {
    bonus = 5 * 0.20 + (count - 5) * 0.05;
  }
  bonus = Math.min(2.0, bonus);
  return 1.0 + bonus;
}

/**
 * Суммированные бонусы от всех 14 предметов для применения в бою, движении и HUD.
 */
export interface ItemStatBonuses {
  maxHpBonus: number;
  speedMultiplier: number;
  pickupRadiusMultiplier: number;
  regenHpPerSec: number;
  critChance: number;
  damageMultiplier: number;
  healOnKill: number;
  airJumps: number;
  cloverCount: number;
  hasMirrorBark: boolean;
  mirrorBarkCooldown: number;
  hasNinthTail: boolean;
  phoenixDownCharges: number;
  stormBeadCount: number;
}

export function getItemStatBonuses(
  items: ReadonlyMap<ItemId, number>,
  heroMaxHp = 100,
  heroHp = 100,
): ItemStatBonuses {
  const acornCount = items.get('acorn') ?? 0;
  const featherCount = items.get('swift_feather') ?? 0;
  const pebbleCount = items.get('magnet_pebble') ?? 0;
  const burdockCount = items.get('burdock') ?? 0;
  const pawCount = items.get('lucky_paw') ?? 0;
  const fangCount = items.get('fang') ?? 0;
  const honeycombCount = items.get('honeycomb') ?? 0;
  const bootsCount = items.get('spring_boots') ?? 0;
  const rageCount = items.get('rage_totem') ?? 0;
  const stormCount = items.get('storm_bead') ?? 0;
  const mirrorCount = items.get('mirror_bark') ?? 0;
  const cloverCount = items.get('four_leaf') ?? 0;
  const ninthTailCount = items.get('ninth_tail') ?? 0;
  const phoenixCount = items.get('phoenix_down') ?? 0;

  // Базовый множитель урона: Клык (+15% за стак)
  let dmgMult = 1.0 + fangCount * 0.15;
  // Тотем ярости: прогрессивный скейл при здоровье ниже 50% (+25% за 1-й стак, +15% далее)
  if (rageCount > 0 && heroHp < heroMaxHp * 0.5) {
    dmgMult += getRageTotemBonus(rageCount);
  }

  const mirrorBarkCooldown = getMirrorBarkCooldown(mirrorCount);

  return {
    maxHpBonus: acornCount * 10,
    speedMultiplier: getSwiftFeatherMultiplier(featherCount),
    pickupRadiusMultiplier: getMagnetPebbleMultiplier(pebbleCount),
    regenHpPerSec: burdockCount * 0.4,
    critChance: pawCount * 0.05,
    damageMultiplier: dmgMult,
    healOnKill: honeycombCount * 2,
    airJumps: bootsCount,
    cloverCount,
    hasMirrorBark: mirrorCount > 0,
    mirrorBarkCooldown,
    hasNinthTail: ninthTailCount > 0,
    phoenixDownCharges: phoenixCount,
    stormBeadCount: stormCount,
  };
}
