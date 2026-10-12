import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, isAllowedGameOverKey } from '../src/core/scoring.ts';
import { createInitialCombatState } from '../src/core/combat.ts';
import { createInitialInventory } from '../src/core/upgrades.ts';
import { createInitialChests } from '../src/core/chests.ts';

describe('Подсчёт очков забега (DESIGN.md, бриф и раздел 7)', () => {
  it('базовый расчёт: 100 мобов, 300 секунд (5 мин), уровень 10, босс не побеждён', () => {
    // 100 + 2 * 300 + 0 + 10 * 10 = 100 + 600 + 100 = 800
    const score = calculateScore({
      killedMobs: 100,
      survivalSeconds: 300,
      bossDefeated: false,
      heroLevel: 10,
    });
    assert.equal(score, 800);
  });

  it('победа над боссом Старый Пень: добавляет ровно +500 очков', () => {
    // 350 мобов, 550 секунд, победа над боссом, уровень 25
    // 350 + 2 * 550 + 500 + 25 * 10 = 350 + 1100 + 500 + 250 = 2200
    const score = calculateScore({
      killedMobs: 350,
      survivalSeconds: 550,
      bossDefeated: true,
      heroLevel: 25,
    });
    assert.equal(score, 2200);
  });

  it('раннее поражение на первой минуте (45 сек, 15 мобов, ур. 2)', () => {
    // 15 + 45 * 2 + 0 + 2 * 10 = 15 + 90 + 20 = 125
    const score = calculateScore({
      killedMobs: 15,
      survivalSeconds: 45.8,
      bossDefeated: false,
      heroLevel: 2,
    });
    assert.equal(score, 125);
  });

  it('защита от отрицательных чисел и дробных значений', () => {
    const score = calculateScore({
      killedMobs: -5,
      survivalSeconds: -10,
      bossDefeated: false,
      heroLevel: 0,
    });
    // level клампится к 1 минимум (10 очков)
    assert.equal(score, 10);
  });
});

describe('Рестарт забега и сброс состояния (DESIGN.md, раздел 7)', () => {
  it('чистый сброс стейта боя: герой полностью исцелён, счётчики обнулены, мобы очищены', () => {
    const freshCombat = createInitialCombatState();

    assert.equal(freshCombat.heroHp, 100);
    assert.equal(freshCombat.heroMaxHp, 100);
    assert.equal(freshCombat.heroLevel, 1);
    assert.equal(freshCombat.heroExp, 0);
    assert.equal(freshCombat.kills, 0);
    assert.equal(freshCombat.bossDefeated, false);
    assert.equal(freshCombat.mobs.length, 0);
    assert.equal(freshCombat.gems.length, 0);
    assert.equal(freshCombat.projectiles.length, 0);
    assert.equal(freshCombat.weapons.length, 1);
    assert.equal(freshCombat.weapons[0]!.id, 'tail_blade');
    assert.equal(freshCombat.weapons[0]!.level, 1);
  });

  it('чистый сброс инвентаря: стартовое оружие tail_blade 1 ур., фолианты и бонусы пусты', () => {
    const freshInv = createInitialInventory();

    assert.equal(freshInv.weapons.size, 1);
    assert.equal(freshInv.weapons.get('tail_blade'), 1);
    assert.equal(freshInv.tomes.size, 0);
    assert.equal(freshInv.healBonusCount, 0);
    assert.equal(freshInv.speedBonusCount, 0);
  });

  it('чистый сброс сундуков: спавнятся ровно 6 закрытых сундуков', () => {
    const freshChests = createInitialChests([], () => 0, () => 0.5, 6, 65);

    assert.equal(freshChests.length, 6);
    assert.ok(freshChests.every((c) => !c.opened), 'Все сундуки на старте нового забега должны быть закрыты');
  });

  it('ERR-20: изоляция экрана финала забега — разрешены только Space и Enter, остальные клавиши блокируются', () => {
    assert.equal(isAllowedGameOverKey('Space'), true);
    assert.equal(isAllowedGameOverKey('Enter'), true);

    // Блокировка вызова фоновых окон и действий
    assert.equal(isAllowedGameOverKey('Tab'), false);
    assert.equal(isAllowedGameOverKey('Escape'), false);
    assert.equal(isAllowedGameOverKey('KeyB'), false);
    assert.equal(isAllowedGameOverKey('Digit1'), false);
    assert.equal(isAllowedGameOverKey('Digit2'), false);
    assert.equal(isAllowedGameOverKey('Digit3'), false);
    assert.equal(isAllowedGameOverKey('KeyW'), false);
  });
});
