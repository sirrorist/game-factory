import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDamage,
  rollCrit,
  getWaveTargetCount,
  getAvailableMobTypes,
  spawnMobInRing,
  createInitialCombatState,
  stepCombat,
  killMob,
} from '../src/core/combat.ts';
import type { MobEntity } from '../src/core/combat.ts';
import type { Obstacle } from '../src/core/movement.ts';
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

  it('ERR-06: честный 3D-расчёт — прыжок на высоту 2.0 м спасает от урона грибыша под ногами', () => {
    const state = createInitialCombatState();
    state.heroHp = 100;
    state.mobs.push({
      id: 99,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0,
      hp: 50,
      maxHp: 50,
      speed: 0,
      radius: 0.45,
      damage: 15,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    });

    // Герой находится на тех же X=0, Z=0, но на высоте Y=2.0 м (в воздухе после прыжка)
    const res = stepCombat(state, 0, 2.0, 0, 0.016);
    assert.equal(res.damageDealtToHero, 0, 'В воздухе лис не получает урон от наземного грибыша');
    assert.equal(state.heroHp, 100);

    // Когда герой на земле Y=0.0 м — урон проходит
    const resGround = stepCombat(state, 0, 0.0, 0, 0.016);
    assert.equal(resGround.damageDealtToHero, 15, 'На земле лис получает урон касанием');
    assert.equal(state.heroHp, 85);
  });

  it('ERR-06: взмах Хвоста-клинка в прыжке на высоте 3.0 м не задевает мобов на земле', () => {
    const state = createInitialCombatState();
    state.weapons[0]!.cooldownTimer = 0;
    state.mobs.push({
      id: 100,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 1.5,
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
      shootCooldown: 0,
    });

    // Лис прыгнул на Y=3.0 м — хвост не должен достать моба на земле
    stepCombat(state, 0, 3.0, 0, 0.016, 0);
    assert.equal(state.mobs[0]!.hp, 100, 'Моб на земле не получил урон от удара лиса в воздухе');

    // На высоте Y=0.0 м хвост достает моба
    state.weapons[0]!.cooldownTimer = 0;
    stepCombat(state, 0, 0.0, 0, 0.016, 0);
    assert.ok(state.mobs[0]!.hp < 100, 'Моб получил урон от удара лиса на земле');
  });

  it('ERR-08: воскрешение Феникса отбрасывает мобов на 5 м назад и даёт 2.0 с неуязвимости', () => {
    const state = createInitialCombatState();
    state.phoenixDownCharges = 1;
    state.heroHp = 5;
    state.mobs.push({
      id: 101,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0.5,
      hp: 100,
      maxHp: 100,
      speed: 0,
      radius: 0.45,
      damage: 20,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    });

    const res = stepCombat(state, 0, 0, 0, 0.016);
    assert.equal(res.revivedByPhoenix, true);
    assert.equal(state.phoenixDownCharges, 0);
    assert.equal(state.heroIFrameSec, 2.0, '2.0 с кадров неуязвимости после воскрешения');
    // Моб был на z=0.5, отброшен радиально назад на 5 м (z >= 5.0)
    assert.ok(state.mobs[0]!.z >= 5.0, `Моб отброшен на безопасную дистанцию z=${state.mobs[0]!.z}`);
  });

  it('ERR-09: Token Bucket исцеляет за несколько одновременных сплеш-убийств в одном тике', () => {
    const state = createInitialCombatState();
    state.healOnKill = 2; // Соты: +2 HP за килл
    state.heroHp = 50;
    state.heroMaxHp = 100;
    state.honeycombTokens = 10.0; // Пул токенов полон

    // Спавним 4 мобов
    for (let i = 1; i <= 4; i++) {
      state.mobs.push({
        id: i,
        type: 'mushlet',
        x: i,
        y: 0,
        z: 0,
        hp: 10,
        maxHp: 10,
        speed: 0,
        radius: 0.45,
        damage: 0,
        exp: 1,
        state: 'walk',
        stateTimer: 0,
        chargeDirX: 0,
        chargeDirZ: 0,
        shootCooldown: 0,
      });
    }

    // Убиваем 4 мобов одновременно в одном тике (сплеш-удар)
    killMob(state, 1);
    killMob(state, 2);
    killMob(state, 3);
    killMob(state, 4);

    // До фикса дискретный кд заблокировал бы 3 из 4 убийств, восстановив только 2 HP (52).
    // С Token Bucket восстанавливается 4 * 2 = 8 HP (58)!
    assert.equal(state.heroHp, 58, 'Все 4 моба восстановили здоровье через пул токенов');
    assert.equal(Math.round(state.honeycombTokens), 6, 'Израсходовано ровно 4 токена из 10');
  });

  it('механика оверкрита: calculateDamage даёт множитель ×3 при isOvercrit', () => {
    const baseParams = {
      baseDamage: 20,
      weaponLevelBonus: 0,
      mightTomeBonus: 0,
      itemDamageMultiplier: 1.0,
    };

    const normalDmg = calculateDamage({ ...baseParams, isCrit: false });
    assert.equal(normalDmg, 20, 'Обычный удар: 20 урона (x1)');

    const critDmg = calculateDamage({ ...baseParams, isCrit: true, isOvercrit: false });
    assert.equal(critDmg, 40, 'Обычный крит: 40 урона (x2)');

    const overcritDmg = calculateDamage({ ...baseParams, isCrit: true, isOvercrit: true });
    assert.equal(overcritDmg, 60, 'Оверкрит: 60 урона (x3)');
  });

  it('ролл крита и оверкрита rollCrit: базовый крит x2 и оранжевый оверкрит x3', () => {
    // 1. Шанс 0% -> никогда не критует
    const roll0 = rollCrit(0, () => 0.1);
    assert.equal(roll0.isCrit, false);
    assert.equal(roll0.isOvercrit, false);
    assert.equal(roll0.multiplier, 1.0);

    // 2. Шанс 50% (0.5)
    // При rnd = 0.3 (< 0.5) -> крит x2
    const rollCritSuccess = rollCrit(0.5, () => 0.3);
    assert.equal(rollCritSuccess.isCrit, true);
    assert.equal(rollCritSuccess.isOvercrit, false);
    assert.equal(rollCritSuccess.multiplier, 2.0);

    // При rnd = 0.7 (>= 0.5) -> не крит
    const rollCritFail = rollCrit(0.5, () => 0.7);
    assert.equal(rollCritFail.isCrit, false);
    assert.equal(rollCritFail.isOvercrit, false);
    assert.equal(rollCritFail.multiplier, 1.0);

    // 3. Шанс 100% (1.0) -> гарантированный базовый крит x2
    const roll100 = rollCrit(1.0, () => 0.99);
    assert.equal(roll100.isCrit, true);
    assert.equal(roll100.isOvercrit, false);
    assert.equal(roll100.multiplier, 2.0);

    // 4. Шанс 135% (1.35) -> базовый крит гарантирован, 35% шанс оверкрита x3
    // При rnd = 0.2 (< 0.35) -> оверкрит x3
    const rollOvercritSuccess = rollCrit(1.35, () => 0.2);
    assert.equal(rollOvercritSuccess.isCrit, true);
    assert.equal(rollOvercritSuccess.isOvercrit, true);
    assert.equal(rollOvercritSuccess.multiplier, 3.0);

    // При rnd = 0.5 (>= 0.35) -> базовый крит x2 (не оверкрит, но и не обычный удар!)
    const rollOvercritFail = rollCrit(1.35, () => 0.5);
    assert.equal(rollOvercritFail.isCrit, true);
    assert.equal(rollOvercritFail.isOvercrit, false);
    assert.equal(rollOvercritFail.multiplier, 2.0);

    // 5. Шанс 200%+ (>= 2.0) -> гарантированный оверкрит x3
    const roll200 = rollCrit(2.0, () => 0.99);
    assert.equal(roll200.isCrit, true);
    assert.equal(roll200.isOvercrit, true);
    assert.equal(roll200.multiplier, 3.0);
  });

  it('боевая симуляция stepCombat с оверкритом: мобы получают урон x3 с флагом isOvercrit', () => {
    const state = createInitialCombatState();
    state.critChance = 1.5; // 150% крита (50% шанс оверкрита)
    state.weapons[0]!.cooldownTimer = 0; // tail_blade готов

    state.mobs.push({
      id: 99,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 2.0, // сзади лиса в секторе Хвоста-клинка
      hp: 200,
      maxHp: 200,
      speed: 0,
      radius: 0.5,
      damage: 0,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    });

    // Передаём rnd, возвращающий 0.2 (< 0.5) -> оверкрит x3!
    // Базовый урон tail_blade ур. 1 = 14. 14 * 3.0 = 42 урона
    const res = stepCombat(state, 0, 0, 0, 0.016, 0, 2.5, () => 0, () => 0.2);
    const popup = res.damagePopups.find((p) => !p.isHero);
    assert.ok(popup, 'Попап урона по мобу найден');
    assert.equal(popup.isCrit, true, 'isCrit = true');
    assert.equal(popup.isOvercrit, true, 'isOvercrit = true');
    assert.equal(popup.damage, 42, 'Урон оверкрита: 14 * 3.0 = 42');
    assert.equal(state.mobs[0]!.hp, 200 - 42, 'Здоровье моба уменьшилось на 42');
  });

  it('накопительный опыт: сбор кристалла на 40 опыта даёт 3 левелапа подряд без потерь остатка (Megabonk-style)', () => {
    const state = createInitialCombatState();
    // На уровне 1: getRequiredExp(1) = 5
    // На уровне 2: getRequiredExp(2) = 9
    // На уровне 3: getRequiredExp(3) = 13
    // На уровне 4: getRequiredExp(4) = 17
    // Сумма опыта на 3 повышения: 5 + 9 + 13 = 27 опыта.
    // При кристалле в 40 опыта: 40 - 27 = 13 остатка опыта на уровне 4 (13 / 17).
    state.gems.push({
      id: 1,
      x: 0,
      y: 0,
      z: 0.1, // прямо под ногами лиса
      value: 40,
      type: 'large',
      flying: false,
    });

    const res = stepCombat(state, 0, 0, 0, 0.016, 0, 2.5);
    assert.equal(res.leveledUp, true, 'Событие левелапа произошло');
    assert.equal(state.heroLevel, 4, 'Герой мгновенно апнул 4 уровень (1 -> 4)');
    assert.equal(state.pendingLevelUps, 3, 'Накоплено ровно 3 окна выбора улучшения подряд');
    assert.equal(state.heroExp, 13, 'Остаток опыта сохранён (13 / 17)');
    assert.equal(res.gemsCollected, 1, 'Кристалл успешно собран');

    // Симуляция закрытия 3 окон выбора улучшений по очереди
    state.pendingLevelUps--;
    assert.equal(state.pendingLevelUps, 2);
    state.pendingLevelUps--;
    assert.equal(state.pendingLevelUps, 1);
    state.pendingLevelUps--;
    assert.equal(state.pendingLevelUps, 0, 'Все 3 улучшения получены');
    assert.equal(state.heroExp, 13, 'Опыт 13/17 никуда не пропал после всех прокачек');
  });

  it('честный телеграф совуха: луч остаётся строго статичным на все 1.5 с и не доворачивает за героем', () => {
    const state = createInitialCombatState();
    // Спавним совуха на дистанции 10 м по оси Z
    const owl: MobEntity = {
      id: 1,
      type: 'spit_owl',
      x: 0,
      y: 0,
      z: 10,
      hp: 20,
      maxHp: 20,
      speed: 0,
      radius: 0.45,
      damage: 15,
      exp: 2,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0.001, // готов выстрелить на следующем шаге
    };
    state.mobs.push(owl);

    // Герой стоит в точке (0, 0, 0)
    stepCombat(state, 0, 0, 0, 0.016, 0, 2.5);
    assert.equal(state.beams.length, 1, 'Совух создал луч');
    const beam = state.beams[0]!;

    // Запоминаем исходное направление луча
    const origDirX = beam.dirX;
    const origDirZ = beam.dirZ;

    // В следующем кадре герой смещается вправо на 4 метра (уклонение!)
    stepCombat(state, 4.0, 0, 0, 0.05, 0, 2.5);

    // Луч НЕ должен довернуться за героем!
    assert.equal(beam.dirX, origDirX, 'Направление луча по X не изменилось');
    assert.equal(beam.dirZ, origDirZ, 'Направление луча по Z не изменилось');

    // Мотаем время до момента выстрела (1.6 с суммарно мелкими тиками по 0.05 с, так как safeDt ограничен 0.1 с)
    let heroDmg = 0;
    for (let i = 0; i < 32; i++) {
      const res = stepCombat(state, 4.0, 0, 0, 0.05, 0, 2.5);
      heroDmg += res.damageDealtToHero;
    }

    // Герой уклонился на 4 метра, поэтому урон по нему равен 0!
    assert.equal(heroDmg, 0, 'Герой уклонился от статичного луча и не получил урона');
    assert.equal(state.beams.length, 0, 'Луч завершил действие и удалился');
  });

  it('уникальность босса Старый Пень: повторный spawnMobInRing не создаёт дубликат', () => {
    const state = createInitialCombatState();
    const boss1 = spawnMobInRing(state, 0, 0, 'old_stump', 480, () => 0.5);
    assert.equal(state.mobs.length, 1, 'Босс заспавнен');
    assert.equal(boss1.type, 'old_stump');

    // Попытка заспавнить босса второй раз
    const boss2 = spawnMobInRing(state, 0, 0, 'old_stump', 500, () => 0.8);
    assert.equal(state.mobs.length, 1, 'Второй босс НЕ создан (длина массива осталась 1)');
    assert.equal(boss2.id, boss1.id, 'Возвращен существующий экземпляр босса');
  });

  it('взаимное расталкивание (Separation): мобы не слипаются в одну точку, а босс монолитен', () => {
    const state = createInitialCombatState();
    // Создаем двух грибышей в почти одной точке
    state.mobs.push({
      id: 1,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0.05,
      hp: 10,
      maxHp: 10,
      speed: 0,
      radius: 0.45,
      damage: 0,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    });
    state.mobs.push({
      id: 2,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0,
      hp: 10,
      maxHp: 10,
      speed: 0,
      radius: 0.45,
      damage: 0,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    });

    stepCombat(state, 10, 0, 10, 0.016, 0, 2.5);

    const m1 = state.mobs[0]!;
    const m2 = state.mobs[1]!;
    const dist = Math.hypot(m1.x - m2.x, m1.z - m2.z);
    assert.ok(dist >= 0.89, `Мобы растолкнулись на расстояние суммарного радиуса (~0.90 м), факт: ${dist.toFixed(2)} м`);

    // Проверяем монолитность босса: босс стоит на (0, 0), моб на (0, 0.5)
    state.mobs = [];
    state.mobs.push({
      id: 3,
      type: 'old_stump',
      x: 0,
      y: 0,
      z: 0,
      hp: 5000,
      maxHp: 5000,
      speed: 0,
      radius: 1.8,
      damage: 0,
      exp: 50,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    });
    state.mobs.push({
      id: 4,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0.5,
      hp: 10,
      maxHp: 10,
      speed: 0,
      radius: 0.45,
      damage: 0,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    });

    stepCombat(state, 10, 0, 10, 0.016, 0, 2.5);
    const boss = state.mobs[0]!;
    const mushlet = state.mobs[1]!;

    assert.equal(boss.x, 0, 'Босс не сдвинулся по X');
    assert.equal(boss.z, 0, 'Босс не сдвинулся по Z');
    assert.ok(mushlet.z >= 2.24, `Рядовой моб вытолкнут за пределы радиуса босса (1.8 + 0.45 = 2.25 м), факт: ${mushlet.z.toFixed(2)} м`);
  });

  it('перепрыгивание мобов: на земле моб выталкивает лиса, а в прыжке лис свободно перелетает над ним', () => {
    const state = createInitialCombatState();
    state.mobs.push({
      id: 1,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0.5,
      hp: 10,
      maxHp: 10,
      speed: 0,
      radius: 0.45,
      damage: 0,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 0,
    });

    // 1. Герой на земле (heroY = 0) пересекается с грибышем (z = 0.5, суммарный радиус 0.45 + 0.45 = 0.90)
    const resGround = stepCombat(state, 0, 0, 0.4, 0.016, 0, 2.5);
    assert.ok((resGround.heroPushZ ?? 0) < 0, 'На земле герой отталкивается от моба назад');

    // 2. Герой в прыжке на высоте 1.2 м (heroY = 1.2 м) летит над грибышем (высота грибыша 0.65 м)
    const resJump = stepCombat(state, 0, 1.2, 0.4, 0.016, 0, 2.5);
    assert.equal(resJump.heroPushX ?? 0, 0, 'В воздухе нет бокового отталкивания');
    assert.equal(resJump.heroPushZ ?? 0, 0, 'В воздухе нет продольного отталкивания — лис свободно летит над мобом!');
  });

  it('одновременный залп 3 совухов: все 3 луча наносят урон и дают 3 отдельных попапа без подавления i-frame', () => {
    const state = createInitialCombatState();
    const heroX = 0;
    const heroY = 0;
    const heroZ = 0;
    const owlPositions = [
      { x: -6, z: 8 },
      { x: 0, z: 10 },
      { x: 6, z: 8 },
    ];
    // 3 совуха на разных позициях целятся прямо в лиса
    for (let i = 0; i < 3; i++) {
      const pos = owlPositions[i]!;
      const dx = heroX - pos.x;
      const dy = (heroY + 0.45) - 0.6;
      const dz = heroZ - pos.z;
      const len = Math.hypot(dx, dy, dz);
      state.beams.push({
        id: i + 1,
        owlId: i + 1,
        startX: pos.x,
        startY: 0.6,
        startZ: pos.z,
        dirX: dx / len,
        dirY: dy / len,
        dirZ: dz / len,
        length: len + 5,
        timer: 0.001, // луч срабатывает в следующем шаге
        maxTimer: 1.5,
        damage: 8,
      });
    }

    // Герой стоит в точке (0, 0, 0) и находится на траектории всех 3 лучей
    const res = stepCombat(state, heroX, heroY, heroZ, 0.016, 0, 2.5);

    // Все 3 луча должны нанести урон: 8 * 3 = 24 урона!
    assert.equal(res.damageDealtToHero, 24, 'Суммарный урон равен 24 (8 * 3 луча)');
    const heroPopups = res.damagePopups.filter((p) => p.isHero);
    assert.equal(heroPopups.length, 3, 'Появилось ровно 3 отдельных всплывающих цифры урона для каждого совуха!');
    assert.ok(state.heroIFrameSec > 0, 'После залпа активирован защитный i-frame');
  });

  it('мобы сталкиваются со стволами деревьев и скалами (height >= 3.0) и не могут зайти внутрь', () => {
    const state = createInitialCombatState();
    // Дерево в точке (0, 5) с радиусом 1.0 м и высотой 5.0 м
    const obstacles: Obstacle[] = [{ x: 0, z: 5, radius: 1.0, height: 5.0 }];
    // Грибыш в точке (0, 6.2) идёт вниз к герою на (0, 0)
    const mob: MobEntity = {
      id: 1,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 6.2,
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
      shootCooldown: 0,
    };
    state.mobs.push(mob);

    // Шаг симуляции в сторону дерева
    stepCombat(state, 0, 0, 0, 0.05, 0, 2.5, () => 0, Math.random, obstacles);

    // Расстояние грибыша до центра дерева должно оставаться >= 1.0 + 0.45 = 1.45 м!
    const distToTree = Math.hypot(mob.x - obstacles[0]!.x, mob.z - obstacles[0]!.z);
    assert.ok(distToTree >= 1.44, `Грибыш не заходит внутрь ствола дерева (дистанция ${distToTree} >= 1.45)`);
  });

  it('жук-таран в рывке врезается в дерево, прерывает рывок и переходит в cooldown', () => {
    const state = createInitialCombatState();
    const obstacles: Obstacle[] = [{ x: 0, z: 4, radius: 1.0, height: 5.0 }];
    const beetle: MobEntity = {
      id: 1,
      type: 'ram_beetle',
      x: 0,
      y: 0,
      z: 5.6,
      hp: 30,
      maxHp: 30,
      speed: 2.0,
      radius: 0.55,
      damage: 12,
      exp: 2,
      state: 'charge',
      stateTimer: 0.8,
      chargeDirX: 0,
      chargeDirZ: -1, // летит прямо в дерево
      shootCooldown: 0,
    };
    state.mobs.push(beetle);

    stepCombat(state, 0, 0, 0, 0.05, 0, 2.5, () => 0, Math.random, obstacles);

    assert.equal(beetle.state, 'cooldown', 'Жук перешёл в состояние cooldown после удара о ствол');
    assert.equal(beetle.stateTimer, 1.6, 'Таймер перезарядки установлен на 1.6 с');
  });

  it('мобы карабкаются на покатые камни поляны и наносят урон лису на вершине камня', () => {
    const state = createInitialCombatState();
    // Покатый валун поляны в (0, 0) радиусом 1.5 м и высотой 1.3 м
    const stone: Obstacle = { x: 0, z: 0, radius: 1.5, height: 1.3 };
    const obstacles: Obstacle[] = [stone];

    // Грибыш подходит к центру камня, преследуя лиса
    const mob: MobEntity = {
      id: 1,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0.3, // на вершине камня рядом с лисом
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
      shootCooldown: 0,
    };
    state.mobs.push(mob);

    // Лис стоит на вершине камня: heroY = 1.3 м
    const res = stepCombat(state, 0, 1.3, 0, 0.05, 0, 2.5, () => 0, Math.random, obstacles);

    // Моб поднялся по высоте камня к лису
    assert.ok(mob.y > 1.0, `Высота моба поднялась на камень: ${mob.y} > 1.0`);
    // Моб достал лиса и нанёс урон на вершине камня (абуз устранён!)
    assert.equal(res.damageDealtToHero, 6, 'Моб на камне наносит урон лису на камне');
  });

  it('лис на камне высотой 1.0 м неуязвим для касания грибышей на земле (без камня под мобом)', () => {
    const state = createInitialCombatState();
    // Грибыш стоит на уровне земли y = 0
    const mob: MobEntity = {
      id: 1,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 0.2, // прямо вплотную
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
      shootCooldown: 0,
    };
    state.mobs.push(mob);

    // Герой высоко в воздухе/на отвесном уступе: heroY = 1.5 м
    const res = stepCombat(state, 0, 1.5, 0, 0.05, 0, 2.5);

    assert.equal(res.damageDealtToHero, 0, 'Грибыш снизу не наносит урон лису выше него');
    assert.equal(res.heroPushX ?? 0, 0, 'Грибыш снизу не толкает лиса по X');
    assert.equal(res.heroPushZ ?? 0, 0, 'Грибыш снизу не толкает лиса по Z');
  });

  it('луч совёнка блокируется камнем, стоящим между совёнком и лисом', () => {
    const state = createInitialCombatState();
    // Камень ровно посередине между совёнком и героем: x: 0, z: 5, r: 1.0, h: 2.0
    const obstacles: Obstacle[] = [{ x: 0, z: 5, radius: 1.0, height: 2.0 }];

    state.beams.push({
      id: 1,
      owlId: 1,
      startX: 0,
      startY: 0.6,
      startZ: 10,
      dirX: 0,
      dirY: 0,
      dirZ: -1, // луч летит прямо в героя на (0, 0, 0) сквозь камень на z = 5
      length: 15,
      timer: 0.001,
      maxTimer: 1.5,
      damage: 15,
    });

    const res = stepCombat(state, 0, 0, 0, 0.016, 0, 2.5, () => 0, Math.random, obstacles);

    assert.equal(res.damageDealtToHero, 0, 'Урон равен 0 — луч полностью поглощён камнем');
    assert.equal(res.damagePopups.filter((p) => p.isHero).length, 0, 'Никаких цифр урона по герою');
  });

  it('кристалл опыта выталкивается наружу из дерева на открытую поверхность', () => {
    const state = createInitialCombatState();
    const obstacles: Obstacle[] = [{ x: 5, z: 5, radius: 1.0, height: 5.0 }];
    // Кристалл упал в центр дерева (5, 5)
    state.gems.push({
      id: 1,
      x: 5,
      y: 0.2,
      z: 5,
      value: 1,
      type: 'small',
      flying: false,
    });

    // Герой далеко, кристалл не летит магнитом
    stepCombat(state, 20, 0, 20, 0.016, 0, 2.5, () => 0, Math.random, obstacles);

    const gem = state.gems[0]!;
    const distToTree = Math.hypot(gem.x - 5, gem.z - 5);
    assert.ok(distToTree >= 1.34, `Кристалл вытолкнут на край дерева (дистанция ${distToTree} >= 1.35)`);
  });

  it('кристалл опыта свободно поднимается вверх по Y к лису на камне', () => {
    const state = createInitialCombatState();
    const stone: Obstacle = { x: 0, z: 0, radius: 1.5, height: 1.3 };
    const obstacles: Obstacle[] = [stone];

    // Кристалл на земле у основания камня
    state.gems.push({
      id: 1,
      x: 0,
      y: 0.2,
      z: 0.5,
      value: 5,
      type: 'medium',
      flying: false,
    });

    // Лис стоит на вершине камня: heroY = 1.3 м, радиус подбора 5.0 м
    // Шаг 1: кристалл переходит в flying: true и начинает лететь вверх
    stepCombat(state, 0, 1.3, 0, 0.05, 0, 5.0, () => 0, Math.random, obstacles);

    const gem = state.gems[0]!;
    assert.ok(gem.flying, 'Кристалл активировал магнит и перешёл в flying');
    assert.ok(gem.y > 0.3, `Кристалл поднимается по оси Y к лису: ${gem.y} > 0.3`);
  });

  it('ERR-17: спавн моба у края арены (герой на (59, 0)) всегда удерживает моба внутри арены (дистанция <= 58.0 м)', () => {
    const state = createInitialCombatState();
    // Тестируем спавн с разными случайными углами, когда герой стоит вплотную к силовому барьеру (59, 0)
    for (let r = 0; r <= 1.0; r += 0.1) {
      const mob = spawnMobInRing(state, 59, 0, 'mushlet', 0, () => r);
      const distFromCenter = Math.hypot(mob.x, mob.z);
      assert.ok(
        distFromCenter <= 58.0001,
        `Моб не должен спавниться за пределами барьера: dist=${distFromCenter} > 58.0 (r=${r})`
      );
    }

    // Проверяем, что stepCombat удерживает мобов внутри единой границы arenaRadius (60.0 м)
    const outsideMob = state.mobs[0]!;
    outsideMob.x = 65;
    outsideMob.z = 0;
    stepCombat(state, 0, 0, 0, 0.05, 0, 2.5);
    const clampedDist = Math.hypot(outsideMob.x, outsideMob.z);
    assert.ok(clampedDist <= 60.0001, `Моб ограничен радиусом арены: ${clampedDist} <= 60.0`);
  });

  it('ERR-19: моб свободно доходит до героя на краю арены (x = 59.5 м) и наносит урон, ликвидируя абуз 56.5 м', () => {
    const state = createInitialCombatState();
    // Герой стоит у самого края арены (x = 59.5 м при границе 60.0 м)
    state.heroHp = 100;
    state.mobs.push({
      id: 201,
      type: 'mushlet',
      x: 55.0, // Моб начинает с 55 м (где раньше была невидимая стена 56.5 м)
      y: 0,
      z: 0,
      hp: 100,
      maxHp: 100,
      speed: 3.0,
      radius: 0.45,
      damage: 10,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 9,
    });

    let totalDmg = 0;
    // Симулируем бег моба к герою на (59.5, 0)
    for (let i = 0; i < 40; i++) {
      const res = stepCombat(state, 59.5, 0, 0, 0.05, 0, 2.5);
      totalDmg += res.damageDealtToHero;
    }

    const mob = state.mobs[0]!;
    // Моб должен свободно пройти отметку 56.5 м и дойти до лиса на 59+ м
    assert.ok(mob.x > 58.0, `Моб должен свободно пересечь 56.5 м и дойти к лису: mob.x = ${mob.x} > 58.0`);
    assert.ok(totalDmg > 0, `Моб наносит урон лису на краю арены: урон ${totalDmg} > 0 (абуз ликвидирован)`);
  });

  it('ERR-18: моб, направляющийся к герою через ствол дерева, огибает препятствие по касательной, а не застревает', () => {
    const state = createInitialCombatState();
    const tree: Obstacle = { x: 0, z: 5, radius: 1.0, height: 5.0 };
    const obstacles: Obstacle[] = [tree];

    // Герой на (0, 0, 0). Моб на (0, 0, 6.2) — ствол дерева (0, 5) прямо на пути между мобом и героем
    state.mobs.push({
      id: 101,
      type: 'mushlet',
      x: 0,
      y: 0,
      z: 6.2,
      hp: 100,
      maxHp: 100,
      speed: 3.0,
      radius: 0.45,
      damage: 10,
      exp: 1,
      state: 'walk',
      stateTimer: 0,
      chargeDirX: 0,
      chargeDirZ: 0,
      shootCooldown: 9,
    });

    const initialX = state.mobs[0]!.x;
    // Делаем несколько шагов симуляции
    for (let i = 0; i < 15; i++) {
      stepCombat(state, 0, 0, 0, 0.05, 0, 2.5, () => 0, Math.random, obstacles);
    }

    const updatedMob = state.mobs[0]!;
    // Моб должен получить смещение по X (касательная), огибая ствол
    const lateralShift = Math.abs(updatedMob.x - initialX);
    assert.ok(
      lateralShift > 0.1,
      `Моб должен плавно огибать дерево по касательной: сдвиг по X = ${lateralShift} > 0.1`
    );
  });

  it('босс Старый Пень: удар корнями по кругу 5 м наносит 20 урона на земле, телеграф 1.0 с', () => {
    const state = createInitialCombatState();
    state.heroHp = 100;
    const boss = spawnMobInRing(state, 0, 0, 'old_stump', 480, () => 0.5);
    boss.x = 0;
    boss.z = 3.0; // 3 м от лиса (в радиусе корней 5 м)
    boss.rootAttackCooldown = 1.05; // 0.05 с до старта телеграфа

    // Шаг 1: через 0.05 с активируется телеграф
    let res = stepCombat(state, 0, 0, 0, 0.05, 0, 2.5);
    assert.ok(res.bossRootAttack, 'Телеграф корней должен быть активен');
    assert.equal(res.bossRootAttack.isSlam, false);
    assert.equal(res.bossRootAttack.radius, 5.0);

    // Симулируем 1.0 с телеграфа (20 шагов по 0.05 с)
    let totalDmg = 0;
    for (let i = 0; i < 20; i++) {
      res = stepCombat(state, 0, 0, 0, 0.05, 0, 2.5);
      totalDmg += res.damageDealtToHero;
    }

    assert.ok(res.bossRootAttack?.isSlam, 'Должен произойти удар корнями');
    assert.equal(totalDmg, 20, 'Удар корнями должен нанести ровно 20 урона');
  });

  it('босс Старый Пень: честный 3D-прыжок (высота 1.4 м) полностью защищает от удара корней', () => {
    const state = createInitialCombatState();
    state.heroHp = 100;
    const boss = spawnMobInRing(state, 0, 0, 'old_stump', 480, () => 0.5);
    boss.x = 0;
    boss.z = 3.0;
    boss.rootAttackCooldown = 0.05; // 1 шаг до удара

    // Герой подпрыгнул на высоту 1.4 м (выше 1.2 м над землёй)
    const res = stepCombat(state, 0, 1.4, 0, 0.05, 0, 2.5);
    assert.ok(res.bossRootAttack?.isSlam, 'Удар корнями произошёл');
    assert.equal(res.damageDealtToHero, 0, 'В воздухе лис не получает урона от корней');
    assert.equal(state.heroHp, 100, 'HP лиса осталось нетронутым');
  });

  it('босс Старый Пень: призыв 6 грибышей раз в 12 секунд вокруг себя', () => {
    const state = createInitialCombatState();
    const boss = spawnMobInRing(state, 0, 0, 'old_stump', 480, () => 0.5);
    boss.x = 10;
    boss.z = 10;
    boss.minionSummonCooldown = 0.05; // 1 шаг до призыва

    const initialMobs = state.mobs.length; // 1 (сам босс)
    stepCombat(state, 0, 0, 0, 0.05, 0, 2.5);

    assert.equal(state.mobs.length, initialMobs + 6, 'Босс должен призвать ровно 6 грибышей');
    const minions = state.mobs.filter((m) => m.type === 'mushlet');
    assert.equal(minions.length, 6);
  });

  it('босс Старый Пень: фаза ярости при HP < 50% увеличивает скорость на +30%', () => {
    const state = createInitialCombatState();
    const boss = spawnMobInRing(state, 0, 0, 'old_stump', 480, () => 0.5);
    boss.x = 0;
    boss.z = 20;
    boss.speed = 1.8;
    boss.hp = 2000; // < 2500 (50% от 5000)

    for (let i = 0; i < 20; i++) {
      stepCombat(state, 0, 0, 0, 0.05, 0, 2.5);
    }
    assert.ok(boss.isEnraged, 'Босс должен войти в ярость');
    // При скорости 1.8 * 1.3 = 2.34 м/с за 1 с он сдвинется на 2.34 м по направлению к 0 (z = 20 - 2.34 = 17.66)
    const movedDist = 20 - boss.z;
    assert.ok(Math.abs(movedDist - 2.34) < 0.1, `Скорость босса в ярости ${movedDist} должна быть около 2.34 м/с`);
  });

  it('смерть босса Старый Пень: даёт 50 опыта и флаг bossDefeated', () => {
    const state = createInitialCombatState();
    const boss = spawnMobInRing(state, 0, 0, 'old_stump', 480, () => 0.5);
    boss.hp = 10;

    // Убиваем босса
    killMob(state, boss.id);

    assert.equal(state.bossDefeated, true, 'Флаг bossDefeated должен быть установлен в true');
    const largeGem = state.gems.find((g) => g.value === 50);
    assert.ok(largeGem, 'Должен выпасть кристалл на 50 опыта');
  });
});



