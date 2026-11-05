import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growDay, newPlant, cutPlant, type PlantState } from '../src/core/growth.ts';
import { emptyEffects, type EffectsState, type ModuleId } from '../src/core/effects.ts';
import type { PlacedObject, ObjectKind } from '../src/core/layout.ts';
const o = (kind: ObjectKind, q: number, r = 0): PlacedObject => ({ kind, q, r, adaptation: 0 });
const module = (effect: ModuleId, q = 1, r = 0): EffectsState => ({ ...emptyEffects(), modules: [{ id: 1, effect, at: { q, r } }], nextId: 2 });
const alone = [o('sprinkler', 0), o('carnation', 1)];
function days(objects: PlacedObject[], count: number, fx = emptyEffects(), initial: PlantState[] = objects.filter(o=>o.kind==='carnation'||o.kind==='chrysanthemum').map(newPlant)): PlantState[] {
  let plants = initial;
  for (let i=0;i<count;i++) { const next = growDay(objects, plants, fx); plants=next.plants; objects=next.objects; }
  return plants;
}

test('P1 меняет обязательный и дополнительный уход только выбранного вида', () => {
  const objects = [o('lamp', 0), o('carnation', 1)];
  assert.equal(days(objects, 1)[0]!.wilt, 1);
  const fx = emptyEffects(); fx.globals.push({ effect: 'P1', target: 'carnation' });
  assert.equal(days(objects, 1, fx)[0]!.wilt, 0); assert.equal(days(objects, 1, fx)[0]!.growth, 2);
  fx.globals[0]!.target='chrysanthemum'; assert.equal(days(objects, 1, fx)[0]!.wilt, 1);
});

test('P4 заменяет условие скорости, не добавляет третий бонус и не меняет урожайное правило', () => {
  const mixed = [...alone, o('chrysanthemum', 1, -1)];
  assert.equal(days(mixed, 1)[0]!.growth, 2);
  assert.equal(days(mixed, 1, module('P4'))[0]!.growth, 3);
  const same = [...alone, o('carnation', 1, -1)];
  assert.equal(days(same, 1)[0]!.growth, 3); assert.equal(days(same, 1, module('P4'))[0]!.growth, 2);
});

test('P5 весь цикл: отдельная история, один +1, поздняя установка не меняет урожай', () => {
  const withSupport=days(alone, 4, module('P5'))[0]!;
  assert.equal(withSupport.yield, 3); assert.equal(withSupport.bonus, false); assert.equal(withSupport.supportBonus, true);
  const ordinary=days(alone, 4)[0]!; assert.equal(ordinary.yield, 2);
  assert.equal(days(alone, 1, module('P5'), [ordinary])[0]!.yield, 2);
  const first=days(alone,1);assert.equal(first[0]!.supportBonus,false);
  assert.equal(days(alone,3,module('P5'),first)[0]!.yield,2);
  const mixed=[...alone,o('chrysanthemum',1,-1),o('lamp',0,-1)];
  assert.equal(days(mixed,4,module('P5'))[0]!.yield,3);
});

test('Нельзя склеить половины цикла из другого вида и P5; независимый полный источник сохраняет +1', () => {
  const mixed=[...alone,o('chrysanthemum',1,-1)];
  const first=days(mixed,1);assert.equal(first[0]!.bonus,true);assert.equal(first[0]!.supportBonus,false);
  const switched=days(alone,3,module('P5'),[first[0]!])[0]!;
  assert.equal(switched.bonus,false);assert.equal(switched.supportBonus,false);assert.equal(switched.yield,2);
  const supported=days(mixed,1,module('P5'));
  assert.equal(days(alone,3,module('P5'),[supported[0]!])[0]!.yield,3);
});

test('История P5 учитывает адаптацию/восстановление; срезка начинает обе истории заново', () => {
  const adapting=[alone[0]!,{...alone[1]!,adaptation:1 as const}];
  const skipped=days(adapting,1);assert.equal(skipped[0]!.growth,0);assert.equal(skipped[0]!.supportBonus,false);
  assert.equal(days(alone,4,module('P5'),skipped)[0]!.yield,2);
  const ready=days(alone,4,module('P5'));const cut=cutPlant(alone,ready,{q:1,r:0}).plants[0]!;
  assert.equal(cut.supportBonus,true);assert.equal(cut.bonus,true);assert.equal(cut.yield,0);
  assert.equal(days(alone,4,emptyEffects(),[cut])[0]!.yield,2);
  const dying=days([alone[1]!],3,module('P5'))[0]!;assert.equal(dying.wilt,3);assert.equal(dying.supportBonus,false);
});
