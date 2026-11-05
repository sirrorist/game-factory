import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceZone, plantConditions } from '../src/core/conditions.ts';
import { changeLayout, type PlacedObject } from '../src/core/layout.ts';
import { hasCell, sameCell } from '../src/core/field.ts';

const objects: PlacedObject[] = [
  { kind: 'carnation', q: 0, r: 0, adaptation: 0 },
  { kind: 'lamp', q: 1, r: 0, adaptation: 0 },
  { kind: 'sprinkler', q: 0, r: 1, adaptation: 0 },
];
test('Свет и полив показываются только растению, соседние устройства их не получают', () => {
  assert.deepEqual(plantConditions(objects, { q: 0, r: 0 }), { light: true, water: true });
  assert.equal(plantConditions(objects, { q: 1, r: 0 }), null);
  assert.equal(plantConditions(objects, { q: 0, r: 1 }), null);
  assert.equal(plantConditions(objects, { q: -1, r: 0 }), null);
  const zone = deviceZone({ q: 1, r: 0 }, objects);
  assert.ok(zone.some(cell => sameCell(cell, { q: 0, r: 0 })));
  assert.ok(!zone.some(cell => sameCell(cell, { q: 0, r: 1 })));
  const sameType = [...objects, { kind: 'lamp', q: 1, r: -1, adaptation: 0 } as const];
  assert.ok(!deviceZone({ q: 1, r: 0 }, sameType).some(cell => sameCell(cell, { q: 1, r: -1 })));
  assert.ok(deviceZone({ q: 2, r: -2 }, objects).every(cell => hasCell(19, cell)));
});
test('Перекрытие не суммирует эффект; устройства не передают его дальше', () => {
  const extra: PlacedObject[] = [...objects, { kind: 'lamp', q: -1, r: 0, adaptation: 0 }, { kind: 'chrysanthemum', q: -2, r: 1, adaptation: 0 }];
  assert.deepEqual(plantConditions(extra, { q: 0, r: 0 }), { light: true, water: true });
  assert.deepEqual(plantConditions(extra, { q: -2, r: 1 }), { light: true, water: false });
  assert.deepEqual(plantConditions(objects.slice(1).concat({ kind: 'chrysanthemum', q: 1, r: 1, adaptation: 0 }), { q: 1, r: 1 }), { light: true, water: true });
  const relay: PlacedObject[] = [objects[1]!, objects[2]!, { kind: 'carnation', q: 0, r: 2, adaptation: 0 }];
  assert.deepEqual(plantConditions(relay, { q: 0, r: 2 }), { light: false, water: true });
});
test('Перенос/удаление/отмена сразу меняют индикацию без нового поля в сохранении', () => {
  const layout = { objects: structuredClone(objects), undo: null };
  const moved = changeLayout(layout, { type: 'move', from: { q: 1, r: 0 }, to: { q: 2, r: -2 } });
  assert.deepEqual(plantConditions(moved.objects, { q: 0, r: 0 }), { light: false, water: true });
  const removed = changeLayout(moved, { type: 'remove', from: { q: 0, r: 1 } });
  assert.deepEqual(plantConditions(removed.objects, { q: 0, r: 0 }), { light: false, water: false });
  assert.deepEqual(plantConditions(changeLayout(removed, { type: 'undo' }).objects, { q: 0, r: 0 }), { light: false, water: true });
  assert.deepEqual(layout.objects, objects);
});
