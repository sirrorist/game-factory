import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, startSeason, isGameState, editLayout } from '../src/core/state.ts';
import { accessLevel, purchase, PURCHASES, fieldSize, openFlowers } from '../src/core/shop.ts';
import { decode, encode, SaveSession, CURRENT_KEY, PREVIOUS_KEY } from '../src/core/saves.ts';
import { legacyState } from './legacy-fixtures.ts';

test('Порог доступа точный, покупки независимы, деньги списываются один раз, опыт не тратится',()=>{
  for(const [xp,level] of [[0,1],[59,1],[60,2],[179,2],[180,3],[359,3],[360,4],[599,4],[600,5]])assert.equal(accessLevel(xp!),level);
  let s=newProfile();s.profile.coins=1000;s.profile.experience=600;
  for(const p of [...PURCHASES].reverse())s=purchase(s,p.id);
  assert.equal(s.profile.coins,220);assert.equal(s.profile.experience,600);
  assert.equal(fieldSize(s.profile.owned),37);assert.equal(openFlowers(s.profile.owned).length,6);assert.ok(isGameState(s));
  assert.throws(()=>purchase(s,'rose'),/Уже/);assert.equal(s.profile.coins,220);
});
test('Покупка проверяет фазу, доступ, кошелёк; посадка проверяет реальные открытия',()=>{
  const s=newProfile();s.profile.coins=500;
  assert.throws(()=>purchase(s,'rose'),/уровень/);
  s.profile.experience=60;s.profile.coins=59;assert.throws(()=>purchase(s,'rose'),/монет/);
  s.profile.coins=60;const bought=purchase(s,'rose'),run=startSeason(bought,123);
  assert.throws(()=>purchase(run,'tulip'),/между/);
  assert.ok(isGameState(editLayout(run,{type:'place',kind:'rose',to:{q:0,r:0}})));
  assert.throws(()=>editLayout(run,{type:'place',kind:'lily',to:{q:1,r:0}}),/открыт/);
  const bad=structuredClone(run);bad.profile.owned.push('lily');assert.equal(isGameState(bad),false);
});
test('Миграция схемы5 не переигрывает RNG/заказы; следующая запись вращает старую копию',async()=>{
  const s=startSeason(newProfile(),123),payload=JSON.stringify(legacyState(s,5));
  const record={schemaVersion:5 as const,revision:9,savedAt:new Date().toISOString(),payload,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))).toString('hex')};
  const loaded=await decode(record);assert.equal(loaded.status,'valid');if(loaded.status!=='valid')return;
  assert.deepEqual(loaded.state,s);
  const records=new Map<string,unknown>([[CURRENT_KEY,record]]);
  const port={mode:'standalone' as const,gameId:'bouquet-season',persistent:true,load:async(k:string)=>records.get(k)??null,save:async(k:string,v:unknown)=>{records.set(k,v);}};
  const session=new SaveSession(port,loaded.state,record,null);
  assert.equal(await session.act(x=>({...x,settings:{...x.settings,tutorial:false}})),true);
  assert.deepEqual(records.get(PREVIOUS_KEY),record);assert.equal((records.get(CURRENT_KEY) as any).schemaVersion,6);
  assert.equal((await decode(await encode(session.state,11))).status,'valid');
});
test('Повтор покупки после ошибки записи сохраняет тот же кошелёк и revision',async()=>{
  const s=newProfile();s.profile.coins=60;s.profile.experience=60;let fail=true;const records=new Map<string,unknown>();
  const session=new SaveSession({mode:'standalone',gameId:'bouquet-season',persistent:true,load:async()=>null,save:async(k,v)=>{if(fail)throw Error('сбой');records.set(k,v);}},s,null,null);
  assert.equal(await session.act(x=>purchase(x,'rose')),false);assert.equal(session.state.profile.coins,0);
  assert.equal(await session.act(x=>purchase(x,'rose')),false);fail=false;assert.equal(await session.retry(),true);
  assert.equal(session.state.profile.coins,0);assert.equal(session.savedRevision,1);assert.deepEqual(session.state.profile.owned,['rose']);
});
