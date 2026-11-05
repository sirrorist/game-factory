import test from 'node:test';
import assert from 'node:assert/strict';
import { enemyBalance } from '../src/core/balance.ts';
test('следующие этажи усиливают врагов с ограниченным ростом', () => {
 assert.ok(enemyBalance(3,true).hp>enemyBalance(1,true).hp);
 assert.ok(enemyBalance(3,false).hp>enemyBalance(1,false).hp);
 assert.deepEqual(enemyBalance(999,true),enemyBalance(3,true));
});
