import test from 'node:test';
import assert from 'node:assert/strict';
import {generateFloor} from '../src/core/dungeon.ts';
import {hasLineOfSight} from '../src/core/movement.ts';
import {aimedTarget} from '../src/core/targeting.ts';
test('колонны и закрытые печати блокируют удар, открытая вода не стена',()=>{
 const floor=generateFloor(1),shrine=floor.rooms.find(room=>room.type==='shrine')!;
 assert.equal(hasLineOfSight(floor,0,0,18,0),true);
 assert.equal(hasLineOfSight(floor,0,-6,12,-6),false);
 floor.rooms[0]!.devastated=true;assert.equal(hasLineOfSight(floor,0,-6,12,-6),true);
 assert.equal(hasLineOfSight(floor,34,-6,shrine.x,shrine.y),false);
 shrine.unlocked=true;assert.equal(hasLineOfSight(floor,34,-6,shrine.x,shrine.y),true);
 assert.equal(hasLineOfSight(floor,0,0,34,-6),true);
 assert.equal(hasLineOfSight(floor,NaN,0,0,0),false);
});
test('магия выбирает ближайшую цель перед камерой, а не первую/заднюю/мёртвую',()=>{
 const floor=generateFloor(1),near={x:0,z:3,alive:true},far={x:0,z:6,alive:true},back={x:0,z:-1,alive:true};
 assert.equal(aimedTarget(floor,[far,back,near],0,0,0),near);
 assert.equal(aimedTarget(floor,[back],0,0,0),null);
 assert.equal(aimedTarget(floor,[back],0,0,Math.PI),back);
 assert.equal(aimedTarget(floor,[{...near,alive:false}],0,0,0),null);
});
