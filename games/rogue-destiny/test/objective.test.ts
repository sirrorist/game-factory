import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor } from '../src/core/dungeon.ts';
import { chapterObjective } from '../src/core/objective.ts';
test('обязательный путь ведёт от шифра к вратам, боссу и порталу',()=>{
 const floor=generateFloor(1);assert.equal(chapterObjective(floor,4,true,false).title,'Найдите шифр');
 assert.equal(chapterObjective(floor,4,true,true).title,'Откройте врата');
 floor.rooms.find(room=>room.type==='shrine')!.isVisited=true;assert.equal(chapterObjective(floor,4,true,false).title,'Откройте врата');
 floor.rooms.find(room=>room.type==='boss_gate')!.unlocked=true;
 assert.equal(chapterObjective(floor,4,true,false).title,'Победите Стража');assert.equal(chapterObjective(floor,2,false,false).title,'Осталось стражей: 2');
 assert.equal(chapterObjective(floor,0,false,false).title,'К порталу');
});
test('последний этаж ведёт к финалу, необязательные комнаты не создают ложных заданий',()=>{
 const floor=generateFloor(3,1);floor.rooms.find(room=>room.type==='boss_gate')!.unlocked=true;
 assert.match(chapterObjective(floor,0,false,true).detail,/завершить/);
 assert.ok(!chapterObjective(floor,0,false,true).detail.includes('архив'));
});
