import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startEvents,urgentCandidates,discoverEvents,fairGoal,eventIncome,isEvents} from '../src/core/events.ts';
import {newProfile,startSeason,isGameState,editLayout,installModule,refreshStateOffers} from '../src/core/state.ts';
import {acceptOrder,submitOrder,chooseReward,production,harvestAll,closeDay,submitFair,acceptUrgent,submitUrgent,spendingRisk,urgentRisk,hasStock} from '../src/core/calendar.ts';
import {activeOrderFixture,readyOrderFixture,orderFixture} from './order-fixtures.ts';
import {findProductionPlan} from '../src/core/planner.ts';
import {storySteps} from '../src/core/progress.ts';
import {encode,decode,SaveSession,type StoragePort} from '../src/core/saves.ts';
import {orderCandidates} from '../src/core/orders.ts';
import {legacyState} from './legacy-fixtures.ts';
import { ru } from '../src/i18n/ru.ts';
import { msg } from './ru-match.ts';

test('Два разных шаблона и окна сохранены; занятое место откладывает срок, поздняя карточка проверяет запас',()=>{
  for(let seed=1;seed<=50;seed++){
    const a=startEvents(seed),b=startEvents(seed);assert.deepEqual(a,b);assert.ok(isEvents(a.events,1,false));
    assert.notEqual(a.events.requests[0]!.template,a.events.requests[1]!.template);
  }
  const s=activeOrderFixture(0,19,15),requests=s.season!.events.requests;
  requests[0]={id:1,day:3,template:'U1',status:'active',card:urgentCandidates({id:1,template:'U1'},16)[0]!,delivered:null};
  requests[1]={id:2,day:8,template:'U3',status:'waiting',card:null,delivered:null};
  const held=discoverEvents(s.season!.events,production(s.season!),123);assert.equal(held.events.requests[1]!.card,null);assert.equal(held.rng,123);
  requests[0]!.status='expired';
  const empty=discoverEvents(s.season!.events,{...production(s.season!),day:20},123);assert.equal(empty.events.requests[1]!.status,'waiting');
  const ready=discoverEvents(s.season!.events,{...production(s.season!),day:20,stock:{carnation:20,chrysanthemum:20,rose:0,tulip:0,gerbera:0,lily:0}},123);
  assert.equal(ready.events.requests[1]!.card!.appeared,20);assert.equal(ready.events.requests[1]!.card!.deadline,20);assert.ok(isEvents(ready.events,20,false));
});

test('Добровольная конкуренция предупреждает, принятие её не блокирует; расход готовой обязательной цели требует подтверждения',()=>{
  let s=readyOrderFixture(0,20);s.season!.garden.stock={carnation:9,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0};
  const r=s.season!.events.requests[0]!;r.template='U1';r.status='offer';r.card=urgentCandidates(r,20)[0]!;
  assert.equal(urgentRisk(s,r.id),true);
  s=acceptUrgent(s,r.id);assert.equal(s.season!.events.requests[0]!.status,'active');
  const risks=spendingRisk(s,r.card.ingredients,r.card.id);assert.equal(risks[0]!.name,ru.orders.titles.targetMain(1));
  assert.throws(()=>submitUrgent(s,r.id),msg(ru.errors.spendRisk));
  const next=submitUrgent(s,r.id,true);assert.equal(next.season!.garden.stock.carnation,0);assert.equal(eventIncome(next.season!.events),27);
  assert.equal(next.profile.progress.urgent,1);assert.equal(next.season!.board.active.length,1);assert.ok(isGameState(next));
  assert.throws(()=>submitUrgent(next,r.id),msg(ru.errors.urgentNoneActive));
});

