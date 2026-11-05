import test from 'node:test';
import assert from 'node:assert/strict';
import { createOracleChallenge, tickOracle, strikeOracleNode } from '../src/core/oracle.ts';
test('три разных узла завершают кошмар, повторный удар не даёт награду', () => {
 const s=createOracleChallenge();s.status='active';assert.equal(strikeOracleNode(s,0),true);assert.equal(strikeOracleNode(s,0),false);
 strikeOracleNode(s,1);strikeOracleNode(s,2);assert.equal(s.status,'won');tickOracle(s,30);assert.equal(s.status,'won');
});
test('кошмар заканчивается по игровому времени, пауза не продвигает таймер', () => {
 const s=createOracleChallenge(); tickOracle(s,30);assert.equal(s.status,'waiting');s.status='active';tickOracle(s,19);assert.equal(s.status,'active');tickOracle(s,1);assert.equal(s.status,'lost');
});

import { moveInNightmare, ORACLE_ARENA_RADIUS } from '../src/core/oracle.ts';
test('граница кошмара ограничивает движение и скачок, внутри путь свободен', () => {
  assert.deepEqual(moveInNightmare(50,10,1,-1,50,10),{x:51,z:9});
  const end=moveInNightmare(50,10,100,100,50,10);
  assert.ok(Math.abs(Math.hypot(end.x-50,end.z-10)-ORACLE_ARENA_RADIUS)<1e-8);
  const back=moveInNightmare(50+ORACLE_ARENA_RADIUS,10,-1,0,50,10);
  assert.equal(back.x,50+ORACLE_ARENA_RADIUS-1);
});

import { observeOracle, oracleStealthChance } from '../src/core/oracle.ts';
test('Оракул замечает шум и передний сектор, тихий обход со спины безопасен', () => {
  const s=createOracleChallenge();
  assert.equal(observeOracle(s,2,2,0,'light',false),false);
  assert.equal(s.awareness,0);
  assert.equal(observeOracle(s,1,-3,0,'light',false),false);
  assert.ok(s.awareness>0);
  observeOracle(s,1,5,0,'light',false);assert.equal(s.awareness,0);
  assert.equal(observeOracle(s,1,2,0,'heavy',false),true);
  s.awareness=0;assert.equal(observeOracle(s,1,2,0,'light',true),true);
  s.awareness=0;observeOracle(s,NaN,-1,0,'heavy',true);assert.equal(s.awareness,0);
  assert.ok(oracleStealthChance('light')>oracleStealthChance('medium'));
  assert.ok(oracleStealthChance('medium')>oracleStealthChance('heavy'));
});
