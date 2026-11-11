import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProductionPlan, type ProductionPlan } from '../src/core/planner.ts';
import { newProfile, startSeason, editLayout, enterGrowthDay, harvest, type GameState } from '../src/core/state.ts';
import { orderCandidates, type Order } from '../src/core/orders.ts';
import { sameCell } from '../src/core/field.ts';
import { isPlant, type PlantKind } from '../src/core/layout.ts';

const card = (stage: number, day: number, index = 0): Order => ({ ...orderCandidates(stage, day)[index]!, id: 1 });
const production = (s: GameState) => ({ day: s.season!.day, objects: s.season!.layout.objects, plants: s.season!.garden.plants, stock: s.season!.garden.stock });

// Проигрываем свидетельство настоящими командами игрока, не функциями симулятора.
function replay(initial: GameState, orders: Order[], plan: ProductionPlan): GameState {
  let s = structuredClone(initial);
  const cut = (): void => {
    for (const p of s.season!.garden.plants) if (p.yield && p.wilt < 3) s = harvest(s, p);
  };
  cut();
  if (plan.layout) {
    for (const o of s.season!.layout.objects) if (!plan.layout.some(n => sameCell(n, o) && n.kind === o.kind)) s = editLayout(s, { type: 'remove', from: o });
    for (const o of plan.layout) if (!s.season!.layout.objects.some(n => sameCell(n, o))) s = editLayout(s, { type: 'place', kind: o.kind, to: o });
  }
  const spent = new Set<number>();
  for (const day of plan.days) {
    if (day.day > s.season!.day) { s = enterGrowthDay(s); cut(); }
    for (const id of day.delivered) {
      assert.equal(spent.has(id), false);
      const o = orders.find(o => o.id === id)!; assert.ok(s.season!.day <= o.deadline);
      for (const i of o.ingredients) { assert.ok(s.season!.garden.stock[i.kind as PlantKind] >= i.count); s.season!.garden.stock[i.kind as PlantKind] -= i.count; }
      spent.add(id);
    }
    assert.deepEqual(s.season!.garden.stock, day.stock);
  }
  assert.equal(spent.size, orders.length);
  return s;
}

test('Новый профиль: все начальные кандидаты имеют воспроизводимый план без роста в день 1', () => {
  const s = startSeason(newProfile(), 123), original = structuredClone(s);
  for (const [i, candidate] of orderCandidates(1, 1).entries()) {
    const order = { ...candidate, id: i + 1 };
    const plan = findProductionPlan(production(s), [order]); assert.ok(plan);
    assert.equal(plan.days[0]!.day, 1); assert.deepEqual(plan.days[0]!.cut, {carnation:0,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0});
    assert.ok(replay(s, [order], plan).season!.day <= 6);
  }
  assert.deepEqual(s, original);
});

test('Запас не используется дважды, день 20 не даёт будущего урожая', () => {
  const s = startSeason(newProfile(), 123); s.season!.day = 20; s.season!.status = 'growing';
  s.season!.garden.stock.carnation = 8;
  const orders = [card(1, 20), { ...card(1, 20), id: 2 }];
  assert.equal(findProductionPlan(production(s), orders), null);
  s.season!.garden.stock.carnation = 16;
  const plan = findProductionPlan(production(s), orders); assert.ok(plan);
  assert.equal(plan.days.length, 1); replay(s, orders, plan);
  assert.equal(findProductionPlan(production(s), [{ ...orders[0]!, deadline: 19 }]), null);
  assert.equal(findProductionPlan(production(s), [card(6, 20)]), null);
});

test('Текущая готовность и прогресс сохранены; опорный план не требует переноса с бесплатным ростом', () => {
  let s = startSeason(newProfile(), 123);
  const first = card(1, 1, 4), plan = findProductionPlan(production(s), [first]); assert.ok(plan?.layout);
  for (const o of plan.layout) s = editLayout(s, { type: 'place', kind: o.kind, to: o });
  s = enterGrowthDay(enterGrowthDay(enterGrowthDay(s)));
  assert.ok(s.season!.garden.plants.some(p => p.yield));
  const now = findProductionPlan(production(s), [card(1, s.season!.day, 4)]); assert.ok(now);
  assert.equal(now.layout, null);
  replay(s, [card(1, s.season!.day, 4)], now);
  assert.ok(s.season!.layout.objects.every(o => !isPlant(o.kind) || o.adaptation === 0));
});
