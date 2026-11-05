import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombat, tickCombat, beginDodge, setGuard, incomingHit } from '../src/core/combat.ts';
test('первый момент щита парирует, удержание блокирует, удар в спину проходит', () => {
  const c = createCombat(); setGuard(c, true);
  assert.equal(incomingHit(c, 20, 0, true).parried, true);
  tickCombat(c, 0.3); assert.equal(incomingHit(c, 20, 0, true).damage, 7);
  assert.equal(incomingHit(c, 20, 0, false).damage, 20);
  setGuard(c, true); assert.equal(incomingHit(c, 20, 0, true).parried, false);
});
test('уклонение ограничено усталостью, временем и весом', () => {
  const c = createCombat(); assert.equal(beginDodge(c, 90, 'light'), 0);
  assert.equal(beginDodge(c, 0, 'light'), 13);
  assert.equal(incomingHit(c, 20, 0, false).damage, 0);
  assert.equal(beginDodge(c, 0, 'light'), 0);
  tickCombat(c, 1); assert.equal(beginDodge(c, 0, 'heavy'), 7);
});
test('таймеры защиты совпадают при 60 и 144 кадрах', () => {
  const run = (fps: number) => { const c = createCombat(); beginDodge(c, 0, 'light'); for (let i=0;i<fps;i++) tickCombat(c, 1/fps); return c; };
  const a=run(60), b=run(144); assert.ok(Math.abs(a.cooldown-b.cooldown)<1e-9); assert.equal(a.dodge,b.dodge);
});
test('посох попадает в середине замаха один раз на разных частотах кадров', async () => {
 const { createStaffStrike, advanceStaffStrike } = await import('../src/core/combat.ts');
 for (const fps of [30,60,144]) {
  const strike=createStaffStrike();let hits=0,contact=0;
  for(let i=0;i<fps;i++) if(advanceStaffStrike(strike,1/fps)){hits++;contact=(i+1)/fps;}
  assert.equal(hits,1);assert.ok(contact>=0.16-1e-8 && contact<=0.16+1/fps);
 }
});
