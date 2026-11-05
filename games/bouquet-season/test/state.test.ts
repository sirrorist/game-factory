import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, startSeason, changeSettings, isGameState } from '../src/core/state.ts';

test('Новый сезон начинается в день 1 без роста и наград, повтор старта ничего не меняет', () => {
  const original = newProfile();
  const state = startSeason(original, 123);
  assert.equal(original.season, null);
  assert.deepEqual(state.profile, { coins: 0, experience: 0, seasonsStarted: 1, progress:{main:0,urgent:0,wins:0},owned:[],tutorial:[] });
  const { board, rng, effects, events, ...season } = state.season!;
  assert.deepEqual(season, { access:[],number: 1, day: 1, reputation: 3, status: 'preparing', layout:{objects:[],undo:null},garden:{plants:[],undo:null,stock:{carnation:0,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0}} });
  assert.equal(board.offers.length, 3); assert.equal(board.active.length, 0);
  assert.notEqual(rng, 123); assert.deepEqual(state, startSeason(newProfile(), 123));
  assert.equal(startSeason(state, 456), state);
  assert.ok(isGameState(state));
});

test('Настройки не сбрасывают сезон, генератор и профиль', () => {
  const original = startSeason(newProfile(), 789);
  const state = changeSettings(original, { tutorial: false, reducedMotion: true });
  assert.deepEqual(state.profile, original.profile);
  assert.deepEqual(state.season, original.season);
  assert.equal(original.settings.tutorial, true);
});

test('Проверка отвергает неверные числа, форму, календарь и несогласованный номер сезона', () => {
  const state = startSeason(newProfile(), 123);
  for (const bad of [null, [], {}, { ...state, future: true },
    { ...state, profile: { ...state.profile, coins: -1 } },
    { ...state, profile: { ...state.profile, experience: Infinity } },
    { ...state, profile: { ...state.profile, seasonsStarted: 2 } },
    { ...state, season: { ...state.season, day: 21 } },
    { ...state, season: { ...state.season, rng: 0 } },
    { ...state, settings: { tutorial: 1, reducedMotion: false } },
  ]) assert.equal(isGameState(bad), false);
  assert.throws(() => startSeason(newProfile(), 0));
});
