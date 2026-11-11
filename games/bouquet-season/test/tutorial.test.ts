import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newProfile,startSeason,editLayout,changeSettings,isGameState} from '../src/core/state.ts';
import {acceptOrder,closeDay,harvestAll,submitOrder,production} from '../src/core/calendar.ts';
import {recordTutorial,tutorialTip} from '../src/core/tutorial.ts';
import {findProductionPlan} from '../src/core/planner.ts';
import {encode,decode} from '../src/core/saves.ts';
test('Подсказки идут внутри настоящего первого заказа; выключение/включение и reload не повторяют освоенное',async()=>{
  let s=startSeason(newProfile(),123);assert.equal(tutorialTip(s)?.id,'accept');
  s=recordTutorial(acceptOrder(s,s.season!.board.offers.find(o=>o.ingredients.length===1)!.id));assert.equal(tutorialTip(s)?.id,'plant');
  const order=s.season!.board.active[0]!,plan=findProductionPlan(production(s.season!),[order])!;
  for(const o of plan.layout!)s=recordTutorial(editLayout(s,{type:'place',kind:o.kind,to:o}));
  assert.equal(tutorialTip(s)?.id,'day');
  const before=structuredClone(s.season);s=changeSettings(s,{tutorial:false});assert.equal(tutorialTip(s),null);assert.deepEqual(s.season,before);
  s=recordTutorial(closeDay(s));s=changeSettings(s,{tutorial:true});assert.equal(tutorialTip(s)?.id,'cut');
  while(!s.season!.garden.plants.some(p=>p.yield))s=recordTutorial(closeDay(s));
  s=recordTutorial(harvestAll(s));assert.equal(tutorialTip(s)?.id,'submit');
  const copy=await decode(await encode(s,4));assert.equal(copy.status,'valid');if(copy.status==='valid')assert.deepEqual(tutorialTip(copy.state),tutorialTip(s));
  while(!order.ingredients.every(i=>s.season!.garden.stock[i.kind]>=i.count)){s=recordTutorial(harvestAll(recordTutorial(closeDay(s))));}
  s=recordTutorial(submitOrder(s,order.id,true));assert.equal(tutorialTip(s),null);assert.ok(s.profile.tutorial.includes('submit'));assert.ok(isGameState(s));
  const bad=structuredClone(s);bad.profile.tutorial.push('unknown');assert.equal(isGameState(bad),false);
});
