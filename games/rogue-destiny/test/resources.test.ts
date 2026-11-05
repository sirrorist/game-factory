import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, castMagic, applyDamage, applyHealing, forceVentHeat } from '../src/core/player.ts';

test('перегретый маг не может бесконечно продолжать заклинания', () => {
  const p = createPlayer();
  for (let i = 0; i < 4; i++) castMagic(p, 25);
  assert.equal(p.aetherHeat, 100);
  assert.equal(castMagic(p, 25).success, false);
  forceVentHeat(p);
  assert.equal(castMagic(p, 25).success, true);
});
test('травма ограничивает текущее здоровье, лечение не воскрешает', () => {
  const p = createPlayer();
  p.greyHp = 90;
  applyDamage(p, 2);
  assert.ok(p.hp <= p.maxHp - p.greyHp);
  p.isDead = true; p.hp = 0;
  assert.equal(applyHealing(p, 30), 0);
  assert.equal(p.hp, 0);
});
test('нечисловые и отрицательные ресурсы не меняют состояние', () => {
  const p = createPlayer(); p.hp = 50;
  for (const n of [NaN, Infinity, -10, 0]) {
    assert.equal(applyHealing(p, n), 0);
    assert.equal(castMagic(p, n).success, false);
  }
  assert.equal(p.hp, 50);
  assert.equal(p.aetherHeat, 0);
});
test('перехваченная эссенция расходуется на магию вместо перегрева', () => {
 const p=createPlayer();p.temporaryMana=30;const cast=castMagic(p,25);
 assert.equal(cast.success,true);assert.equal(p.temporaryMana,5);assert.equal(p.aetherHeat,0);
 castMagic(p,25);assert.equal(p.temporaryMana,0);assert.equal(p.aetherHeat,20);
});
test('повреждение Ядра усиливает перегрев, Разлом восстанавливает проводимость', async () => {
 const { damageAetherCore, restAtAetherRift }=await import('../src/core/player.ts');
 const p=createPlayer();damageAetherCore(p,80);assert.equal(p.aetherCore,20);castMagic(p,20);assert.equal(p.aetherHeat,25);
 restAtAetherRift(p);assert.equal(p.aetherCore,100);castMagic(p,20);assert.equal(p.aetherHeat,20);
});
