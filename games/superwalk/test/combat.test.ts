import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDamage,
  getWaveTargetCount,
  getAvailableMobTypes,
  spawnMobInRing,
  createInitialCombatState,
  stepCombat,
  killMob,
} from '../src/core/combat.ts';
import {
  getRequiredExp,
  getMobHpMultiplier,
} from '../src/core/content.ts';

describe('Боевая система и мобы (DESIGN.md, раздел 5 и 7)', () => {
  it('формула урона: (база + уровень + сила) × множители предметов × крит', () => {
    // 1. Базовый удар без предметов и крита: 14 + 0 + 0 = 14
    const dmg1 = calculateDamage({
      baseDamage: 14,
      weaponLevelBonus: 0,
      mightTomeBonus: 0,
      itemDamageMultiplier: 1.0,
      isCrit: false,
    });
    assert.equal(dmg1, 14);

    // 2. С уровнем оружия (+4) и фолиантом силы (+3): (14 + 4 + 3) * 1.0 = 21
    const dmg2 = calculateDamage({
      baseDamage: 14,
      weaponLevelBonus: 4,
      mightTomeBonus: 3,
      itemDamageMultiplier: 1.0,
      isCrit: false,
    });
    assert.equal(dmg2, 21);

    // 3. С предметом Клык (+15% к урону): 21 * 1.15 = 24.15 -> 24
    const dmg3 = calculateDamage({
      baseDamage: 14,
      weaponLevelBonus: 4,
      mightTomeBonus: 3,
      itemDamageMultiplier: 1.15,
      isCrit: false,
    });
    assert.equal(dmg3, 24);

    // 4. С критическим ударом (крит ×2): 24.15 * 2 = 48.3 -> 48
    const dmgCrit = calculateDamage({
      baseDamage: 14,
      weaponLevelBonus: 4,
      mightTomeBonus: 3,
      itemDamageMultiplier: 1.15,
      isCrit: true,
    });
    assert.equal(dmgCrit, 48);
  });

  it('спавн кольцом строго в диапазоне 18..24 м от героя', () => {
    const state = createInitialCombatState();
    let pseudoSeed = 1;
    const rnd = () => {
      pseudoSeed = (pseudoSeed * 16807) % 2147483647;
      return (pseudoSeed - 1) / 2147483646;
    };

    const heroX = 10.0;
    const heroZ = -15.0;

    for (let i = 0; i < 50; i++) {
      const mob = spawnMobInRing(state, heroX, heroZ, 'mushlet', 0, rnd);
      const dist = Math.hypot(mob.x - heroX, mob.z - heroZ);
      assert.ok(
        dist >= 17.99 && dist <= 24.01,
        `Моб заспавнен на дистанции ${dist.toFixed(2)} м (ожидалось 18..24 м)`,
      );
    }
  });

  it('состав волн и расписание по минутам забега', () => {
    // 0:00 - 2:00: только грибыши, цель растет от 20 до 40
    const types1m = getAvailableMobTypes(60);
    assert.deepEqual(types1m, ['mushlet']);
    const count1m = getWaveTargetCount(60);
    assert.ok(count1m >= 20 && count1m <= 40, `Цель на 1:00 = ${count1m}`);

    // 2:00 - 4:00: грибыши + жуки, цель 40 -> 70
    const types3m = getAvailableMobTypes(180);
    assert.deepEqual(types3m, ['mushlet', 'ram_beetle']);
    const count3m = getWaveTargetCount(180);
    assert.ok(count3m >= 40 && count3m <= 70, `Цель на 3:00 = ${count3m}`);

    // 4:00 - 8:00: грибыши + жуки + совёнки, цель 70 -> 120
    const types5m = getAvailableMobTypes(300);
    assert.deepEqual(types5m, ['mushlet', 'ram_beetle', 'spit_owl']);
    const count5m = getWaveTargetCount(300);
    assert.ok(count5m >= 70 && count5m <= 120, `Цель на 5:00 = ${count5m}`);

    // Потолок на таче (<= 80)
    const countTouch = getWaveTargetCount(400, true);
    assert.ok(countTouch <= 80, `Потолок на таче превышен: ${countTouch}`);
  });

  it('здоровье мобов масштабируется на +10% каждую полную минуту', () => {
    // 0 мин: x1.0
    assert.equal(getMobHpMultiplier(45), 1.0);
    // 1 мин: x1.10
    assert.ok(Math.abs(getMobHpMultiplier(70) - 1.10) < 1e-4);
    // 2 мин: 1.10 * 1.10 = 1.21
    assert.ok(Math.abs(getMobHpMultiplier(130) - 1.21) < 1e-4);
    // 3 мин: 1.21 * 1.10 = 1.331
    assert.ok(Math.abs(getMobHpMultiplier(190) - 1.331) < 1e-4);
  });

  it('кривая опыта N: 5 + (N - 1) * 4 и повышение уровня', () => {
    assert.equal(getRequiredExp(1), 5);
    assert.equal(getRequiredExp(2), 9);
    assert.equal(getRequiredExp(3), 13);
    assert.equal(getRequiredExp(5), 21);
    assert.equal(getRequiredExp(10), 41);

    const state = createInitialCombatState();
    // Спавним кристалл опыта ценностью 5 рядом с героем (в радиусе магнита)
    state.gems.push({
      id: 1,
      x: 1.0,
      y: 0,
      z: 0,
      value: 5,
      type: 'large',
      flying: false,
    });

    // 1 секунда шага симуляции притянет кристалл
    let leveled = false;
    for (let i = 0; i < 30; i++) {
      const res = stepCombat(state, 0, 0, 0, 1 / 30, 2.5);
      if (res.leveledUp) leveled = true;
    }

    assert.ok(leveled, 'Герой не получил уровень от 5 опыта');
    assert.equal(state.heroLevel, 2);
    assert.equal(state.heroExp, 0); // 5 - 5 = 0
  });

  it('убийство моба роняет кристалл опыта на его координатах', () => {
    const state = createInitialCombatState();
    const mob = spawnMobInRing(state, 0, 0, 'ram_beetle', 0, () => 0.5);
    const mx = mob.x;
    const mz = mob.z;

    const killed = killMob(state, mob.id);
    assert.ok(killed);
    assert.equal(state.mobs.length, 0);
    assert.equal(state.kills, 1);
    assert.equal(state.gems.length, 1);
    assert.equal(state.gems[0]!.value, 2); // ram_beetle даёт 2 опыта
    assert.equal(state.gems[0]!.x, mx);
    assert.equal(state.gems[0]!.z, mz);
  });

  it('автоатака tail_blade бьет мобов сзади лиса (120°, 2.8 м на ур. 1) и кольцом 360° на ур. 5', () => {
    const state = createInitialCombatState();
    // Лис смотрит в -Z (facingYaw = 0). Хвост бьет сзади (+Z).
    // Моб 1: сзади лиса на z = +2.0 м (внутри 2.8 м и сектора 120° сзади)
    const backMob = {
      id: state.nextMobId++,
      type: 'mushlet' as const,
      x: 0,
      y: 0,
      z: 2.0,
      hp: 18,
      maxHp: 18,
      speed: 2.6,
      radius: 0.45,
      damage: 6,
      exp: 1,
      state: 'walk' as const,
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 2.0,
    };
    // Моб 2: перед лисом на z = -2.0 м (вне сектора 120° сзади на ур. 1)
    const frontMob = {
      id: state.nextMobId++,
      type: 'mushlet' as const,
      x: 0,
      y: 0,
      z: -2.0,
      hp: 18,
      maxHp: 18,
      speed: 2.6,
      radius: 0.45,
      damage: 6,
      exp: 1,
      state: 'walk' as const,
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 2.0,
    };
    state.mobs.push(backMob, frontMob);

    // Взмах хвостом готов (cooldownTimer <= 0)
    state.weapons[0]!.cooldownTimer = 0;

    // Шаг симуляции на ур. 1
    const res = stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(res.attacks.length, 1);
    assert.equal(res.attacks[0]!.hits, 1, 'На ур. 1 должен быть поражен ровно 1 моб сзади');
    assert.equal(backMob.hp, 4, 'Задний моб получил 14 урона (18 - 14 = 4)');
    assert.equal(frontMob.hp, 18, 'Передний моб не должен получить урон на ур. 1');

    // На ур. 5 дуга атаки = 360° (кольцо)
    state.weapons[0]!.level = 5;
    state.weapons[0]!.cooldownTimer = 0;
    backMob.hp = 18;
    frontMob.hp = 18;

    const res5 = stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(res5.attacks.length, 1);
    assert.equal(res5.attacks[0]!.hits, 2, 'На ур. 5 кольцо 360° должно поразить обоих мобов');
    assert.ok(backMob.hp < 18 && frontMob.hp < 18, 'Оба моба должны получить урон кольцом');
  });

  it('деспавн удаляет мобов, оказавшихся дальше 45 м от героя', () => {
    const state = createInitialCombatState();
    state.mobs.push({
      id: 99,
      type: 'mushlet',
      x: 50.0,
      y: 0,
      z: 0,
      hp: 18,
      maxHp: 18,
      speed: 2.6,
      radius: 0.45,
      damage: 6,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 2.0,
    });
    assert.equal(state.mobs.length, 1);

    stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(state.mobs.length, 0, 'Моб на расстоянии 50 м должен быть деспавнен');
  });

  it('автоатака spark_sling находит ближайшего врага в 16 м и выпускает снаряды', () => {
    const state = createInitialCombatState();
    state.weapons = [
      {
        id: 'spark_sling',
        level: 1,
        cooldownTimer: 0,
      },
    ];

    // Моб 1 на расстоянии 5 м
    const closeMob = {
      id: 10,
      type: 'mushlet' as const,
      x: 5.0,
      y: 0,
      z: 0,
      hp: 18,
      maxHp: 18,
      speed: 2.6,
      radius: 0.45,
      damage: 6,
      exp: 1,
      state: 'walk' as const,
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 2.0,
    };
    // Моб 2 на расстоянии 12 м
    const farMob = {
      id: 11,
      type: 'mushlet' as const,
      x: 12.0,
      y: 0,
      z: 0,
      hp: 18,
      maxHp: 18,
      speed: 2.6,
      radius: 0.45,
      damage: 6,
      exp: 1,
      state: 'walk' as const,
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 2.0,
    };
    state.mobs.push(closeMob, farMob);

    // 1 шаг симуляции: выстрел в ближайшего (closeMob)
    const res = stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(res.attacks.length, 1);
    assert.equal(res.attacks[0]!.weaponId, 'spark_sling');
    assert.equal(state.heroProjectiles.length, 1);
    assert.ok(state.heroProjectiles[0]!.vx > 20.0, 'Снаряд должен лететь в сторону +X к closeMob');

    // Симулируем полёт снаряда до попадания (5 м / 22 м/с ≈ 0.23 с)
    for (let i = 0; i < 10; i++) {
      stepCombat(state, 0, 0, 0, 0.03, 0);
    }

    // Снаряд должен поразить closeMob и нанести 9 урона (18 - 9 = 9)
    assert.equal(closeMob.hp, 9);
    assert.equal(farMob.hp, 18);
  });

  it('spark_sling выпускает снаряды не больше количества мобов и поражает их в 3D', () => {
    const stateLvl3 = createInitialCombatState();
    stateLvl3.weapons = [{ id: 'spark_sling', level: 3, cooldownTimer: 0 }];
    // 2 моба в радиусе на ур. 3 (макс 2 снаряда)
    stateLvl3.mobs.push(
      {
        id: 1,
        type: 'mushlet',
        x: 6,
        y: 1.0,
        z: 0,
        hp: 50,
        maxHp: 50,
        speed: 0,
        radius: 0.5,
        damage: 0,
        exp: 1,
        state: 'walk',
        stateTimer: 0,
        chargeDirX: 0,
        chargeDirZ: 0,
        shootCooldown: 9,
      },
      {
        id: 2,
        type: 'mushlet',
        x: 10,
        y: 0,
        z: 0,
        hp: 50,
        maxHp: 50,
        speed: 0,
        radius: 0.5,
        damage: 0,
        exp: 1,
        state: 'walk',
        stateTimer: 0,
        chargeDirX: 0,
        chargeDirZ: 0,
        shootCooldown: 9,
      },
    );
    stepCombat(stateLvl3, 0, 0, 0, 0.05, 0);
    assert.equal(stateLvl3.heroProjectiles.length, 2, 'При 2 мобах на 3 уровне должно быть 2 снаряда');

    // Если на 5 уровне (потенциал 3 снаряда) есть только 1 моб - вылетает ровно 1 снаряд!
    const stateLvl5OneMob = createInitialCombatState();
    stateLvl5OneMob.weapons = [{ id: 'spark_sling', level: 5, cooldownTimer: 0 }];
    stateLvl5OneMob.mobs.push({
      id: 3,
      type: 'mushlet',
      x: 8,
      y: 0,
      z: 0,
      hp: 50,
      maxHp: 50,
      speed: 0,
      radius: 0.5,
      damage: 0,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 9,
    });
    stepCombat(stateLvl5OneMob, 0, 0, 0, 0.05, 0);
    assert.equal(stateLvl5OneMob.heroProjectiles.length, 1, 'Количество снарядов не должно превышать 1 моба');

    // Если мобов в радиусе нет - оружие не стреляет вовсе
    const stateEmpty = createInitialCombatState();
    stateEmpty.weapons = [{ id: 'spark_sling', level: 5, cooldownTimer: 0 }];
    stepCombat(stateEmpty, 0, 0, 0, 0.05, 0);
    assert.equal(stateEmpty.heroProjectiles.length, 0, 'Без врагов праща не должна стрелять');
  });

  it('фолиант силы добавляет силу к выстрелу spark_sling', () => {
    const state = createInitialCombatState();
    state.weapons = [{ id: 'spark_sling', level: 1, cooldownTimer: 0 }];
    state.mightLevel = 2; // +6 урона
    state.mobs.push({
      id: 1,
      type: 'mushlet',
      x: 3,
      y: 0,
      z: 0,
      hp: 50,
      maxHp: 50,
      speed: 0,
      radius: 0.5,
      damage: 0,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 9,
    });

    stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(state.heroProjectiles.length, 1);
    // База 9 + 6 силы = 15 урона
    assert.equal(state.heroProjectiles[0]!.damage, 15);
  });

  it('плевун-совёнок использует хитскан с лучом-телеграфом 1.5 с', () => {
    const state = createInitialCombatState();
    const owl = {
      id: 1,
      type: 'spit_owl' as const,
      x: 10,
      y: 0,
      z: 0,
      hp: 20,
      maxHp: 20,
      speed: 0,
      radius: 0.45,
      damage: 10,
      exp: 2,
      state: 'walk' as const,
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0, // готов стрелять
    };
    state.mobs.push(owl);

    // 1 шаг: совёнок начинает целиться и спавнит телеграфный луч на 1.5 с
    stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(state.beams.length, 1, 'Должен появиться телеграфный луч');
    assert.ok(state.beams[0]!.timer <= 1.5 && state.beams[0]!.timer > 1.4);

    // Симулируем 1.4 секунды шагами по 0.05 с: луч ещё тикает, урона герою нет
    for (let i = 0; i < 28; i++) {
      stepCombat(state, 0, 0, 0, 0.05, 0);
    }
    assert.equal(state.beams.length, 1);
    assert.equal(state.heroHp, 100);

    // Ещё шаги по 0.05 с: таймер луча истекает, игрок на линии луча получает урон
    let totalDmg = 0;
    for (let i = 0; i < 4; i++) {
      const res = stepCombat(state, 0, 0, 0, 0.05, 0);
      totalDmg += res.damageDealtToHero;
    }
    assert.equal(state.beams.length, 0, 'Луч должен отработать и удалиться');
    assert.equal(totalDmg, 10, 'Герой должен получить урон от хитскана');
    assert.equal(state.heroHp, 90);
  });

  it('лис может уклониться от луча совёнка прыжком вверх в 3D', () => {
    const state = createInitialCombatState();
    const owl = {
      id: 1,
      type: 'spit_owl' as const,
      x: 10,
      y: 0,
      z: 0,
      hp: 20,
      maxHp: 20,
      speed: 0,
      radius: 0.45,
      damage: 10,
      exp: 2,
      state: 'walk' as const,
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    };
    state.mobs.push(owl);

    // Начало прицеливания (герой на земле y = 0)
    stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(state.beams.length, 1);

    // Симулируем до момента фиксации луча (1.1 с, 22 шага по 0.05)
    for (let i = 0; i < 22; i++) {
      stepCombat(state, 0, 0, 0, 0.05, 0);
    }

    // Теперь в момент выстрела лис подпрыгивает на 1.6 м вверх (прыжок)
    let totalDmg = 0;
    for (let i = 0; i < 10; i++) {
      const res = stepCombat(state, 0, 1.6, 0, 0.05, 0);
      totalDmg += res.damageDealtToHero;
    }

    assert.equal(state.beams.length, 0, 'Луч должен отработать');
    assert.equal(totalDmg, 0, 'Лис перепрыгнул луч и не должен получить урон');
    assert.equal(state.heroHp, 100, 'Здоровье героя должно остаться полным');
  });

  it('босс Старый Пень спавнится с 5000 HP и передаёт здоровье в StepCombatResult', () => {
    const state = createInitialCombatState();
    const boss = spawnMobInRing(state, 0, 0, 'old_stump', 0, () => 0.5);
    assert.equal(boss.type, 'old_stump');
    assert.equal(boss.maxHp, 5000);
    assert.equal(boss.hp, 5000);

    const res = stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(res.bossAlive, true);
    assert.equal(res.bossHp, 5000);
    assert.equal(res.bossMaxHp, 5000);
  });

  it('после 10 минут (овертайм) лимит мобов вырастает до 100 и HP мобов растёт на +20%/мин', () => {
    assert.equal(getWaveTargetCount(600, false), 80);
    assert.equal(getWaveTargetCount(720, false), 100);
    assert.equal(getWaveTargetCount(900, false), 100);

    // 10 мин: 10 минут по +10%/мин (1.1^10)
    const mult10 = getMobHpMultiplier(600);
    assert.ok(Math.abs(mult10 - Math.pow(1.1, 10)) < 0.001);

    // 11 мин: 1.1^10 * 1.2
    const mult11 = getMobHpMultiplier(660);
    assert.ok(Math.abs(mult11 - Math.pow(1.1, 10) * 1.2) < 0.001);

    // 12 мин: 1.1^10 * 1.2^2
    const mult12 = getMobHpMultiplier(720);
    assert.ok(Math.abs(mult12 - Math.pow(1.1, 10) * Math.pow(1.2, 2)) < 0.001);
  });

  it('шаг боя генерирует события DamagePopupEvent при нанесении урона врагам и герою', () => {
    const state = createInitialCombatState();
    state.weapons[0]!.cooldownTimer = 0; // готов к удару
    state.mobs.push({
      id: 1,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 1.5, // прямо сзади лиса в зоне хвоста
      hp: 100,
      maxHp: 100,
      speed: 0,
      radius: 0.45,
      damage: 0,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 9,
    });

    const res = stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.ok(res.damagePopups.length > 0, 'Должен быть создан всплывающий урон');
    const popup = res.damagePopups[0]!;
    assert.ok(popup.damage > 0);
    assert.equal(popup.isHero, false);
  });
});


