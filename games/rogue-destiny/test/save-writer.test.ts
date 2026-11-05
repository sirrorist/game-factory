import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveWriter} from '../src/core/save-writer.ts';
test('очередь не даёт старому снимку обогнать очистку или новый забег',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const writes:unknown[]=[],started:unknown[]=[];
 const writer=createSaveWriter(async(key,value)=>{started.push([key,value]);if(value==='old')await gate;writes.push([key,value]);});
 const a=writer.save('run','old'),clear=writer.batch([['run',null],['legacy',null]]),b=writer.save('run','new');
 await Promise.resolve();assert.deepEqual(started,[['run','old']]);release();await Promise.all([a,clear,b]);
 assert.deepEqual(writes,[['run','old'],['run',null],['legacy',null],['run','new']]);
});
test('изменение предмета после запроса не меняет отложенный снимок',async()=>{
 const writes:unknown[]=[];const writer=createSaveWriter(async(key,value)=>{writes.push([key,value]);});
 const state={inventory:[{damage:18,shape:[{x:0,y:0}]}]};const saving=writer.save('run',state);
 state.inventory[0]!.damage=99;state.inventory[0]!.shape[0]!.x=4;await saving;
 assert.deepEqual(writes,[['run',{inventory:[{damage:18,shape:[{x:0,y:0}]}]}]]);
});
test('ошибка не блокирует следующий пакет и не выдаётся как успех',async()=>{
 let attempts=0;const writes:string[]=[];const writer=createSaveWriter(async(key)=>{attempts++;if(attempts===1)throw new Error('storage');writes.push(key);});
 const first=writer.save('bad',{}),second=writer.save('good',{});await assert.rejects(first,/storage/);await second;assert.deepEqual(writes,['good']);
});