test('Ярмарка: окно, точный расход, бонус один раз, pending U3/ярмарки сохраняет основной и его срок',()=>{
  let s=readyOrderFixture(2,6);s.season!.garden.stock={carnation:100,chrysanthemum:100,rose:0,tulip:0,gerbera:0,lily:0};
  assert.throws(()=>submitFair({...s,season:{...s.season!,day:5}}),msg(ru.errors.fairUnavailable));
  const order=structuredClone(s.season!.board.active);
  s=submitFair(s,false,true);assert.equal(s.season!.garden.stock.carnation,92);assert.equal(s.profile.experience,38);
  assert.throws(()=>submitFair(s),msg(ru.errors.fairUnavailable));
  s=submitFair(s,true,true);assert.equal(s.season!.garden.stock.chrysanthemum,86);assert.equal(s.season!.board.pending!.source,'fair');
  assert.deepEqual(s.season!.board.active,order);assert.ok(isGameState(s));
  s=chooseReward(s,1);assert.deepEqual(s.season!.board.active,order);assert.equal(eventIncome(s.season!.events),84);
  assert.throws(()=>submitFair(s,true),msg(ru.errors.fairUnavailable));
  const r=s.season!.events.requests[0]!;r.template='U3';r.status='offer';r.card=urgentCandidates(r,6)[0]!;
  s=acceptUrgent(s,r.id);s=submitUrgent(s,r.id,true);assert.equal(s.season!.board.pending!.source,'urgent');assert.deepEqual(s.season!.board.active,order);assert.ok(isGameState(s));
});

test('Одновременные штрафы основного и минимума до роста; необязательная просьба без штрафа; ранний финал отменяет будущую ярмарку',()=>{
  let s=activeOrderFixture(0,10,5,2);const r=s.season!.events.requests[0]!;r.status='active';r.card=urgentCandidates(r,r.template==='U3'?6:7)[0]!;
  s=closeDay(s);assert.equal(s.season!.reputation,0);assert.equal(s.season!.day,10);assert.equal(s.season!.board.result!.reason,'reputation');assert.equal(s.season!.events.requests[0]!.status,'expired');assert.ok(isGameState(s));
  const ready=readyOrderFixture(5,6),final=ready.season!.board.active[0]!;
  assert.ok(findProductionPlan(production(ready.season!),[final,...fairGoal(ready.season!.events,6)]));
  const win=submitOrder(ready,final.id);assert.equal(win.season!.board.result!.outcome,'win');assert.equal(win.season!.reputation,3);assert.equal(eventIncome(win.season!.events),0);assert.equal(win.season!.events.fair.closed,true);assert.ok(isGameState(win));
});

test('Выбор/установка/перенос модуля: запись и повтор не выбирают заново; reload хранит все три варианта',async()=>{
  let s=submitOrder(readyOrderFixture(0,1),20);const record=await encode(s,1),copy=await decode(record);assert.equal(copy.status,'valid');if(copy.status!=='valid')return;
  assert.deepEqual(copy.state,s);let fail=true;let stored:unknown=null;
  const port:StoragePort={mode:'standalone',gameId:'bouquet-season',persistent:true,load:async()=>stored,save:async(key,value)=>{if(key==='progress'&&fail)throw Error('Отказ');stored=value;}};
  const session=new SaveSession(port,s,record,null);assert.equal(await session.act(value=>chooseReward(value,1)),false);
  const chosen=structuredClone(session.state);assert.equal(await session.act(value=>chooseReward(value,0)),false);fail=false;assert.equal(await session.retry(),true);assert.deepEqual(session.state,chosen);assert.equal(session.savedRevision,2);
  assert.throws(()=>chooseReward(session.state,0),msg(ru.errors.noPendingChoice));
  s=editLayout(session.state,{type:'place',kind:'carnation',to:{q:0,r:0}});
  s.season!.effects.globals=[];s.season!.effects.modules=[{id:1,effect:'P6',at:null}];s.season!.effects.nextId=2;s.season!.effects.undo=[{id:1,at:null}];
  s=installModule(s,1,{q:0,r:0});assert.equal(s.season!.layout.undo,null);assert.ok(isGameState(s));
  s=editLayout(s,{type:'move',from:{q:0,r:0},to:{q:1,r:0}});assert.deepEqual(s.season!.effects.modules[0]!.at,{q:1,r:0});
  s=editLayout(s,{type:'undo'});assert.deepEqual(s.season!.effects.modules[0]!.at,{q:0,r:0});
  s=editLayout(s,{type:'remove',from:{q:0,r:0}});assert.equal(s.season!.effects.modules[0]!.at,null);assert.ok(isGameState(s));
});

