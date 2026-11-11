import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS, emptyEffects, ownDeviceZone, conditionZone, editEffectBindings, isEffects, type EffectsState, type EffectOption, type ModuleId } from '../src/core/effects.ts';
import { plantConditions, deviceZone } from '../src/core/conditions.ts';
import { fieldCells, sameCell } from '../src/core/field.ts';
import type { PlacedObject, ObjectKind } from '../src/core/layout.ts';
const o = (kind: ObjectKind, q: number, r = 0): PlacedObject => ({ kind, q, r, adaptation: 0 });
const global = (...globals: EffectOption[]): EffectsState => ({ ...emptyEffects(), globals });
const module = (effect: ModuleId, q: number, r = 0): EffectsState => ({ ...emptyEffects(), modules: [{ id: 1, effect, at: { q, r } }], nextId: 2 });
const contains = (cells: readonly { q: number; r: number }[], q: number, r = 0): boolean => cells.some(c => c.q === q && c.r === r);

test('Набор 12: по три общих и три модуля в каждой категории; дальние оси различны и обрезаются', () => {
  for (const category of ['plant', 'device']) for (const form of ['global', 'module']) assert.equal(EFFECTS.filter(e => e.category === category && e.form === form).length, 3);
  const light = ownDeviceZone(o('lamp', 0), global({ effect: 'E1', target: 'lamp' }));
  const water = ownDeviceZone(o('sprinkler', 0), global({ effect: 'E2', target: 'sprinkler' }));
  assert.ok(contains(light, 2)); assert.ok(contains(light, -2)); assert.equal(contains(light, 0, 2), false);
  assert.ok(contains(water, 0, 2)); assert.equal(contains(water, 0, -2), false); assert.equal(contains(water, 2), false);
});

test('Кольцо заменяет ближнюю зону, лепестки добавляют только углы; общий эффект применяется после модуля', () => {
  const ring = module('E5', 0), petals = module('E6', 0);
  const dist = (c: { q: number; r: number }): number => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r));
  assert.deepEqual(ownDeviceZone(o('lamp', 0), ring).sort((a,b)=>a.q-b.q||a.r-b.r), fieldCells(19).filter(c=>dist(c)===2).sort((a,b)=>a.q-b.q||a.r-b.r));
  assert.equal(contains(ownDeviceZone(o('lamp', 0), ring), 1), false);
  const expected = fieldCells(19).filter(c => dist(c) === 1 || dist(c) === 2 && (!c.q || !c.r || c.q + c.r === 0));
  assert.equal(ownDeviceZone(o('lamp', 0), petals).length, expected.length);
  ring.globals.push({ effect: 'E1', target: 'lamp' });
  const zone = ownDeviceZone(o('lamp', 0), ring); assert.equal(new Set(zone.map(c=>`${c.q},${c.r}`)).size,zone.length);
});

test('Свет/вода передаются на один шаг от прямого источника; минилампа требует P2 для соседей', () => {
  const plants = [o('carnation', -1), o('carnation', 0), o('carnation', 1)];
  for (const [kind, effect, condition] of [['lamp','P2','light'],['sprinkler','P3','water']] as const) {
    const objects = [o(kind, -2), ...plants], fx = global({ effect, target: 'carnation' });
    assert.equal(plantConditions(objects, plants[0]!, fx)![condition], true);
    assert.equal(plantConditions(objects, plants[1]!, fx)![condition], true);
    assert.equal(plantConditions(objects, plants[2]!, fx)![condition], false);
    assert.equal(plantConditions([objects[0]!, ...plants.slice(1)], plants[1]!, fx)![condition], false);
  }
  const fx = module('P6', -1); assert.equal(plantConditions(plants, plants[0]!, fx)!.light, true); assert.equal(plantConditions(plants, plants[1]!, fx)!.light, false);
  fx.globals.push({ effect: 'P2', target: 'carnation' });
  assert.equal(plantConditions(plants, plants[1]!, fx)!.light, true); assert.equal(plantConditions(plants, plants[2]!, fx)!.light, false);
});

test('Парные устройства заимствуют собственные зоны до E3, двойной уход не расширяется на заимствованное', () => {
  const objects = [o('lamp', -1), o('sprinkler', 0), o('lamp', 1), o('carnation', 2), o('carnation', 0, 1)];
  const fx = global({ effect: 'E3', target: 'lamp' }, { effect: 'E3', target: 'sprinkler' });
  assert.equal(contains(conditionZone(objects[0]!, objects, fx), 2), false);
  assert.equal(contains(conditionZone(objects[1]!, objects, fx), 2), true);
  const pair = [o('lamp', -1), o('sprinkler', 0), o('carnation', 1)];
  const dual = module('E4', -1); dual.globals.push({ effect: 'E3', target: 'lamp' });
  const withoutWater = pair.filter(x=>x.kind!=='sprinkler');
  assert.deepEqual(plantConditions(withoutWater, o('carnation', 0), dual), null);
  assert.equal(contains(ownDeviceZone(pair[0]!, dual), 1), false);
  assert.equal(contains(conditionZone(pair[0]!, pair, dual), 1), true);
  assert.equal(plantConditions(pair, pair[2]!, dual)!.light, true);
  assert.equal(deviceZone(pair[0]!, pair, dual).some(c=>pair.some(x=>sameCell(x,c)&&x.kind!=='carnation')), false);
});

test('Привязка следует за объектом, удаление возвращает модуль, undo восстанавливает обе привязки', () => {
  const fx = module('P6', 0), moved = editEffectBindings(fx, { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } });
  assert.deepEqual(moved.modules[0]!.at, { q: 1, r: 0 }); assert.deepEqual(fx.modules[0]!.at, { q: 0, r: 0 });
  assert.deepEqual(editEffectBindings(moved, { type: 'undo' }).modules[0]!.at, { q: 0, r: 0 });
  const removed = editEffectBindings(moved, { type: 'remove', from: { q: 1, r: 0 } });
  assert.equal(removed.modules[0]!.at, null); assert.deepEqual(editEffectBindings(removed, { type: 'undo' }).modules[0]!.at, { q: 1, r: 0 });
  assert.ok(isEffects(fx, { objects: [o('carnation', 0)], undo: null }));
  assert.equal(isEffects(fx, { objects: [o('lamp', 0)], undo: null }), false);
  assert.equal(isEffects({ ...fx, modules: [...fx.modules, fx.modules[0]] }, { objects: [o('carnation', 0)], undo: null }), false);
});
