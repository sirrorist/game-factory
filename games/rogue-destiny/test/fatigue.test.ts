import test from 'node:test';
import assert from 'node:assert/strict';
import { fatigueModifiers } from '../src/core/fatigue.ts';
import { createCombat,beginDodge } from '../src/core/combat.ts';
test('штрафы усталости начинаются после 60%, растут плавно и ограничены',()=>{
 const fresh=fatigueModifiers(0);assert.deepEqual(fresh,fatigueModifiers(60));
 const tired=fatigueModifiers(80),exhausted=fatigueModifiers(100);
 assert.ok(tired.speed<fresh.speed&&tired.speed>exhausted.speed);assert.equal(exhausted.speed,0.75);assert.equal(exhausted.damage,0.8);assert.equal(exhausted.cooldown,1.35);assert.equal(exhausted.cone,0.55);
 assert.deepEqual(fatigueModifiers(1000),exhausted);assert.deepEqual(fatigueModifiers(-10),fresh);assert.deepEqual(fatigueModifiers(NaN),fresh);
});
test('уставший уворот короче, истощённый герой всё ещё может двигаться',()=>{
 assert.ok(beginDodge(createCombat(),80,'light')<beginDodge(createCombat(),0,'light'));
 assert.equal(beginDodge(createCombat(),85,'light'),0);assert.ok(fatigueModifiers(100).speed>0);
});
