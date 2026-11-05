import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor, enterRoom } from '../src/core/dungeon.ts';
import { createPlayer } from '../src/core/player.ts';
import { isWalkable } from '../src/core/movement.ts';
import { revealSecrets, secretDoor } from '../src/core/secrets.ts';
const none = {vision:false,elemental:false,trueSight:false,heat:0};
test('секретная ветвь стабильна по seed, отсутствует в старых записях и закрыта до обнаружения',()=>{
 const f=generateFloor(1,1),room=f.rooms.find(r=>r.secret)!;assert.ok(room);const door=secretDoor(f,room);
 assert.equal(generateFloor(1,0).rooms.some(r=>r.secret),false);
 assert.deepEqual(f,generateFloor(1,1));assert.equal(isWalkable(f,room.x,room.y),false);
 assert.deepEqual(revealSecrets(f,door.x,door.z+1,none),[]);
 assert.deepEqual(revealSecrets(f,door.x,door.z+1,{...none,elemental:true}),[room.id]);
 assert.equal(isWalkable(f,room.x,room.y),true);
 assert.deepEqual(revealSecrets(f,room.x,room.y,{...none,elemental:true}),[]);
 const p=createPlayer();assert.equal(enterRoom(f,room.id,p).lightSpent,15);
});
test('свиток обнаруживает соседний секрет, а красная черта требует близости',()=>{
 const f=generateFloor(1,1),room=f.rooms.find(r=>r.secret)!;
 assert.deepEqual(revealSecrets(f,0,0,{...none,heat:85}),[]);
 const near=revealSecrets(f,secretDoor(f,room).x,secretDoor(f,room).z+8,{...none,vision:true});assert.deepEqual(near,[room.id]);
});
