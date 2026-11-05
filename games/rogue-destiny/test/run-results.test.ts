import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMetaProgress} from '../src/core/saves.ts';
import {createSaveWriter} from '../src/core/save-writer.ts';
import {parseRunReceipt,applyRunReceipt,resultEntries} from '../src/core/run-results.ts';
const receipt=()=>({id:'attempt_abc',score:900,elites:15,victory:true,floor:3});
test('повтор терминального журнала не дублирует попытку, победу и награды',()=>{
 const meta=parseMetaProgress(null),result=receipt();assert.equal(applyRunReceipt(meta,result),true);assert.equal(applyRunReceipt(meta,result),false);
 assert.equal(meta.totalRuns,1);assert.equal(meta.victories,1);assert.equal(meta.totalElites,15);assert.equal(meta.highScore,900);
 const restored=parseMetaProgress(JSON.parse(JSON.stringify(meta)));assert.equal(applyRunReceipt(restored,result),false);assert.equal(restored.totalRuns,1);
});
test('обрыв после журнала/мета/очистки восстанавливается без удвоения результата',async()=>{
 for(const crashAt of [1,2,3]) {
  const store=new Map<string,unknown>([['meta_progress',parseMetaProgress(null)],['run_progress',{runId:'attempt_abc'}],['progress',{}]]);let writes=0;
  const writer=createSaveWriter(async(key,value)=>{if(writes++===crashAt)throw new Error('interrupted');store.set(key,structuredClone(value));});
  await assert.rejects(writer.batch(resultEntries(parseMetaProgress(store.get('meta_progress')),receipt(),true)),/interrupted/);
  const pending=parseRunReceipt(store.get('pending_result'))!;assert.ok(pending);
  const restored=parseMetaProgress(store.get('meta_progress'));
  const recovery=createSaveWriter(async(key,value)=>{store.set(key,structuredClone(value));});
  await recovery.batch(resultEntries(restored,pending,true));await recovery.save('pending_result',null);
  assert.equal(restored.totalRuns,1);assert.equal(restored.victories,1);assert.equal(restored.totalElites,15);assert.equal(store.get('run_progress'),null);assert.equal(store.get('pending_result'),null);
 }
});
test('повтор старого результата не очищает другой уже начатый забег',async()=>{
 const store=new Map<string,unknown>([['run_progress',{runId:'new_attempt',hp:75}]]),meta=parseMetaProgress(null);
 const writer=createSaveWriter(async(key,value)=>{store.set(key,value);});await writer.batch(resultEntries(meta,receipt(),false));
 assert.deepEqual(store.get('run_progress'),{runId:'new_attempt',hp:75});assert.equal(meta.totalRuns,1);
});
test('журнал остаётся после записи мета для повторной отправки рекорда',async()=>{
 const store=new Map<string,unknown>(),meta=parseMetaProgress(null);const writer=createSaveWriter(async(key,value)=>{store.set(key,value);});
 await writer.batch(resultEntries(meta,receipt(),true));assert.deepEqual(store.get('pending_result'),receipt());
 await writer.save('pending_result',null);assert.equal(store.get('pending_result'),null);
});
test('повреждённый журнал отвергается, история идентификаторов ограничена',()=>{
 for(const bad of [null,{}, {...receipt(),score:NaN},{...receipt(),id:'<bad>'},{...receipt(),floor:0},{...receipt(),victory:'yes'}])assert.equal(parseRunReceipt(bad),null);
 const meta=parseMetaProgress(null);for(let i=0;i<100;i++)applyRunReceipt(meta,{...receipt(),id:`attempt_${i}`});assert.equal(meta.completedRunIds!.length,64);assert.equal(meta.totalRuns,100);
});

test('повтор после отказа самой первой записи не удваивает локальный итог',async()=>{
 const store=new Map<string,unknown>(),meta=parseMetaProgress(null);let fail=true;
 const writer=createSaveWriter(async(key,value)=>{if(fail){fail=false;throw new Error('first write');}store.set(key,value);});
 await assert.rejects(writer.batch(resultEntries(meta,receipt(),true)),/first write/);
 await writer.batch(resultEntries(meta,receipt(),true));
 assert.equal(meta.totalRuns,1);assert.equal(meta.victories,1);assert.equal(parseMetaProgress(store.get('meta_progress')).totalRuns,1);
});
