import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portions, orderCandidates, nextRandom, RECIPES } from '../src/core/orders.ts';

test('Точные доли: остатки по порядку, сумма и положительные количества', () => {
  assert.deepEqual(portions(48, [2, 1, 1, 1]), [19, 10, 10, 9]);
  assert.deepEqual(portions(20, [1, 1, 1]), [7, 7, 6]);
  assert.deepEqual(portions(15, [1, 1]), [8, 7]);
  assert.deepEqual(portions(21, [1, 1, 1]), [7, 7, 7]);
  for (let total = 8; total <= 49; total++) {
    const counts = portions(total, [2, 1, 1, 1]);
    assert.equal(counts.reduce((a, b) => a + b), total);
    assert.ok(counts.every(n => n >= 1));
  }
  for (const [n, weights] of [[0, [1]], [8, [0]], [8, []], [2, [1, 1, 1]], [9, [Number.MAX_SAFE_INTEGER, 1]]] as const) assert.throws(() => portions(n, weights));
});

test('Восемь рецептов, обычные пять ступеней и отсчёт срока с появления', () => {
  assert.equal(RECIPES.length, 8);
  for (let stage = 1; stage <= 5; stage++) {
    const cards = orderCandidates(stage, 3);
    assert.equal(cards.length, 6);
    assert.deepEqual([...new Set(cards.map(c => c.recipe))], ['R1', 'R2', 'R3']);
    for (const card of cards) {
      const total = card.ingredients.reduce((s, i) => s + i.count, 0);
      assert.equal(total, [8, 14, 20, 26, 32][stage - 1]! + Number(card.format === 'gift'));
      assert.equal(card.deadline, 8); assert.equal(card.appeared, 3);
      assert.equal(card.coins, total * 2); assert.equal(card.experience, total);
    }
  }
  assert.ok(orderCandidates(5, 19).every(c => c.deadline === 20));
  assert.equal(orderCandidates(1, 1, ['rose', 'gerbera']).length, 2);
});

test('Финал: уникальные составы, обе темы, доступные виды, 48 стеблей и 96/96', () => {
  const cards = orderCandidates(6, 16);
  assert.deepEqual(cards.map(c => c.ingredients.map(i => i.count)), [[24, 24], [32, 16], [16, 32]]);
  assert.equal(new Set(cards.map(c => c.format)).size, 2);
  assert.ok(cards.every(c => c.deadline === 20 && c.coins === 96 && c.experience === 96));
  assert.equal(orderCandidates(6, 1, ['carnation']).length, 0);
  assert.deepEqual(orderCandidates(6, 1, ['carnation', 'chrysanthemum', 'rose', 'tulip']).at(-4)!.ingredients.map(i => i.count), [19, 10, 10, 9]);
  assert.equal(nextRandom(123), nextRandom(123)); assert.notEqual(nextRandom(123), 123);
});