test('Схема4 pending мигрирует воспроизводимо; точная старая форма и новые состояния проверяются с правильным SHA',async()=>{
  const current=submitOrder(readyOrderFixture(0,1),20),old=legacyState(current,4);
  const payload=JSON.stringify(old),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))).toString('hex');
  const record={schemaVersion:4 as const,revision:7,savedAt:new Date().toISOString(),payload,sha256};
  const a=await decode(record),b=await decode(record);assert.equal(a.status,'valid');assert.deepEqual(a,b);if(a.status!=='valid')return;
  assert.equal(a.state.profile.progress.main,1);assert.equal(a.state.season!.board.pending!.options.length,3);assert.ok(isGameState(a.state));
  const bad=structuredClone(a.state);bad.season!.board.pending!.options[1]=bad.season!.board.pending!.options[0]!;assert.equal(isGameState(bad),false);
  const extra=JSON.stringify({...old,season:{...old.season,effects:{}}}),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(extra))).toString('hex');
  assert.equal((await decode({...record,payload:extra,sha256:hash})).status,'invalid');
});

test('Сюжет накопительный: действия до шага, поражение и следующий сезон не теряют прогресс; открытие не выдаёт эффект',()=>{
  let s=readyOrderFixture(2,20);s.profile.progress.urgent=1;s=submitOrder(s,20);assert.deepEqual(storySteps(s.profile.progress),[true,true,false]);
  s=chooseReward(s,1);s=refreshStateOffers(s);assert.ok(s.season!.effects.globals.length+s.season!.effects.modules.length===1);
  // Завершение без активного через календарь отдельно покрыто; профиль сохраняется новым сезоном после финала.
  const win=submitOrder(readyOrderFixture(5,20),20);win.profile.progress.urgent=1;
  const next=startSeason(win,9);assert.deepEqual(storySteps(next.profile.progress),[true,true,true]);assert.equal(next.season!.effects.modules.length+next.season!.effects.globals.length,0);
});

test('Полный обычный сезон: реальные посадки, календарь, срезки, ярмарка, пять выборов и финальная победа',async()=>{
  let s=startSeason(newProfile(),123);const trace:unknown[]=[];
  for(let stage=1;stage<=6;stage++){
    const candidates=s.season!.board.offers.map(order=>({order,plan:findProductionPlan(production(s.season!),[order,...fairGoal(s.season!.events,s.season!.day)])})).filter(c=>c.plan).sort((a,b)=>a.plan!.days.at(-1)!.day-b.plan!.days.at(-1)!.day || b.order.ingredients.length-a.order.ingredients.length);
    const candidate=candidates[0];assert.ok(candidate,`Нет предложения ступени ${stage} в день ${s.season!.day}; ${JSON.stringify(trace)}`);
    const {order,plan}=candidate;assert.ok(plan);
    s=acceptOrder(s,order.id);
    if(plan.layout){
      for(const old of [...s.season!.layout.objects])if(!plan.layout.some(o=>o.kind===old.kind&&o.q===old.q&&o.r===old.r))s=editLayout(s,{type:'remove',from:old});
      for(const o of plan.layout)if(!s.season!.layout.objects.some(old=>old.kind===o.kind&&old.q===o.q&&old.r===o.r))s=editLayout(s,{type:'place',kind:o.kind,to:o});
    }
    for(const day of plan.days){
      while(s.season!.day<day.day)s=closeDay(s);
      s=harvestAll(s);
      if(day.delivered.includes(20000))s=submitFair(s,false,true);
      if(day.delivered.includes(order.id))s=submitOrder(s,order.id,true);
      assert.ok(isGameState(s),`Невалидный день ${s.season!.day}`);
    }
    trace.push({stage,day:s.season!.day,stock:s.season!.garden.stock});
    if(stage<6){assert.ok(s.season!.board.pending);s=chooseReward(s,1);}
    const copy=await decode(await encode(s,stage));assert.equal(copy.status,'valid');
  }
  assert.equal(s.season!.board.result!.outcome,'win');assert.equal(s.season!.board.completed.length,5);assert.equal(s.profile.progress.main,5);assert.equal(s.profile.progress.wins,1);assert.equal(s.season!.events.fair.minimum,true);
  console.log('Полное прохождение:',JSON.stringify(trace));
});

