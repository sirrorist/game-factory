import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../src/core/player.ts';
import { startHealing, advanceHealing } from '../src/core/healing.ts';
test('перевязка лечит после трёх секунд, а не в начале, и только один раз', () => {
 const p=createPlayer(); p.hp=30; const action=startHealing(p,30)!;
 assert.equal(advanceHealing(action,p,2),0); assert.equal(p.hp,30);
 assert.equal(advanceHealing(action,p,1),30); assert.equal(p.hp,60);
 assert.equal(advanceHealing(action,p,10),0); assert.equal(p.hp,60);
});
test('перевязка совпадает при 60/144 Гц и не лечит серую травму', () => {
 for(const fps of [60,144]) { const p=createPlayer(); p.hp=30;p.greyHp=50;const action=startHealing(p,30)!;
 for(let i=0;i<3*fps;i++) advanceHealing(action,p,1/fps);assert.equal(p.hp,50); }
});

test('воду можно выпить при полном HP; усталость снимается через 3 секунды один раз',()=>{
 const p=createPlayer();p.fatigue=70;const action=startHealing(p,0,35)!;assert.ok(action);
 advanceHealing(action,p,2);assert.equal(p.fatigue,70);advanceHealing(action,p,1);assert.equal(p.fatigue,35);advanceHealing(action,p,5);assert.equal(p.fatigue,35);
 assert.equal(p.hp,100);p.fatigue=0;assert.equal(startHealing(p,0,35),null);
});
test('паёк совмещает лечение и отдых, не снимает травму и не воскрешает',()=>{
 const p=createPlayer();p.greyHp=50;p.hp=45;p.fatigue=20;const action=startHealing(p,10,25)!;advanceHealing(action,p,3);
 assert.equal(p.hp,50);assert.equal(p.fatigue,0);assert.equal(p.greyHp,50);
 p.hp=20;const interrupted=startHealing(p,10,25)!;p.isDead=true;p.hp=0;advanceHealing(interrupted,p,3);assert.equal(p.hp,0);
 for(const bad of [NaN,-1,Infinity])assert.equal(startHealing(createPlayer(),0,bad),null);
});
