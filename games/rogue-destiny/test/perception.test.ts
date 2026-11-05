import test from 'node:test';
import assert from 'node:assert/strict';
import {generateFloor} from '../src/core/dungeon.ts';
import {enemySenses} from '../src/core/perception.ts';
import {moveOnFloor,isWalkable} from '../src/core/movement.ts';
test('Страж не активен за закрытыми вратами и просыпается после открытия',()=>{
 const floor=generateFloor(1),gate=floor.rooms.find(room=>room.type==='boss_gate')!,enemy={x:gate.x,z:gate.y,yaw:Math.PI};
 const hero={x:gate.x,z:gate.y-6};assert.deepEqual(enemySenses(floor,enemy,hero,14,true),{active:false,see:false,hear:false});
 gate.unlocked=true;const awake=enemySenses(floor,enemy,hero,14,false);assert.equal(awake.active,true);assert.equal(awake.see,true);
});
test('колонна скрывает от взгляда, тяжёлый ранец слышен сквозь неё и со спины',()=>{
 const floor=generateFloor(1),enemy={x:0,z:-6,yaw:Math.PI/2},hero={x:12,z:-6};
 assert.equal(enemySenses(floor,enemy,hero,14,false).see,false);assert.equal(enemySenses(floor,enemy,hero,14,true).hear,true);
 const back={x:0,z:-3};assert.equal(enemySenses(floor,{x:0,z:0,yaw:0},back,14,false).see,false);assert.equal(enemySenses(floor,{x:0,z:0,yaw:0},back,2,true).hear,true);
});
test('отвлечение и обычный шаг не переносят врага за край или через закрытую печать',()=>{
 const floor=generateFloor(1),moved=moveOnFloor(floor,0,0,0,6);assert.equal(isWalkable(floor,moved.x,moved.z),true);
 const gate=floor.rooms.find(room=>room.type==='boss_gate')!,start={x:gate.x,z:gate.y-gate.height/2-1};
 const blocked=moveOnFloor(floor,start.x,start.z,0,6);assert.ok(blocked.z<gate.y-gate.height/2);
});
