import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../src/core/player.ts';
import { generateFloor } from '../src/core/dungeon.ts';
import { meltdown, meltdownRoom, insideRoom } from '../src/core/meltdown.ts';
test('срыв тратит Нить и силы, оставляет 1 HP и необратимо уничтожает зал',()=>{
 const player=createPlayer(),room=generateFloor(1).rooms[0]!;player.aetherHeat=100;player.temporaryMana=40;
 assert.equal(meltdown(player,room).success,true);assert.equal(player.hp,1);assert.equal(player.threadsOfFate,1);assert.equal(player.aetherHeat,0);assert.equal(player.aetherCore,0);assert.equal(player.fatigue,100);assert.equal(player.temporaryMana,0);assert.equal(room.devastated,true);
 player.aetherHeat=100;assert.equal(meltdown(player,room).success,false);assert.equal(player.threadsOfFate,1);
});
test('без жара/Нитей/зала или после смерти срыв не меняет состояние',()=>{
 for(const mode of ['heat','threads','room','dead'] as const) {
  const player=createPlayer(),room=generateFloor(1).rooms[0]!;player.aetherHeat=100;
  if(mode==='heat')player.aetherHeat=94;if(mode==='threads')player.threadsOfFate=0;if(mode==='dead')player.isDead=true;
  const before=JSON.stringify(player);assert.equal(meltdown(player,mode==='room'?undefined:room).success,false);assert.equal(JSON.stringify(player),before);assert.equal(room.devastated,undefined);
 }
});
test('комната срыва определяется физической позицией, закрытый зал и коридор не подходят',()=>{
 const floor=generateFloor(1),shrine=floor.rooms.find(room=>room.type==='shrine')!;
 assert.equal(meltdownRoom(floor,shrine.x,shrine.y),undefined);shrine.unlocked=true;assert.equal(meltdownRoom(floor,shrine.x,shrine.y),shrine);
 assert.equal(meltdownRoom(floor,10,0),undefined);assert.equal(insideRoom(shrine,shrine.x,shrine.y),true);assert.equal(insideRoom(shrine,0,0),false);
});
