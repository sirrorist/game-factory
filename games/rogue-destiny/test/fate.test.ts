import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer,applyDamage} from '../src/core/player.ts';
import {createInventory,placeItem,autoPlaceItem} from '../src/core/inventory.ts';
import {awardFate,weaveFate,fateReserves} from '../src/core/fate.ts';
test('награда заполняет активный пул, излишек становится предметом',()=>{
 const player=createPlayer();player.threadsOfFate=2;assert.equal(awardFate(player,'boss1'),null);assert.equal(player.threadsOfFate,3);
 const item=awardFate(player,'boss2')!;assert.equal(player.threadsOfFate,3);assert.equal(item.relicEffect,'thread');assert.equal(item.id,'fate_boss2');
 const full=createInventory(1,1);placeItem(full,{...item,id:'occupied'},0,0);assert.equal(autoPlaceItem(full,item),false);assert.equal(item.gridX,undefined);
});
test('резерв не тратится при полном пуле, после расхода вплетается ровно один раз',()=>{
 const player=createPlayer(),grid=createInventory();player.threadsOfFate=3;const item=awardFate(player,'boss')!;placeItem(grid,item,0,0);
 assert.equal(weaveFate(player,grid,item.id),false);assert.ok(grid.items.has(item.id));
 player.hp=1;applyDamage(player,2);assert.equal(player.threadsOfFate,2);assert.equal(weaveFate(player,grid,item.id),true);assert.equal(player.threadsOfFate,3);assert.equal(grid.items.has(item.id),false);assert.equal(weaveFate(player,grid,item.id),false);
});
test('заражённый/испорченный резерв недоступен, погибший герой не вплетает Нити',()=>{
 const player=createPlayer(),grid=createInventory();player.threadsOfFate=3;const item=awardFate(player,'secret')!;placeItem(grid,item,0,0);player.threadsOfFate=1;
 item.isSpoiled=true;assert.equal(fateReserves(grid).length,0);assert.equal(weaveFate(player,grid,item.id),false);item.isSpoiled=false;
 grid.slots[0]!.isMudded=true;assert.equal(weaveFate(player,grid,item.id),false);grid.slots[0]!.isMudded=false;
 player.isDead=true;assert.equal(weaveFate(player,grid,item.id),false);assert.ok(grid.items.has(item.id));
});

import {generateFloor,enterRoom} from '../src/core/dungeon.ts';
import {scoutWithFate,attemptWithFate} from '../src/core/fate.ts';
test('разведка раскрывает соседей, не отменяет свет за посещение и не тратит Нить повторно',()=>{
 const p=createPlayer(),f=generateFloor(1);assert.equal(scoutWithFate(p,f).spent,true);assert.equal(p.threadsOfFate,1);
 assert.equal(scoutWithFate(p,f).spent,false);assert.equal(p.threadsOfFate,1);
 const r=f.rooms.find(room=>room.id==='room_1')!;assert.equal(r.isRevealed,true);assert.equal(r.isVisited,false);assert.equal(enterRoom(f,r.id,p).lightSpent,15);
});
test('разведка может рассеять смежную иллюзию, другие печати остаются',()=>{
 const p=createPlayer(),f=generateFloor(1,1);f.activeRoomId='room_1';const result=scoutWithFate(p,f);assert.ok(result.opened.includes('room_6'));
 assert.equal(f.rooms.find(room=>room.id==='room_6')!.unlocked,true);assert.notEqual(f.rooms.find(room=>room.type==='shrine')!.unlocked,true);
});
test('переброс требует разрешения и Нити, тратится только при первом провале',()=>{
 const p=createPlayer(),start=p.threadsOfFate;assert.equal(attemptWithFate(p,0.8,true,()=>0.2).spent,false);assert.equal(p.threadsOfFate,start);
 const rolls=[0.9,0.2];const result=attemptWithFate(p,0.8,true,()=>rolls.shift()!);assert.deepEqual(result,{success:true,spent:true,attempts:2});assert.equal(p.threadsOfFate,start-1);
 const no=attemptWithFate(p,0.8,false,()=>0.9);assert.equal(no.attempts,1);assert.equal(no.spent,false);
 p.threadsOfFate=0;assert.equal(attemptWithFate(p,0.8,true,()=>0.9).attempts,1);
});

test('без активной Нити разведка не меняет карту; повторный провал расходует ровно одну',()=>{
 const p=createPlayer(),f=generateFloor(1);p.threadsOfFate=0;const before=JSON.stringify(f);
 assert.equal(scoutWithFate(p,f).spent,false);assert.equal(JSON.stringify(f),before);
 p.threadsOfFate=2;let rolls=0;const failed=attemptWithFate(p,0.8,true,()=>{rolls++;return 0.9;});
 assert.deepEqual(failed,{success:false,spent:true,attempts:2});assert.equal(p.threadsOfFate,1);assert.equal(rolls,2);
});
