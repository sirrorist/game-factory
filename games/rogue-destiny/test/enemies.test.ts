import test from 'node:test';
import assert from 'node:assert/strict';
import { enemyProfile } from '../src/core/enemies.ts';
test('роли Сильванов различаются темпом, живучестью и риском, старые id стабильны',()=>{
 const sentinel=enemyProfile('sylvan_gatewatch_f1',1),stalker=enemyProfile('sylvan_f1_2',1),thorn=enemyProfile('sylvan_relicwatch_f2',2);
 assert.equal(sentinel.kind,'sentinel');assert.equal(stalker.kind,'stalker');assert.equal(thorn.kind,'thorn');
 assert.ok(stalker.hp<sentinel.hp&&stalker.speed>sentinel.speed);assert.equal(stalker.coreDamage,6);
 assert.ok(thorn.hp>sentinel.hp&&thorn.windup>sentinel.windup&&thorn.recover>sentinel.recover);assert.equal(thorn.resistsWindup,true);
 assert.ok(thorn.knockback<sentinel.knockback);assert.equal(enemyProfile('sylvan_oraclewatch_f3',3).kind,'thorn');
});
test('босс сохраняет отдельный профиль, рост ограничен тремя этажами',()=>{
 const boss=enemyProfile('warden_f3',3,true);assert.equal(boss.kind,'warden');assert.equal(boss.hp,600);assert.equal(boss.coreDamage,0);
 for(const id of ['sylvan_f1_1','sylvan_f1_2','sylvan_relicwatch_f2'])assert.deepEqual(enemyProfile(id,999),enemyProfile(id,3));
});

import { selectCombatTarget } from '../src/core/enemies.ts';
test('панель выбирает ближнего врага перед камерой, задние/мёртвые/далёкие исключаются',()=>{
 const front={x:0,z:3,kind:'stalker' as const,alive:true},back={...front,z:-1},boss={...front,z:12,kind:'warden' as const};
 assert.equal(selectCombatTarget([back,boss,front],0,0,0),front);
 assert.equal(selectCombatTarget([back,boss],0,0,0),boss);
 assert.equal(selectCombatTarget([{...front,z:8}],0,0,0),null);
 assert.equal(selectCombatTarget([{...front,alive:false}],0,0,0),null);
 assert.equal(selectCombatTarget([back],0,0,Math.PI),back);
});
