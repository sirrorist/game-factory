import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRarityWeights,
  rollItemRarity,
  rollChestItem,
  createInitialChests,
  stepChests,
  checkChestPickup,
  getItemStatBonuses,
} from '../src/core/chests.ts';
import {
  ITEM_CONFIGS,
  ALL_ITEM_IDS,
  ITEMS_BY_RARITY,
  type ItemId,
  type ItemRarity,
} from '../src/core/content.ts';
import {
  createInitialCombatState,
  stepCombat,
  killMob,
} from '../src/core/combat.ts';

/** Детерминированный LCG PRNG для воспроизводимости тестов Монте-Карло */
function createLcg(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Сундуки и 14 предметов (DESIGN.md, разделы 5.3, 7.6, 8)', () => {
  it('реестр содержит ровно 14 предметов с корректным распределением по редкостям', () => {
    assert.equal(ALL_ITEM_IDS.length, 14, 'Всего должно быть ровно 14 предметов');

    assert.equal(ITEMS_BY_RARITY.common.length, 5, 'Обычных предметов: 5');
    assert.equal(ITEMS_BY_RARITY.rare.length, 4, 'Редких предметов: 4');
    assert.equal(ITEMS_BY_RARITY.epic.length, 3, 'Очень редких предметов: 3');
    assert.equal(ITEMS_BY_RARITY.legendary.length, 2, 'Легендарных предметов: 2');

    // Проверяем наличие всех ключевых предметов
    assert.ok(ITEM_CONFIGS.acorn, 'Жёлудь присутствует');
    assert.ok(ITEM_CONFIGS.four_leaf, 'Клевер присутствует');
    assert.ok(ITEM_CONFIGS.spring_boots, 'Пружинные башмаки присутствуют');
    assert.ok(ITEM_CONFIGS.ninth_tail, 'Девятый хвост присутствует');
    assert.ok(ITEM_CONFIGS.phoenix_down, 'Пух феникса присутствует');
  });

  it('распределение редкости на 10 000 бросков в пределах ±1.5 % (ТЗ приёмка)', () => {
    const prng = createLcg(1337);
    const rolls = 10_000;
    const counts: Record<ItemRarity, number> = {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };

    for (let i = 0; i < rolls; i++) {
      const rarity = rollItemRarity(0, prng);
      counts[rarity]++;
    }

    const commonPct = (counts.common / rolls) * 100;
    const rarePct = (counts.rare / rolls) * 100;
    const epicPct = (counts.epic / rolls) * 100;
    const legPct = (counts.legendary / rolls) * 100;

    // Базовые веса ТЗ: 62% / 26% / 10% / 2% (допуск ±1.5%)
    assert.ok(
      Math.abs(commonPct - 62.0) <= 1.5,
      `Обычные: ${commonPct.toFixed(2)}% ожидалось 62% ±1.5%`,
    );
    assert.ok(
      Math.abs(rarePct - 26.0) <= 1.5,
      `Редкие: ${rarePct.toFixed(2)}% ожидалось 26% ±1.5%`,
    );
    assert.ok(
      Math.abs(epicPct - 10.0) <= 1.5,
      `Очень редкие: ${epicPct.toFixed(2)}% ожидалось 10% ±1.5%`,
    );
    assert.ok(
      Math.abs(legPct - 2.0) <= 1.5,
      `Легендарные: ${legPct.toFixed(2)}% ожидалось 2% ±1.5%`,
    );
  });

  it('Клевер сдвигает шансы: ×1.5 для редкого и выше на 10 000 бросков в пределах ±1.5 %', () => {
    const prng = createLcg(9999);
    const rolls = 10_000;
    const counts: Record<ItemRarity, number> = {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };

    // 1 Клевер: rare: 26% * 1.5 = 39%, epic: 10% * 1.5 = 15%, legendary: 2% * 1.5 = 3%, common: 43%
    for (let i = 0; i < rolls; i++) {
      const rarity = rollItemRarity(1, prng);
      counts[rarity]++;
    }

    const commonPct = (counts.common / rolls) * 100;
    const rarePct = (counts.rare / rolls) * 100;
    const epicPct = (counts.epic / rolls) * 100;
    const legPct = (counts.legendary / rolls) * 100;

    assert.ok(
      Math.abs(commonPct - 43.0) <= 1.5,
      `Клевер common: ${commonPct.toFixed(2)}% ожидалось 43% ±1.5%`,
    );
    assert.ok(
      Math.abs(rarePct - 39.0) <= 1.5,
      `Клевер rare: ${rarePct.toFixed(2)}% ожидалось 39% ±1.5%`,
    );
    assert.ok(
      Math.abs(epicPct - 15.0) <= 1.5,
      `Клевер epic: ${epicPct.toFixed(2)}% ожидалось 15% ±1.5%`,
    );
    assert.ok(
      Math.abs(legPct - 3.0) <= 1.5,
      `Клевер legendary: ${legPct.toFixed(2)}% ожидалось 3% ±1.5%`,
    );
  });

  it('неповторяемые предметы: замена на обычный при включенном правиле ограничения', () => {
    const owned = new Map<ItemId, number>();
    owned.set('spring_boots', 1);

    // Принудительно генерируем ролл пружинных башмаков
    // Если allowUnstackableDuplicates = false, предмет должен быть заменен на обычный
    const prng = createLcg(123);
    for (let i = 0; i < 50; i++) {
      const item = rollChestItem(owned, 0, prng, false);
      if (item.id === 'spring_boots') {
        assert.fail('Пружинные башмаки не должны выпасть повторно при запрете дубликатов');
      }
    }
  });

  it('спавн сундуков: 6 на старте, +1 в минуту, максимум 10 одновременно', () => {
    const prng = createLcg(777);
    const initialChests = createInitialChests([], () => 0, prng, 6, 65);
    assert.equal(initialChests.length, 6, 'На старте должно быть ровно 6 сундуков');
    assert.equal(initialChests.every((c) => !c.opened), true, 'Все стартовые сундуки закрыты');

    // Проверяем координаты стартовых сундуков (в радиусе 14..50 м)
    for (const c of initialChests) {
      const dist = Math.hypot(c.x, c.z);
      assert.ok(dist >= 13.9 && dist <= 50.0, `Сундук #${c.id} в радиусе арены: ${dist.toFixed(1)} м`);
    }

    // Симулируем течение времени: на 60 сек (1-я минута) спавнится 7-й сундук
    let stepRes = stepChests(initialChests, 60.1, 0, [], () => 0, prng, 65);
    assert.equal(stepRes.nextSpawnMinute, 1);
    assert.ok(stepRes.spawnedChest !== null, 'Должен появиться 7-й сундук на 1:00');
    assert.equal(initialChests.length, 7);

    // До 2:00 сундуки не должны добавляться
    stepRes = stepChests(initialChests, 110.0, 1, [], () => 0, prng, 65);
    assert.equal(stepRes.spawnedChest, null);
    assert.equal(initialChests.length, 7);

    // Симулируем достижение лимита 10 сундуков
    for (let m = 2; m <= 6; m++) {
      stepChests(initialChests, m * 60 + 0.1, m - 1, [], () => 0, prng, 65);
    }
    assert.equal(initialChests.length, 10, 'Должно быть ровно 10 сундуков');

    // На 7-й минуте сундук не добавляется, так как достигнут потолок 10
    stepRes = stepChests(initialChests, 420.1, 6, [], () => 0, prng, 65);
    assert.equal(stepRes.spawnedChest, null, 'Потолок 10 не должен превышаться');
    assert.equal(initialChests.length, 10);
  });

  it('3D-подбор сундука с учётом Y-координаты и высоты прыжка (MISTAKES.md ERR-01)', () => {
    const chests = [
      { id: 1, x: 10, y: 0, z: 10, radius: 0.85, opened: false },
    ];

    // 1. Герой находится далеко по X/Z -> сундук не подбирается
    let picked = checkChestPickup(chests, 0, 0, 0, 0.45);
    assert.equal(picked, null);
    assert.equal(chests[0]!.opened, false);

    // 2. Герой подошёл вплотную в 3D (x=10, z=10, y=0) -> успешный подбор
    picked = checkChestPickup(chests, 10, 0, 10, 0.45);
    assert.ok(picked !== null, 'Сундук должен быть подобран');
    assert.equal(picked.id, 1);
    assert.equal(chests[0]!.opened, true);

    // 3. Другой сундук: герой над ним высоко в воздухе в прыжке (y = 4.0 м при высоте сундука y=0)
    const aerialChests = [
      { id: 2, x: 20, y: 0, z: 20, radius: 0.85, opened: false },
    ];
    // Высота центра лиса в прыжке: 4.0 + 0.45 = 4.45 м. Центр сундука: 0.35 м. dy = 4.1 м > 1.3 м.
    picked = checkChestPickup(aerialChests, 20, 4.0, 20, 0.45);
    assert.equal(
      picked,
      null,
      'Сундук не должен подбираться, если герой перепрыгнул высоко над ним (ERR-01)',
    );
    assert.equal(aerialChests[0]!.opened, false);
  });

  it('расчёт бонусов характеристик от собранных предметов (getItemStatBonuses)', () => {
    const items = new Map<ItemId, number>();
    items.set('acorn', 3);          // +30 HP
    items.set('swift_feather', 2);  // +12% к скорости
    items.set('magnet_pebble', 2);  // +40% к радиусу подбора
    items.set('burdock', 1);        // +0.4 HP/s
    items.set('lucky_paw', 2);      // +10% шанс крита
    items.set('fang', 2);           // +30% к урону
    items.set('rage_totem', 1);     // +25% при HP < 50%
    items.set('honeycomb', 1);      // +2 HP за килл
    items.set('spring_boots', 1);   // +1 прыжок в воздухе

    // Случай 1: здоровье лиса полное (100 / 100) -> Тотем ярости не активен
    let bonuses = getItemStatBonuses(items, 100, 100);
    assert.equal(bonuses.maxHpBonus, 30);
    assert.equal(Math.round(bonuses.speedMultiplier * 100), 112);
    assert.equal(Math.round(bonuses.pickupRadiusMultiplier * 100), 140);
    assert.equal(bonuses.regenHpPerSec, 0.4);
    assert.equal(bonuses.critChance, 0.10);
    assert.equal(Math.round(bonuses.damageMultiplier * 100), 130);
    assert.equal(bonuses.healOnKill, 2);
    assert.equal(bonuses.airJumps, 1);

    // Случай 2: здоровье лиса ниже половины (40 / 100) -> Тотем ярости активирует +25% к урону
    bonuses = getItemStatBonuses(items, 100, 40);
    assert.equal(Math.round(bonuses.damageMultiplier * 100), 155, 'Урон с Тотемом ярости: 130% + 25% = 155%');
  });

  it('эффекты выживаемости: Лопух (реген), Соты (хил за килл), Зеркальная кора (щит), Пух феникса (воскрешение)', () => {
    // 1. Лопух (burdock): регенерация 0.4 HP/с (проверяем 1.0 с через 20 тиков по safeDt = 0.05 с)
    const cState = createInitialCombatState();
    cState.heroHp = 50;
    cState.heroMaxHp = 100;
    cState.regenHpPerSec = 10.0; // 10 HP/c

    for (let i = 0; i < 20; i++) {
      stepCombat(cState, 0, 0, 0, 0.05);
    }
    assert.equal(Math.round(cState.heroHp), 60, 'Здоровье восстановилось на 10 HP за 1.0 с (20 тиков)');

    // 2. Соты (honeycomb): +2 HP за убийство моба
    cState.healOnKill = 2;
    cState.mobs.push({
      id: 100,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0,
      hp: 1,
      maxHp: 18,
      speed: 2,
      radius: 0.5,
      damage: 5,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 1,
    });
    killMob(cState, 100);
    assert.equal(Math.round(cState.heroHp), 62, 'Здоровье увеличилось на +2 HP при убийстве моба');

    // 3. Зеркальная кора (mirror_bark): снятие одного удара целиком раз в 10 с
    cState.hasMirrorBark = true;
    cState.mirrorBarkReady = true;
    cState.mobs.push({
      id: 101,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0,
      hp: 18,
      maxHp: 18,
      speed: 2,
      radius: 0.5,
      damage: 25, // смертельный для 62 HP удар в 25 урона
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 1,
    });
    const resShield = stepCombat(cState, 0, 0, 0, 0.016);
    assert.equal(resShield.shieldBlocked, true, 'Удар заблокирован щитом');
    assert.equal(Math.round(cState.heroHp), 62, 'Здоровье не уменьшилось благодаря щиту');
    assert.equal(cState.mirrorBarkReady, false, 'Щит ушёл на перезарядку');

    // 4. Пух феникса (phoenix_down): воскрешение с 50% здоровья при смертельном уроне (ERR-08)
    cState.mobs = [];
    cState.heroIFrameSec = 0;
    cState.regenHpPerSec = 0;
    cState.phoenixDownCharges = 2;
    cState.heroHp = 10;
    cState.mobs.push({
      id: 102,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0,
      hp: 18,
      maxHp: 18,
      speed: 2,
      radius: 0.5,
      damage: 20, // больше чем текущие 10 HP
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 1,
    });
    const resRevive = stepCombat(cState, 0, 0, 0, 0.016);
    assert.equal(resRevive.revivedByPhoenix, true, 'Сработало первое воскрешение Феникса');
    assert.equal(cState.heroHp, 50, 'Здоровье восстановлено до 50% от максимального (100)');
    assert.equal(cState.phoenixDownCharges, 1, 'Израсходован ровно 1 заряд из 2');
    assert.equal(cState.heroIFrameSec, 2.0, 'Дано 2.0 с неуязвимости');

    // Второе смертельное ранение расходует последний заряд
    cState.heroIFrameSec = 0;
    cState.heroHp = 10;
    cState.mobs = [{
      id: 103,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0,
      hp: 18,
      maxHp: 18,
      speed: 2,
      radius: 0.5,
      damage: 20,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 1,
    }];
    const resRevive2 = stepCombat(cState, 0, 0, 0, 0.016);
    assert.equal(resRevive2.revivedByPhoenix, true, 'Сработало второе воскрешение Феникса');
    assert.equal(cState.phoenixDownCharges, 0, 'Все заряды израсходованы');
  });

  it('девятый хвост (ninth_tail): каждая 5-я атака выпускает огненную волну', () => {
    const cState = createInitialCombatState();
    cState.hasNinthTail = true;

    // Спавним 2 грибышей в радиусе 3 м
    cState.mobs.push(
      {
        id: 201,
        type: 'mushlet',
        x: 2.0,
        y: 0,
        z: 0,
        hp: 100,
        maxHp: 100,
        speed: 0,
        radius: 0.5,
        damage: 0,
        exp: 1,
        state: 'walk',
        stateTimer: 0,
        chargeDirX: 0,
        chargeDirZ: 0,
        shootCooldown: 10,
      },
      {
        id: 202,
        type: 'mushlet',
        x: -2.0,
        y: 0,
        z: 0,
        hp: 100,
        maxHp: 100,
        speed: 0,
        radius: 0.5,
        damage: 0,
        exp: 1,
        state: 'walk',
        stateTimer: 0,
        chargeDirX: 0,
        chargeDirZ: 0,
        shootCooldown: 10,
      },
    );

    // Выполняем 4 атаки оружием
    cState.weapons[0]!.cooldownTimer = 0;
    stepCombat(cState, 0, 0, 0, 0.016); // 1-я атака
    assert.equal(cState.ninthTailAttackCount, 1);

    cState.weapons[0]!.cooldownTimer = 0;
    stepCombat(cState, 0, 0, 0, 0.016); // 2-я атака
    cState.weapons[0]!.cooldownTimer = 0;
    stepCombat(cState, 0, 0, 0, 0.016); // 3-я атака
    cState.weapons[0]!.cooldownTimer = 0;
    stepCombat(cState, 0, 0, 0, 0.016); // 4-я атака
    assert.equal(cState.ninthTailAttackCount, 4);

    // 5-я атака вызывает огненную волну (атака 'ninth_tail' с уроном 45)
    cState.weapons[0]!.cooldownTimer = 0;
    const res5 = stepCombat(cState, 0, 0, 0, 0.016);
    assert.equal(cState.ninthTailAttackCount, 0, 'Счётчик атак сбросился');
    const waveEvent = res5.attacks.find((a: any) => a.weaponId === 'ninth_tail');
    assert.ok(waveEvent, 'Событие огненной волны зафиксировано');
    assert.equal(waveEvent.hits, 2, 'Огненная волна поразила обоих врагов вокруг лиса');
  });
});

