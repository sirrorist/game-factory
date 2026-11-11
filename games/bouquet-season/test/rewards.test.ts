import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyEffects, effectDefinition, type EffectsState } from '../src/core/effects.ts';
import { drawReward } from '../src/core/rewards.ts';
import { newStory, storySteps } from '../src/core/progress.ts';

test('Сохраняемая тройка: растение/оборудование/любое, уникальные варианты и воспроизводимый RNG', () => {
  const fx=emptyEffects(), progress=newStory();
  for (let seed=1;seed<=50;seed++) {
    const first=drawReward(fx,progress,seed);assert.deepEqual(first,drawReward(fx,progress,seed));
    assert.equal(first.options.length,3);assert.equal(new Set(first.options.map(o=>`${o.effect}:${o.target}`)).size,3);
    assert.equal(effectDefinition(first.options[0]!.effect).category,'plant');assert.equal(effectDefinition(first.options[1]!.effect).category,'device');
    assert.ok(first.options.every(o=>!['P5','E3','E4'].includes(o.effect)));assert.notEqual(first.rng,seed);
  }
});

test('Сюжет — накопленная цепочка, открывает свойство для будущих выборов, не включает его', () => {
  assert.deepEqual(storySteps({main:0,urgent:3,wins:2}),[false,false,false]);
  assert.deepEqual(storySteps({main:1,urgent:0,wins:0}),[true,false,false]);
  assert.deepEqual(storySteps({main:3,urgent:1,wins:0}),[true,true,false]);
  assert.deepEqual(storySteps({main:3,urgent:1,wins:1}),[true,true,true]);
  const found=new Set<string>(),fx=emptyEffects();
  for(let seed=1;seed<100;seed++)for(const o of drawReward(fx,{main:3,urgent:1,wins:1},seed).options)found.add(o.effect);
  assert.ok(found.has('P5')&&found.has('E3')&&found.has('E4'));assert.deepEqual(fx,emptyEffects());
});

test('Уже выбранные общие свойства не предлагаются повторно, новые экземпляры модулей допустимы', () => {
  const fx:EffectsState={...emptyEffects(),globals:[{effect:'P1',target:'carnation'},{effect:'E1',target:'lamp'}],modules:[{id:1,effect:'P4',at:null}],nextId:2};
  for(let seed=1;seed<50;seed++)assert.ok(drawReward(fx,newStory(),seed).options.every(o=>!(o.effect==='P1'&&o.target==='carnation')&&o.effect!=='E1'));
});
