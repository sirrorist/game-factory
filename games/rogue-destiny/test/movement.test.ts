import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor } from '../src/core/dungeon.ts';
import { isWalkable, moveOnFloor } from '../src/core/movement.ts';

test('герой не выходит с пола в воду, включая большой шаг', () => {
  const f = generateFloor(1);
  assert.equal(isWalkable(f, 0, 0), true);
  assert.equal(isWalkable(f, 0, 20), false);
  const p = moveOnFloor(f, 0, 0, 0, 100);
  assert.ok(p.z < 7);
  assert.equal(isWalkable(f, p.x, p.z), true);
});
test('коридор связывает комнаты без непроходимого промежутка', () => {
  const f = generateFloor(1);
  for (let x = 0; x <= 18; x += 0.25) assert.equal(isWalkable(f, x, 0), true);
});
test('запертый зал нельзя обойти по коридору; после открытия доступен', () => {
  const f = generateFloor(1); const room = f.rooms.find((r) => r.type === 'shrine')!;
  assert.equal(isWalkable(f, room.x, room.y), false);
  room.unlocked = true;
  assert.equal(isWalkable(f, room.x, room.y), true);
});
test('колонны являются препятствиями для героя и врагов', () => {
 const f=generateFloor(1);assert.equal(isWalkable(f,6,6),false);
 const p=moveOnFloor(f,5,6,1,0);assert.ok(p.x<5.2);assert.equal(isWalkable(f,p.x,p.z),true);
});

import {moveEnemyOnFloor} from '../src/core/movement.ts';
test('враг обходит колонну, не выходя с пола, при разных частотах кадров',()=>{
 for(const fps of [30,144]) {
  const floor=generateFloor(1),goal={x:6.5,z:5.1};let position={x:4.5,z:6};
  for(let i=0;i<fps*6&&Math.hypot(goal.x-position.x,goal.z-position.z)>0.15;i++) {
    const dx=goal.x-position.x,dz=goal.z-position.z,distance=Math.hypot(dx,dz),step=Math.min(distance,2.6/fps);
    position=moveEnemyOnFloor(floor,position.x,position.z,dx/distance*step,dz/distance*step,'sylvan_f1_1',goal);
    assert.equal(isWalkable(floor,position.x,position.z),true);
  }
  assert.ok(Math.hypot(goal.x-position.x,goal.z-position.z)<0.2,JSON.stringify(position));
 }
});
test('обход не превращается в проход через закрытую печать и воспроизводится по id',()=>{
 const floor=generateFloor(1),gate=floor.rooms.find(room=>room.type==='boss_gate')!;
 const x=gate.x,z=gate.y-gate.height/2-1;
 const a=moveEnemyOnFloor(floor,x,z,0,1,'guard'),b=moveEnemyOnFloor(floor,x,z,0,1,'guard');
 assert.deepEqual(a,b);assert.equal(isWalkable(floor,a.x,a.z),true);assert.ok(a.z<gate.y-gate.height/2);
});
