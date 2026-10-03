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

  it('автоатака tail_blade бьет мобов перед героем (120°, 2.8 м) и не трогает мобов сзади', () => {
    const state = createInitialCombatState();
    // Лис смотрит в -Z (facingYaw = 0, fx = 0, fz = -1)
    // Моб 1: перед лисом на z = -2.0 м (внутри 2.8 м и сектора 120°)
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
    // Моб 2: сзади лиса на z = +2.0 м (вне сектора 120°)
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
    state.mobs.push(frontMob, backMob);

    // Взмах хвостом готов (cooldownTimer <= 0)
    state.weapons[0]!.cooldownTimer = 0;

    // Шаг симуляции
    const res = stepCombat(state, 0, 0, 0, 0.05, 0);
    assert.equal(res.attacks.length, 1);
    assert.equal(res.attacks[0]!.hits, 1, 'Должен быть поражен ровно 1 моб спереди');

    // Передний моб получил 14 урона: 18 - 14 = 4
    assert.equal(frontMob.hp, 4);
    // Задний моб не получил урон
    assert.equal(backMob.hp, 18);
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
});