test('Готовый минимум ярмарки можно отложить ради реального финала до её штрафа, общий запас не списывается заранее',()=>{
  let s=orderFixture(5,7,20);s.season!.board.offers=[];
  for(const [kind,q,r] of [['sprinkler',0,0],['lamp',0,1],['carnation',1,0],['carnation',1,-1],['chrysanthemum',1,1],['chrysanthemum',-1,1]] as const)s=editLayout(s,{type:'place',kind,to:{q,r}});
  for(const p of s.season!.garden.plants)Object.assign(p,{growth:6,growthDays:3,bonus:false,supportBonus:false});
  s.season!.layout.undo=null;s.season!.garden.undo=null;s.season!.effects.undo=null;
  const final={...orderCandidates(6,1)[0]!,id:20};s.season!.board.offers=[final];s.season!.board.nextId=21;
  assert.ok(isGameState(s));const plan=findProductionPlan(production(s.season!),[final,...fairGoal(s.season!.events,7)]);assert.ok(plan);assert.equal(plan.days.at(-1)!.day,8);
  s=acceptOrder(s,20);s=harvestAll(closeDay(s));s=submitOrder(s,20);assert.equal(s.season!.board.result!.outcome,'win');assert.equal(s.season!.events.fair.minimum,false);assert.equal(s.season!.reputation,3);assert.ok(isGameState(s));
});

test('Просьба не обещает будущий рост при пустой основной доске; готовый урожай и запас не требуют нового дня',()=>{
  let s=activeOrderFixture(4,17,12);
  for(const [kind,q,r] of [['sprinkler',0,0],['carnation',1,0],['carnation',1,-1],['carnation',0,-1],['carnation',-1,0],['carnation',-1,1]] as const)s=editLayout(s,{type:'place',kind,to:{q,r}});
  for(const p of s.season!.garden.plants)Object.assign(p,{growth:3,growthDays:1,bonus:false,supportBonus:false});
  s.season!.layout.undo=null;s.season!.garden.undo=null;s.season!.effects.undo=null;
  s.season!.events.requests=[{id:1,day:3,template:'U2',status:'active',card:urgentCandidates({id:1,template:'U2'},14)[0]!,delivered:null},{id:2,day:8,template:'U1',status:'waiting',card:null,delivered:null}];
  assert.ok(isGameState(s));s=closeDay(s);assert.equal(s.season!.day,18);assert.equal(s.season!.board.offers.length,0);assert.equal(s.season!.events.requests[1]!.status,'waiting');assert.ok(isGameState(s));
  const stale=structuredClone(s),r=stale.season!.events.requests[1]!;r.status='offer';r.card=urgentCandidates(r,18)[0]!;assert.throws(()=>acceptUrgent(stale,2),msg(ru.errors.urgentNeedMain));
  s.season!.garden.stock.carnation=9;s=refreshStateOffers(s);assert.equal(s.season!.events.requests[1]!.status,'offer');s=acceptUrgent(s,2);s=submitUrgent(s,2);assert.equal(s.season!.events.requests[1]!.status,'done');assert.ok(isGameState(s));
});
