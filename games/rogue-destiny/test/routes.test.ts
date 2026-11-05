import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor } from '../src/core/dungeon.ts';
import { isWalkable } from '../src/core/movement.ts';
import type { DungeonFloor } from '../src/core/types.ts';

function reachable(floor: DungeonFloor, startX: number, startZ: number, goal: (x: number, z: number) => boolean): boolean {
  const step = 0.5;
  const cells = new Set<string>(); const queue: [number, number][] = [[Math.round(startX / step), Math.round(startZ / step)]];
  cells.add(`${queue[0]![0]},${queue[0]![1]}`);
  for (let head = 0; head < queue.length; head++) {
    const [x,z] = queue[head]!;
    if (goal(x * step, z * step)) return true;
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=x+dx!, nz=z+dz!, key=`${nx},${nz}`;
      if (cells.has(key) || nx < -30 || nx > 160 || nz < -80 || nz > 110) continue;
      cells.add(key); if(isWalkable(floor,nx*step,nz*step)) queue.push([nx,nz]);
    }
  }
  return false;
}
test('в каждом этаже главы есть путь к святилищу и к порталу после снятия печатей', () => {
  for (const seed of [0, 1, 12345, 54321]) for (const number of [1,2,3]) {
    const f=generateFloor(number, seed); const shrine=f.rooms.find(r=>r.type==='shrine')!; const gate=f.rooms.find(r=>r.type==='boss_gate')!;
    assert.ok(reachable(f,0,0,(x,z)=>Math.hypot(Math.max(0,Math.abs(x-shrine.x)-shrine.width/2),Math.max(0,Math.abs(z-shrine.y)-shrine.height/2))<2.5),`нет подхода к святилищу, этаж ${number}`);
    shrine.unlocked=true;
    assert.ok(reachable(f,0,0,(x,z)=>Math.hypot(x-shrine.x,z-shrine.y)<1),`нет входа в святилище, этаж ${number}`);
    const vault=f.rooms.find(room=>room.type==='vault');
    if(vault) {
      assert.ok(reachable(f,0,0,(x,z)=>Math.hypot(Math.max(0,Math.abs(x-vault.x)-vault.width/2),Math.max(0,Math.abs(z-vault.y)-vault.height/2))<2.5),`нет подхода к реликварию, seed ${seed}, этаж ${number}`);
      vault.unlocked=true;
      assert.ok(reachable(f,0,0,(x,z)=>Math.hypot(x-vault.x,z-vault.y)<1),`нет входа в реликварий, seed ${seed}, этаж ${number}`);
    }
    gate.unlocked=true;
    assert.ok(reachable(f,0,0,(x,z)=>Math.hypot(x-gate.x,z-gate.y-4.5)<1),`нет пути к порталу, этаж ${number}`);
  }
});
