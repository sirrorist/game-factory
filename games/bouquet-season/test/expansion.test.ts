import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newProfile,startSeason,editLayout,isGameState,refreshStateOffers} from '../src/core/state.ts';
import {PURCHASES,purchase} from '../src/core/shop.ts';
import {production,acceptOrder,submitOrder,chooseReward,closeDay,acceptUrgent} from '../src/core/calendar.ts';
import {emptyStock} from '../src/core/garden.ts';
import {orderCandidates} from '../src/core/orders.ts';
import {findProductionPlan} from '../src/core/planner.ts';
import {growDay,newPlant} from '../src/core/growth.ts';
import {deviceZone} from '../src/core/conditions.ts';
import {fieldCells,hasCell} from '../src/core/field.ts';
import {emptyEffects} from '../src/core/effects.ts';
import {drawReward} from '../src/core/rewards.ts';
import {decode,encode} from '../src/core/saves.ts';
export function expandedProfile(){let s=newProfile();s.profile.coins=1000;s.profile.experience=600;for(const p of PURCHASES)s=purchase(s,p.id);return s;}
test('37 клеток: новые координаты, все шесть профилей ухода, зоны обрезаны по купленному участку',()=>{
  let s=startSeason(expandedProfile(),123);
  for(const [kind,q,r] of [['lamp',-4,2],['sprinkler',-3,2],['rose',-4,3],['tulip',-4,1],['gerbera',-3,1],['lily',-3,3]] as const)s=editLayout(s,{type:'place',kind,to:{q,r}});
  assert.ok(isGameState(s));assert.ok(deviceZone({q:-4,r:2},s.season!.layout.objects,emptyEffects(),37).some(c=>c.q===-4&&c.r===3));
  assert.ok(deviceZone({q:-4,r:2},s.season!.layout.objects,emptyEffects(),37).every(c=>hasCell(37,c)));
  for(const kind of ['carnation','rose','lily','chrysanthemum','tulip','gerbera'] as const){
    const water=['carnation','rose','lily'].includes(kind),objects=[{q:0,r:0,kind,adaptation:0 as const},{q:1,r:0,kind:water?'sprinkler' as const:'lamp' as const,adaptation:0 as const}];
    assert.equal(growDay(objects,[newPlant({q:0,r:0})]).plants[0]!.growth,2);
    assert.equal(growDay([{...objects[0]!}, {...objects[1]!,kind:water?'lamp':'sprinkler'}],[newPlant({q:0,r:0})]).plants[0]!.wilt,1);
  }
  assert.equal(fieldCells(37).length,37);
});
test('Два основных резервируют разные ступени, сдача 2 перед 1 сохраняет первый и его срок, финал только после пяти',async()=>{
  let s=startSeason(expandedProfile(),123);s.season!.garden.stock={carnation:500,chrysanthemum:500,rose:500,tulip:500,gerbera:500,lily:500};
  s=acceptOrder(s,s.season!.board.offers[0]!.id);assert.equal(s.season!.board.offers[0]!.stage,2);
  s=acceptOrder(s,s.season!.board.offers[0]!.id);const first=structuredClone(s.season!.board.active[0]!),second=s.season!.board.active[1]!;
  assert.equal(s.season!.board.offers.length,0);s=submitOrder(s,second.id,true);assert.ok(isGameState(s));assert.deepEqual(s.season!.board.active,[first]);
  assert.equal((await decode(await encode(s,1))).status,'valid');
  s=chooseReward(s,0);assert.equal(s.season!.board.offers[0]!.stage,3);
  for(const stage of [3,4,5]){s=acceptOrder(s,s.season!.board.offers[0]!.id);s=chooseReward(submitOrder(s,s.season!.board.active.find(o=>o.stage===stage)!.id,true),0);assert.ok(isGameState(s));}
  assert.equal(s.season!.board.offers.length,0);assert.equal(s.season!.board.completed.length,4);
  s=submitOrder(s,first.id,true);assert.equal(s.season!.board.offers.length,0);s=chooseReward(s,0);
  assert.ok(s.season!.board.offers.every(o=>o.stage===6));assert.equal(s.season!.board.completed.length,5);
  s=acceptOrder(s,s.season!.board.offers[0]!.id);s=submitOrder(s,s.season!.board.active[0]!.id);assert.ok(isGameState(s));
  const coins=s.profile.coins;s=purchase({...s,profile:{...s.profile,owned:s.profile.owned.filter(x=>x!=='rose')}},'rose');assert.equal(s.profile.coins,coins-60);assert.ok(isGameState(s));
});
test('Провал ранней ступени заменяет поздние предложения после роста и сохраняет активный поздний заказ',()=>{
  let s=startSeason(expandedProfile(),123);s.season!.garden.stock={...emptyStock(),carnation:1000,chrysanthemum:1000,rose:1000,tulip:1000,gerbera:1000,lily:1000};
  s=acceptOrder(s,s.season!.board.offers[0]!.id);s=acceptOrder(s,s.season!.board.offers[0]!.id);
  s.season!.day=6;s.season!.status='growing';s.season!.board.active[1]!.deadline=7; // Другая карточка появилась позднее, тестируем закрытие.
  const later=s.season!.board.active[1]!;later.appeared=2;
  s=closeDay(s);assert.equal(s.season!.reputation,2);assert.equal(s.season!.day,7);assert.equal(s.season!.board.active[0]!.stage,2);assert.equal(s.season!.board.offers[0]!.stage,1);assert.ok(isGameState(s));
});
test('Второе событийное место допускает две принятые просьбы, одна покупка не открывает цветы сама',()=>{
  let s=startSeason(expandedProfile(),123);s.season!.day=8;s.season!.status='growing';s.season!.garden.stock={carnation:500,chrysanthemum:500,rose:500,tulip:500,gerbera:500,lily:500};
  s.season!.events.requests[1]!.day=8;s.season!.board.offers=[];s=refreshStateOffers(s);
  s=acceptUrgent(s,1);s=acceptUrgent(s,2);assert.equal(s.season!.events.requests.filter(r=>r.status==='active').length,2);assert.ok(isGameState(s));
  const p=newProfile();p.profile.experience=600;p.profile.coins=1000;const only=purchase(p,'field');assert.deepEqual(startSeason(only,123).season!.board.offers.flatMap(o=>o.ingredients).filter(i=>['rose','tulip','gerbera','lily'].includes(i.kind)),[]);
});
test('Новые рецепты/финал получают воспроизводимый план с шестью видами; награды не предлагают некупленный вид',()=>{
  const s=startSeason(expandedProfile(),123),state=production(s.season!);
  for(const recipe of ['R4','R5','R6','R7','R8']){const order={...orderCandidates(1,1,state.open).find(o=>o.recipe===recipe)!,id:1};const plan=findProductionPlan(state,[order]);assert.ok(plan,recipe);assert.ok(plan.days.at(-1)!.day<=6);}
  const options=new Set<string>();for(let seed=1;seed<100;seed++)for(const o of drawReward(emptyEffects(),{main:0,urgent:0,wins:0},seed,['carnation','chrysanthemum','lily']).options)if(o.target)options.add(o.target);
  assert.ok(options.has('lily'));assert.ok(!options.has('rose'));
});
