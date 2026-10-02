import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlayer,
  applyDamage,
  castMagic,
  performPhysicalAttack,
  forceVentHeat,
  performParry,
  calculateScore,
} from '../src/core/player.ts';

test('состояние игрока инициализируется с базовыми параметрами', () => {
  const p = createPlayer();
  assert.equal(p.hp, 100);
  assert.equal(p.greyHp, 0);
  assert.equal(p.aetherHeat, 0);
  assert.equal(p.threadsOfFate, 2);
  assert.equal(p.isDead, false);
});

test('получение урона наносит серую травму, а Нить Судьбы спасает от смерти', () => {
  const p = createPlayer();
  // 50 урона, броня 10 -> чистый урон 40 -> 20% травма = 8 серого HP
  const r1 = applyDamage(p, 50, 10);
  assert.equal(r1.actualDamage, 40);
  assert.equal(p.hp, 60);
  assert.equal(p.greyHp, 8);
  assert.equal(r1.survivedByFate, false);

  // Смертельный удар: 150 урона
  const r2 = applyDamage(p, 150, 0);
  assert.equal(r2.survivedByFate, true);
  assert.equal(p.hp, 1); // Спасён Нитью Судьбы!
  assert.equal(p.threadsOfFate, 1);
  assert.equal(p.isDead, false);
});

test('каст магии повышает перегрев и переходит в красную зону (80-95%)', () => {
  const p = createPlayer();
  const c1 = castMagic(p, 50);
  assert.equal(p.aetherHeat, 50);
  assert.equal(c1.inRedline, false);

  const c2 = castMagic(p, 35); // 85% тепла
  assert.equal(p.aetherHeat, 85);
  assert.equal(c2.inRedline, true); // В красной зоне!
});

test('физическая атака охлаждает перегрев и медленно повышает усталость', () => {
  const p = createPlayer();
  castMagic(p, 60);
  assert.equal(p.aetherHeat, 60);

  const res = performPhysicalAttack(p);
  assert.equal(res.cooledHeat, 20);
  assert.equal(p.aetherHeat, 40);
  assert.equal(p.fatigue, 4);
});

test('принудительный сброс тепла очищает шкалу ценой ожога плоти (серое HP)', () => {
  const p = createPlayer();
  castMagic(p, 90);
  const vent = forceVentHeat(p);
  assert.equal(vent.heatVented, 90);
  assert.equal(p.aetherHeat, 0);
  assert.equal(p.greyHp, 12); // 12% серого HP
  assert.equal(p.hp, 88);
  assert.equal(p.injuriesCount, 1);
});

test('магическое парирование обрабатывает отражение, забор маны и оба эффекта', () => {
  const p = createPlayer();
  const parryReflect = performParry(p, 20, 'reflect');
  assert.equal(parryReflect.reflectedDamage, 20);
  assert.equal(parryReflect.manaGained, 0);

  const parryBoth = performParry(p, 30, 'both');
  assert.equal(parryBoth.reflectedDamage, 30);
  assert.equal(parryBoth.manaGained, 36);
  assert.equal(p.temporaryMana, 36);
});

test('расчёт очков учитывает этаж, элиту, Нити Судьбы и полученные травмы', () => {
  const p = createPlayer();
  p.currentFloor = 2;
  p.elitesDefeated = 2;
  p.threadsOfFate = 2;
  p.injuriesCount = 1;

  // (2 * 100) + (2 * 25) + (2 * 50) - (1 * 5) = 200 + 50 + 100 - 5 = 345
  assert.equal(calculateScore(p), 345);
});
