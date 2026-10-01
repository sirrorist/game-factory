import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAttributes } from '../src/index.ts';

test('без прав - голая песочница и пустой allow', () => {
  assert.deepEqual(frameAttributes([]), { sandbox: 'allow-scripts allow-same-origin', allow: '' });
});

test('права манифеста превращаются в allow и sandbox', () => {
  assert.deepEqual(frameAttributes(['saves', 'fullscreen', 'gamepad', 'audio', 'pointer-lock', 'orientation-lock']), {
    sandbox: 'allow-scripts allow-same-origin allow-pointer-lock allow-orientation-lock',
    allow: 'fullscreen; gamepad; autoplay',
  });
});

test('разворот экрана - только по праву orientation-lock, fullscreen его не даёт', () => {
  assert.equal(frameAttributes(['fullscreen']).sandbox, 'allow-scripts allow-same-origin');
  assert.equal(frameAttributes(['orientation-lock']).sandbox, 'allow-scripts allow-same-origin allow-orientation-lock');
});

test('песочница никогда не выпускает игру наверх', () => {
  const { sandbox } = frameAttributes([
    'saves', 'leaderboard', 'multiplayer', 'fullscreen', 'pointer-lock', 'orientation-lock', 'gamepad', 'audio',
  ]);
  for (const flag of ['allow-top-navigation', 'allow-popups', 'allow-forms', 'allow-modals']) {
    assert.ok(!sandbox.includes(flag), flag);
  }
});
