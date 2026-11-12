import {legacyState} from './legacy-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSeason, newProfile, editLayout, isGameState } from '../src/core/state.ts';
import { encode, decode, SaveSession, type StoragePort } from '../src/core/saves.ts';
import { ru } from '../src/i18n/ru.ts';
import { msg } from './ru-match.ts';

test('Размещение не меняет исходник, запрещает занятую клетку/вырез и поддерживает один шаг отмены', () => {
  const first = startSeason(newProfile(),123);
  const placed = editLayout(first,{type:'place',kind:'carnation',to:{q:0,r:0}});
  assert.deepEqual(first.season!.layout,{objects:[],undo:null});
  assert.throws(() => editLayout(placed,{type:'place',kind:'lamp',to:{q:0,r:0}}),msg(ru.errors.cellBusy));
  assert.throws(() => editLayout(placed,{type:'place',kind:'lamp',to:{q:0,r:-2}}),msg(ru.errors.cellOutside));
  const moved = editLayout(placed,{type:'move',from:{q:0,r:0},to:{q:1,r:0}});
  assert.equal(moved.season!.layout.objects[0]!.adaptation,1);
  assert.deepEqual(editLayout(moved,{type:'undo'}).season!.layout.objects,placed.season!.layout.objects);
  const undone = editLayout(moved,{type:'undo'});
  assert.equal(editLayout(undone,{type:'undo'}),undone);
  assert.equal(editLayout(moved,{type:'move',from:{q:1,r:0},to:{q:1,r:0}}),moved);
  assert.deepEqual(editLayout(moved,{type:'remove',from:{q:1,r:0}}).season!.layout.objects,[]);
  const lamp = editLayout(first,{type:'place',kind:'lamp',to:{q:0,r:0}});
  assert.equal(editLayout(lamp,{type:'move',from:{q:0,r:0},to:{q:-1,r:0}}).season!.layout.objects[0]!.adaptation,0);
});
test('Валидация расстановки и отмены отвергает дубликаты, закрытые виды, чужие координаты и форму', () => {
  const state = editLayout(startSeason(newProfile(),5),{type:'place',kind:'sprinkler',to:{q:0,r:0}});
  const o=state.season!.layout.objects[0]!;
  for(const objects of [[o,o],[{...o,kind:'rose'}],[{...o,q:NaN}],[{...o,q:0,r:-2}],[{...o,adaptation:1}],[{...o,extra:true}],{},Array(2)]) {
    assert.equal(isGameState({...state,season:{...state.season,layout:{objects,undo:null}}}),false);
    assert.equal(isGameState({...state,season:{...state.season,layout:{objects:[],undo:objects}}}),false);
  }
  assert.equal(isGameState({...state,season:{...state.season,layout:{objects:null,undo:null}}}),false);
});
test('Схема 1 проверяется и читается без потери профиля; следующая запись схемы 4 сохраняет undo', async () => {
  const old = legacyState(startSeason(newProfile(),123),1);
  old.profile.coins=25;
  const payload=JSON.stringify(old);
  const record={schemaVersion:1 as const,revision:8,savedAt:new Date().toISOString(),payload,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))).toString('hex')};
  const copy=await decode(record);assert.equal(copy.status,'valid');if(copy.status!=='valid')return;
  assert.equal(copy.state.profile.coins,25);assert.deepEqual(copy.state.season!.layout,{objects:[],undo:null});
  const placed=editLayout(copy.state,{type:'place',kind:'lamp',to:{q:0,r:0}});
  const saved=await encode(placed,9);assert.equal(saved.schemaVersion,6);
  const loaded=await decode(saved);assert.equal(loaded.status,'valid');if(loaded.status!=='valid')return;
  assert.deepEqual(editLayout(loaded.state,{type:'undo'}).season!.layout.objects,[]);
  assert.equal((await decode({...record,schemaVersion:2})).status,'invalid');
  assert.equal((await decode({...saved,schemaVersion:1})).status,'invalid');
});
test('Ошибка записи переноса сохраняет расстановку/undo в памяти, повтор не переносит дважды', async () => {
  let fail=false;let writes=0;let stored:unknown=null;
  const port:StoragePort={mode:'standalone',gameId:'bouquet-season',persistent:true,load:async()=>stored,save:async(key,value)=>{if(key==='progress'){writes++;if(fail)throw Error('Сбой');stored=value;}}};
  const state=editLayout(startSeason(newProfile(),1),{type:'place',kind:'carnation',to:{q:0,r:0}});
  const first=await encode(state,1);const session=new SaveSession(port,state,first,null);fail=true;
  await session.act(s=>editLayout(s,{type:'move',from:{q:0,r:0},to:{q:1,r:0}}));
  assert.equal(session.hasPending,true);const pending=structuredClone(session.state);
  assert.equal(await session.act(s=>editLayout(s,{type:'undo'})),false);
  fail=false;assert.equal(await session.retry(),true);assert.equal(writes,2);
  assert.deepEqual(session.state,pending);assert.deepEqual(editLayout(session.state,{type:'undo'}),{...state,season:{...state.season,layout:{objects:state.season!.layout.objects,undo:null},garden:{...state.season!.garden,undo:null},effects:{...state.season!.effects,undo:null}}});
});
