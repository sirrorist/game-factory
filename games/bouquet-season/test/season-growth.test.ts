import {legacyState} from './legacy-fixtures.ts';
import {startEvents} from '../src/core/events.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, startSeason, editLayout, enterGrowthDay, refreshStateOffers, harvest, isGameState, type GameState } from '../src/core/state.ts';
import { newPlant } from '../src/core/growth.ts';
import { encode, decode, readCopies, SaveSession, CURRENT_KEY, PREVIOUS_KEY, type StoragePort } from '../src/core/saves.ts';

function prepared(): GameState {
  let state=startSeason(newProfile(),123);
  for(const [kind,q,r] of [['carnation',0,0],['chrysanthemum',-1,0],['carnation',0,1],['sprinkler',1,0],['lamp',0,-1]] as const)
    state=editLayout(state,{type:'place',kind,to:{q,r}});
  state.season!.board.offers=[];
  return state;
}
const ready=()=>refreshStateOffers(enterGrowthDay(enterGrowthDay(prepared())));
class Memory implements StoragePort {
  readonly mode='standalone' as const;readonly gameId='bouquet-season';readonly persistent=true;
  values=new Map<string,unknown>();writes:string[]=[];fail=false;
  async load(key:string):Promise<unknown>{return this.values.get(key)??null;}
  async save(key:string,value:unknown):Promise<void>{this.writes.push(key);if(this.fail && key===CURRENT_KEY)throw Error('Тест: отказ записи.');this.values.set(key,structuredClone(value));}
}
test('Обновление дня: первый рост на дне 2, общий снимок, сброс undo, неизменные RNG/профиль/настройки',()=>{
  const first=prepared(),copy=structuredClone(first),next=enterGrowthDay(first);
  assert.equal(next.season!.day,2);assert.equal(next.season!.garden.plants[0]!.growth,4);
  assert.equal(next.season!.garden.plants[0]!.yield,0);assert.equal(next.season!.layout.undo,null);assert.equal(next.season!.garden.undo,null);
  assert.deepEqual(first,copy);assert.deepEqual(next.profile,first.profile);assert.deepEqual(next.settings,first.settings);
  assert.equal(next.season!.rng,first.season!.rng);
  assert.equal(ready().season!.garden.plants[0]!.yield,3);
  let state=first;
  for(let day=2;day<=20;day++){state=enterGrowthDay(state);assert.equal(state.season!.day,day);state.season!.events=startEvents(123,day).events;assert.ok(isGameState(state));}
  assert.throws(()=>enterGrowthDay(state),/21/);assert.equal(state.season!.day,20);
});
test('Срезка увеличивает только запас вида, начинает новый цикл и закрывает отмену; повтор недопустим',()=>{
  const ripe=ready();const state=editLayout(ripe,{type:'move',from:{q:0,r:-1},to:{q:1,r:-1}});
  const next=harvest(state,{q:0,r:0});assert.ok(isGameState(next));
  assert.deepEqual(next.season!.garden.stock,{carnation:3,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0});
  assert.deepEqual(next.season!.garden.plants[0],newPlant({q:0,r:0}));
  assert.equal(next.season!.layout.undo,null);assert.equal(next.season!.garden.undo,null);
  assert.deepEqual(next.profile,state.profile);assert.equal(state.season!.garden.stock.carnation,0);
  assert.throws(()=>harvest(next,{q:0,r:0}),/готовое/);
  assert.throws(()=>harvest({...state,season:{...state.season!,garden:{...state.season!.garden,stock:{carnation:Number.MAX_SAFE_INTEGER,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0}}}},{q:0,r:0}),/число/);
});
test('Запись дня и срезки: отказ сохраняет один результат, повтор не растит и не собирает второй раз',async()=>{
  for(const [initial,act,check] of [
    [prepared(),enterGrowthDay,(s:GameState)=>assert.equal(s.season!.day,2)],
    [ready(),(s:GameState)=>harvest(s,{q:0,r:0}),(s:GameState)=>assert.equal(s.season!.garden.stock.carnation,3)],
  ] as const){
    const port=new Memory(),record=await encode(initial,10);port.values.set(CURRENT_KEY,record);
    const session=new SaveSession(port,initial,record,null);port.fail=true;
    assert.equal(await session.act(act),false);assert.equal(session.hasPending,true);check(session.state);
    const pending=structuredClone(session.state);assert.equal(await session.act(act),false);
    assert.equal(await session.retry(),false);assert.deepEqual(session.state,pending);
    port.fail=false;assert.equal(await session.retry(),true);assert.equal(session.savedRevision,11);
    assert.deepEqual(session.state,pending);const loaded=await readCopies(port);
    assert.equal(loaded.current.status,'valid');if(loaded.current.status==='valid')assert.deepEqual(loaded.current.state,pending);
  }
});
test('Миграция схемы 2 сохраняет раскладку/адаптацию/undo, чтение не пишет; первая запись 4 оставляет резерв 2',async()=>{
  let state=editLayout(prepared(),{type:'move',from:{q:0,r:0},to:{q:1,r:-1}});
  const {garden:ignored,board:ignoredBoard,...oldSeason}=state.season!;void ignored;void ignoredBoard;
  const old=legacyState(state,2);
  const payload=JSON.stringify(old),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))).toString('hex');
  const record={schemaVersion:2 as const,revision:8,savedAt:new Date().toISOString(),payload,sha256};
  const port=new Memory();port.values.set(CURRENT_KEY,record);
  const loaded=await readCopies(port);assert.deepEqual(port.writes,[]);assert.equal(loaded.current.status,'valid');
  if(loaded.current.status!=='valid')return;
  assert.deepEqual(loaded.current.state.season!.layout,oldSeason.layout);
  assert.deepEqual(loaded.current.state.season!.garden.stock,{carnation:0,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0});
  assert.ok(loaded.current.state.season!.garden.plants.every(p=>p.growth===0 && p.yield===0));
  const session=new SaveSession(port,loaded.current.state,record,null);
  await session.act(s=>editLayout(s,{type:'undo'}));
  assert.equal((port.values.get(CURRENT_KEY) as {schemaVersion:number}).schemaVersion,6);
  assert.deepEqual(port.values.get(PREVIOUS_KEY),record);
  assert.ok(isGameState(session.state));assert.equal(session.state.season!.garden.undo,null);
  assert.ok(session.state.season!.garden.plants.some(p=>p.q===0 && p.r===0));
});
test('Схема 4 строго проверяет сад и календарь; восстановление заменяет и запас, и цикл',async()=>{
  const state=ready(),record=await encode(state,4);
  const bad=[{...state,season:{...state.season!,garden:undefined}},
    {...state,season:{...state.season!,day:1,status:'preparing'}},
    {...state,season:{...state.season!,status:'preparing'}},
    {...state,season:{...state.season!,garden:{...state.season!.garden,stock:{carnation:0,chrysanthemum:-1,rose:0,tulip:0,gerbera:0,lily:0}}}},
    {...state,season:{...state.season!,garden:{...state.season!.garden,plants:state.season!.garden.plants.slice(1)}}}];
  for(const value of bad){assert.equal(isGameState(value),false);await assert.rejects(()=>encode(value as GameState,5));}
  assert.equal((await decode({...record,schemaVersion:2})).status,'invalid');
  const current=harvest(state,{q:0,r:0}),port=new Memory();
  const session=new SaveSession(port,current,await encode(current,5),record);
  assert.equal(await session.restore(),true);assert.deepEqual(session.state,state);assert.equal(session.savedRevision,6);
});
