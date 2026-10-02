// Пункты приёмки владельца (2026-10-02), которые проверяются без браузера:
// QTE, уведомления, лут в ранце, дуга удара посохом.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QTE_ZONE, qteHit, qteSpeed, qteStep } from '../src/core/qte.ts';
import { NOTICE_LIMIT, NOTICE_TTL, pushNotification } from '../src/core/notifications.ts';
import {
  autoPlaceItem,
  createInventory,
  findOverlaps,
  placeItem,
  removeItem,
  restoreItem,
} from '../src/core/inventory.ts';
import { ARM_LENGTH, STAFF_GRIP, STAFF_LENGTH, attackPose } from '../src/render/character.ts';
import type { InventoryItem } from '../src/core/types.ts';

function item(id: string, shape: { x: number; y: number }[]): InventoryItem {
  return { id, name: id, category: 'weapon', rarity: 'common', element: 'physical', shape, weight: 1, rotation: 0 };
}

const VERTICAL = [{ x: 0, y: 0 }, { x: 0, y: 1 }];

test('QTE: скорость ползунка не зависит от частоты кадров', () => {
  // Секунда на 60 Гц и на 144 Гц - одна и та же дорога
  const run = (fps: number): number => {
    let s = { pos: 4, dir: 1 };
    for (let i = 0; i < fps; i++) s = qteStep(s.pos, s.dir, qteSpeed(0), 1 / fps);
    return s.pos;
  };
  assert.ok(Math.abs(run(60) - run(144)) < 0.5, `${run(60)} против ${run(144)}`);
});

test('QTE: проход зоны на первом усике длится не меньше полусекунды', () => {
  const window = (QTE_ZONE.to - QTE_ZONE.from) / qteSpeed(0);
  assert.ok(window >= 0.5, `окно ${window.toFixed(2)} с`);
  // и на третьем, самом быстром, - не меньше трети секунды
  assert.ok((QTE_ZONE.to - QTE_ZONE.from) / qteSpeed(2) >= 0.3);
});

test('QTE: ползунок отскакивает от краёв и не выходит за дорожку', () => {
  let s = { pos: 97, dir: 1 };
  s = qteStep(s.pos, s.dir, 100, 0.05);
  assert.equal(s.dir, -1);
  assert.ok(s.pos <= 98 && s.pos >= 2);
  assert.equal(qteHit(QTE_ZONE.from), true);
  assert.equal(qteHit(QTE_ZONE.to + 0.1), false);
});

test('уведомления: не больше трёх, повтор продлевает старое со счётчиком', () => {
  let list = pushNotification([], 'a', 0);
  list = pushNotification(list, 'b', 10);
  list = pushNotification(list, 'c', 20);
  list = pushNotification(list, 'd', 30);
  assert.equal(list.length, NOTICE_LIMIT);
  assert.deepEqual(list.map((n) => n.text), ['b', 'c', 'd']);

  list = pushNotification(list, 'c', 40);
  assert.equal(list.length, NOTICE_LIMIT);
  assert.equal(list.find((n) => n.text === 'c')?.count, 2);
  assert.equal(list.find((n) => n.text === 'c')?.expiresAt, 40 + NOTICE_TTL);

  // Истёкшие уходят при следующем уведомлении
  list = pushNotification(list, 'e', 30 + NOTICE_TTL + 1);
  assert.deepEqual(list.map((n) => n.text), ['c', 'e']);
});

test('лут мимика: свиток 1x2 ложится рядом с посохом, а не поверх (приёмка, пункт 12)', () => {
  // Сценарий владельца: посох во 2-3 ряду 2-й колонки, свиток идёт в первое свободное место
  const inv = createInventory(5, 4);
  const staff = item('staff', VERTICAL);
  assert.equal(placeItem(inv, staff, 1, 1), true);
  const scroll = item('scroll', VERTICAL);
  assert.equal(autoPlaceItem(inv, scroll), true);
  assert.deepEqual([scroll.gridX, scroll.gridY], [0, 0]);
  assert.deepEqual(findOverlaps(inv), []);
  assert.equal(inv.slots[1 * 5 + 1]?.itemId, 'staff');
});

test('лут: ранец забит под вертикаль - предмет ложится повернутым, без наложений', () => {
  const inv = createInventory(2, 2);
  placeItem(inv, item('a', [{ x: 0, y: 0 }]), 0, 0);
  placeItem(inv, item('b', [{ x: 0, y: 0 }]), 1, 0);
  const scroll = item('scroll', VERTICAL);
  assert.equal(autoPlaceItem(inv, scroll), true);
  assert.equal(scroll.rotation === 90 || scroll.rotation === 270, true);
  assert.deepEqual(findOverlaps(inv), []);

  const extra = item('extra', VERTICAL);
  assert.equal(autoPlaceItem(inv, extra), false);
  assert.equal(extra.rotation, 0);
  assert.equal(inv.items.has('extra'), false);
});

test('перетаскивание: повёрнутый на лету предмет не пропадает из ранца', () => {
  const inv = createInventory(3, 2);
  const staff = item('staff', VERTICAL);
  placeItem(inv, staff, 0, 0);
  placeItem(inv, item('x', [{ x: 0, y: 0 }]), 1, 0);
  // Игрок взял посох, повернул (R) и бросил мимо сетки: в повороте на старое место не лезет
  removeItem(inv, 'staff');
  staff.rotation = 90;
  assert.equal(restoreItem(inv, staff, 0, 0, 0), true);
  assert.equal(inv.items.has('staff'), true);
  assert.deepEqual([staff.gridX, staff.gridY, staff.rotation], [0, 0, 0]);
  assert.deepEqual(findOverlaps(inv), []);
});

test('удар посохом: оба конца посоха перед магом, нижний не уходит в спину (приёмка, пункт 5)', () => {
  // Плечо - в 0.05 м перед осью мага; поворот вокруг X: рука (0,-L,0) -> z = -L·sin(плечо),
  // посох (0,1,0) -> z = sin(угол посоха). Конец посоха - кисть ± длина от хвата.
  for (let t = 0.3; t <= 0.65; t += 0.05) {
    const a = attackPose(t);
    const handZ = 0.05 - ARM_LENGTH * Math.sin(a.shoulder);
    const tipZ = handZ + (STAFF_LENGTH - STAFF_GRIP) * Math.sin(a.staff);
    const buttZ = handZ - STAFF_GRIP * Math.sin(a.staff);
    if (t >= 0.5) assert.ok(tipZ > 1, `t=${t.toFixed(2)}: навершие не впереди (${tipZ.toFixed(2)})`);
    assert.ok(buttZ > -0.2, `t=${t.toFixed(2)}: нижний конец за спиной (${buttZ.toFixed(2)})`);
  }
  // Удар кончается перед магом и возвращается в стойку
  assert.ok(attackPose(0.64).staff > 1.5);
  const end = attackPose(1);
  assert.ok(Math.abs(end.shoulder + 0.3) < 1e-9 && Math.abs(end.staff) < 1e-9 && Math.abs(end.inward) < 1e-9);
});
