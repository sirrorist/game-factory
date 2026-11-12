import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlant, growDay, cutPlant, type PlantState } from '../src/core/growth.ts';
import { isPlant, type ObjectKind, type PlacedObject } from '../src/core/layout.ts';
import { sameCell } from '../src/core/field.ts';
import { ru } from '../src/i18n/ru.ts';
import { msg } from './ru-match.ts';

const object=(kind:ObjectKind,q=0,r=0):PlacedObject=>({kind,q,r,adaptation:0});
const garden=(objects:PlacedObject[])=>({objects,plants:objects.filter(o=>isPlant(o.kind)).map(newPlant)});
const first=(value:{plants:PlantState[]})=>value.plants.find(p=>sameCell(p,{q:0,r:0}))!;
const days=(initial:ReturnType<typeof garden>,count:number)=>{
  let value=initial;for(let i=0;i<count;i++)value=growDay(value.objects,value.plants);return value;
};
test('База 4 дня, дополнительные условия и свой вид дают независимые половины; минимум 2 дня роста',()=>{
  const base=garden([object('carnation'),object('sprinkler',1,0)]);
  assert.equal(first(days(base,1)).growth,2);assert.equal(first(days(base,3)).yield,0);
  assert.equal(first(days(base,4)).yield,2);
  const extra=garden([...base.objects,object('lamp',0,1)]);
  assert.equal(first(days(extra,1)).growth,3);assert.equal(first(days(extra,2)).yield,0);
  assert.equal(first(days(extra,3)).yield,2);
  const same=garden([...base.objects,object('carnation',-1,0)]);
  assert.equal(first(days(same,1)).growth,3);
  const full=garden([...extra.objects,object('carnation',-1,0)]);
  assert.equal(first(days(full,1)).growth,4);assert.equal(first(days(full,1)).yield,0);
  assert.equal(first(days(full,2)).yield,2);
  assert.deepEqual(first(base),newPlant({q:0,r:0}));
});
test('Профили ухода различаются; готовое живое растение не растёт повторно до срезки',()=>{
  const chrys=garden([object('chrysanthemum'),object('lamp',1,0)]);
  assert.equal(first(days(chrys,4)).yield,2);
  const wrong=garden([object('chrysanthemum'),object('sprinkler',1,0)]);
  assert.equal(first(days(wrong,1)).growth,0);assert.equal(first(days(wrong,1)).wilt,1);
  const ready=days(chrys,4);assert.deepEqual(first(days(ready,5)),first(ready));
});
test('Несколько соседей/устройств не суммируют бонус; урожай 3 требует другого вида весь цикл',()=>{
  const objects=[object('carnation'),object('sprinkler',1,0),object('lamp',0,1),object('carnation',-1,0),object('chrysanthemum',1,-1)];
  const value=garden(objects);assert.equal(first(days(value,2)).yield,3);
  const many=garden([...objects,object('carnation',0,-1),object('sprinkler',-1,1)]);
  assert.equal(first(days(many,1)).growth,4);assert.equal(first(days(many,2)).yield,3);
  const noOther=garden(objects.filter(o=>o.kind!=='chrysanthemum'));
  const started=days(noOther,1);
  const late={objects,plants:[...started.plants,newPlant({q:1,r:-1})]};
  assert.equal(first(days(late,1)).yield,2,'позднее соседство не исправляет историю');
  const ready=days(noOther,2);assert.equal(first(days({...ready,objects,plants:[...ready.plants,newPlant({q:1,r:-1})]},1)).yield,2);
  const bonusReady=days(value,2);
  const removed={objects:bonusReady.objects.filter(o=>o.kind!=='chrysanthemum'),plants:bonusReady.plants.filter(p=>!sameCell(p,{q:1,r:-1}))};
  assert.equal(first(days(removed,1)).yield,3,'при готовности урожай уже зафиксирован');
});
test('Три подряд плохих дня: предупреждение, опасность, постоянная гибель и потеря готового урожая',()=>{
  const initial=garden([object('carnation')]);
  assert.equal(first(days(initial,1)).wilt,1);assert.equal(first(days(initial,2)).wilt,2);
  const dead=days(initial,3);assert.equal(first(dead).wilt,3);
  const watered={...dead,objects:[...dead.objects,object('sprinkler',1,0)]};
  assert.deepEqual(first(days(watered,3)),first(dead));
  const ready=days(garden([object('carnation'),object('sprinkler',1,0)]),4);
  const dry={...ready,objects:ready.objects.filter(o=>o.kind!=='sprinkler')};
  assert.equal(first(days(dry,2)).yield,2);assert.equal(first(days(dry,3)).yield,0);
  assert.throws(()=>cutPlant(dead.objects,dead.plants,{q:0,r:0}),msg(ru.errors.cutOnlyReady));
});
test('Исправление условий занимает один день без роста, сохраняет прогресс и разрывает плохую серию',()=>{
  const healthy=days(garden([object('carnation'),object('sprinkler',1,0)]),1);
  const dry=days({...healthy,objects:healthy.objects.filter(o=>o.kind!=='sprinkler')},2);
  assert.equal(first(dry).growth,2);
  const restored=days({...dry,objects:healthy.objects},1);
  assert.equal(first(restored).growth,2);assert.equal(first(restored).wilt,0);assert.equal(first(restored).recovering,true);
  const next=days(restored,1);assert.equal(first(next).growth,4);assert.equal(first(next).recovering,false);
  const again=days({...restored,objects:dry.objects},1);assert.equal(first(again).wilt,1);
});
test('Адаптация пропускает один день роста; плохой уход учитывается и в день адаптации',()=>{
  const base=days(garden([object('carnation'),object('sprinkler',1,0)]),1);
  const moved={...base,objects:base.objects.map(o=>isPlant(o.kind)?{...o,adaptation:1 as const}:o)};
  const paused=days(moved,1);assert.equal(first(paused).growth,2);assert.equal(paused.objects[0]!.adaptation,0);
  assert.equal(first(days(paused,1)).growth,4);
  const bad=days({...moved,objects:moved.objects.filter(o=>isPlant(o.kind))},1);
  assert.equal(first(bad).wilt,1);assert.equal(bad.objects[0]!.adaptation,0);
  const both=days({...moved,plants:moved.plants.map(p=>({...p,wilt:1}))},1);
  assert.equal(first(both).growth,2);assert.equal(first(both).recovering,true);
  assert.equal(first(days(both,1)).growth,4);
});
test('Живое соседство берётся из общего снимка начала дня, результат не зависит от порядка обхода',()=>{
  const initial=garden([object('carnation'),object('sprinkler',1,0),object('carnation',-1,0),object('chrysanthemum',0,-1)]);
  initial.plants=initial.plants.map(p=>sameCell(p,{q:0,r:0})?p:{...p,wilt:2});
  const grown=days(initial,1);assert.equal(first(grown).growth,3);assert.equal(first(grown).bonus,true);
  const reversed=days({objects:[...initial.objects].reverse(),plants:[...initial.plants].reverse()},1);
  assert.deepEqual([...grown.plants].sort((a,b)=>a.q-b.q||a.r-b.r),[...reversed.plants].sort((a,b)=>a.q-b.q||a.r-b.r));
  const next=days(grown,1);assert.equal(first(next).growth,5);assert.equal(first(next).bonus,false);
});
test('Срезка фиксированного урожая сохраняет растение/увядание, сбрасывает только цикл и не меняет исходник',()=>{
  const ready=days(garden([object('carnation'),object('sprinkler',1,0)]),4);
  const bad=days({...ready,objects:ready.objects.filter(o=>o.kind!=='sprinkler')},1);
  const cut=cutPlant(bad.objects,bad.plants,{q:0,r:0});
  assert.equal(cut.amount,2);assert.equal(cut.kind,'carnation');assert.equal(first(cut).wilt,1);
  assert.equal(first(cut).growth,0);assert.equal(first(cut).growthDays,0);assert.equal(first(cut).yield,0);
  assert.equal(first(bad).yield,2);
  assert.throws(()=>cutPlant(bad.objects,cut.plants,{q:0,r:0}),msg(ru.errors.cutOnlyReady));
  const recovered=days({objects:ready.objects,plants:cut.plants},1);
  assert.equal(first(recovered).growth,0);
  assert.equal(first(days(recovered,4)).yield,2);
});
