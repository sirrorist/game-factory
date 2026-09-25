import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAttributes } from '../src/index.ts';

test('без прав — голая песочница и пустой allow', () => {
  assert.deepEqual(frameAttributes([]), { sandbox: 'allow-scripts allow-same-origin', allow: '' });
});

test('права манифеста превращаются в allow и sandbox', () => {
  assert.deepEqual(frameAttributes(['saves', 'fullscreen', 'gamepad', 'audio', 'pointer-lock']), {
    sandbox: 'allow-scripts allow-same-origin allow-pointer-lock',
    allow: 'fullscreen; gamepad; autoplay',
  });
});

test('песочница никогда не выпускает игру наверх', () => {
  const { sandbox } = frameAttributes(['saves', 'leaderboard', 'multiplayer', 'fullscreen', 'pointer-lock', 'gamepad', 'audio']);
  for (const flag of ['allow-top-navigation', 'allow-popups', 'allow-forms', 'allow-modals']) {
    assert.ok(!sandbox.includes(flag), flag);
  }
});
