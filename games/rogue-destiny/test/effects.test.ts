import test from 'node:test';
import assert from 'node:assert/strict';
import { createEffects, spellImpact, tickEffects } from '../src/core/effects.ts';
test('яд распределяет урон по времени одинаково при 30/144 Гц', () => {
 for (const fps of [30,144]) { const s=createEffects();assert.equal(spellImpact(s,'poison',40),18);let sum=0;
 for(let i=0;i<5*fps;i++) sum+=tickEffects(s,1/fps);assert.equal(sum,24);assert.equal(s.poison,0); }
});
test('лёд замедляет на ограниченное время, огонь даёт прямой урон', () => {
 const s=createEffects();assert.equal(spellImpact(s,'ice',20),16);assert.equal(s.slow,3.5);tickEffects(s,4);assert.equal(s.slow,0);
 assert.equal(spellImpact(s,'fire',35),35);
});
