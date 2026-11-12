import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newProfile,startSeason,isGameState} from '../src/core/state.ts';
import {purchase} from '../src/core/shop.ts';
import {acceptOrder,submitOrder,chooseReward,closeDay} from '../src/core/calendar.ts';
import {orderCandidates} from '../src/core/orders.ts';
import {startEvents} from '../src/core/events.ts';
import {decode,encode} from '../src/core/saves.ts';
import { ru } from '../src/i18n/ru.ts';
import { msg } from './ru-match.ts';
test('Принятие второго заказа повторно проверяет общий запас обоих; один стебель не расходуется дважды',()=>{
  let s=newProfile();s.profile.coins=120;s.profile.experience=180;s=purchase(s,'main-slot');s=startSeason(s,123);
  const run=s.season!;run.day=20;run.status='growing';run.events=startEvents(123,20).events;run.garden.stock.carnation=14;
  run.board.active=[{...orderCandidates(1,20)[0]!,id:100}];run.board.offers=[{...orderCandidates(2,20)[0]!,id:101}];run.board.nextId=102;
  assert.ok(isGameState(s));const original=structuredClone(s);assert.throws(()=>acceptOrder(s,101),msg(ru.errors.jointPlanMissing));assert.deepEqual(s,original);
});
test('Неверные открытия/слоты/контур/счётчики отвергаются с правильным хешем, а не по повреждённой оболочке',async()=>{
  const s=startSeason(newProfile(),123);
  const bads=[
    (x:any)=>x.profile.owned.push('field'),
    (x:any)=>x.profile.owned.push('future'),
    (x:any)=>x.profile.tutorial.push('accept','accept'),
    (x:any)=>x.season.access.push('main-slot'),
    (x:any)=>x.season.garden.stock.rose=1,
    (x:any)=>x.season.layout.objects.push({q:-4,r:3,kind:'carnation',adaptation:0}),
  ];
  for(const mutate of bads){const value=structuredClone(s);mutate(value);const payload=JSON.stringify(value),record={...await encode(s,1),payload,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))).toString('hex')};assert.equal((await decode(record)).status,'invalid');}
});

test('Опубликованная тройка второго места переживает сдачу/выбор/reload с прежними составами, ID, RNG и сроком',async()=>{
  let s=newProfile();s.profile.coins=120;s.profile.experience=180;s=purchase(s,'main-slot');s=startSeason(s,1);
  s.season!.garden.stock.carnation=100;s.season!.garden.stock.chrysanthemum=100;
  s=acceptOrder(s,s.season!.board.offers[0]!.id);s=closeDay(s);const offers=structuredClone(s.season!.board.offers),nextId=s.season!.board.nextId;
  assert.ok(offers.length);assert.equal(offers[0]!.appeared,1);assert.equal(offers[0]!.deadline,6);
  s=submitOrder(s,s.season!.board.active[0]!.id,true);assert.deepEqual(s.season!.board.offers,offers);assert.ok(isGameState(s));
  const rng=s.season!.rng,copy=await decode(await encode(s,1));assert.equal(copy.status,'valid');if(copy.status!=='valid')return;
  s=chooseReward(copy.state,1);assert.deepEqual(s.season!.board.offers,offers);assert.equal(s.season!.rng,rng);assert.equal(s.season!.board.nextId,nextId);
  assert.equal((await decode(await encode(s,2))).status,'valid');
});
