import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfiles, profileFingerprint, relayConfigFromEnv, assertRelayConfig, renderMail, htmlEscape } from '../src/config.ts';
import { parseMailRequest, parseStringObject, validMailbox, canonicalOrigin } from '../src/protocol.ts';
import { input, config, ORIGIN, SECRET, API_KEY, profiles } from './fixtures.ts';

test('закрытый формат: четыре поля и каноническая ссылка', () => {
  const parsed = parseMailRequest(JSON.stringify(input), ORIGIN);
  assert.deepEqual(parsed, input);
  assert.ok(Object.isFrozen(parsed));
  assert.equal(parseMailRequest(JSON.stringify({ ...input, to: 'Player+tag@EXAMPLE.COM' }), ORIGIN).to, 'Player+tag@EXAMPLE.COM');
  assert.equal(parseStringObject(' { "a": "значение" } ').a, 'значение');
  for (const raw of ['{}', '[]', 'null', '{"a":1}', '{"a":"x","a":"y"}', '{"a":"x","\\u0061":"y"}', '{"a":"x",}', '{"a":"x"} false', '{"a":"\\n"}']) {
    assert.throws(() => parseMailRequest(raw, ORIGIN));
  }
});
test('закрытый формат отвергает посторонние поля, адреса и подмену ссылки', () => {
  const invalid: unknown[] = [
    { ...input, extra: 'x' }, { ...input, kind: 'reset-password.v2' },
    { ...input, operationId: input.operationId.toUpperCase() }, { ...input, operationId: 'secret' },
    { ...input, to: ['player@example.com'] }, { ...input, url: null },
    ...['a@example.com,b@example.com', 'Name <a@example.com>', 'a\r\nBcc:x@example.com', 'a..b@example.com',
      'a@127.0.0.1', 'a@localhost', 'a@-bad.example', 'ü@example.com', '"a"@example.com'].map((to) => ({ ...input, to })),
    ...[
      ORIGIN + '/account/reset-password?token=a&callbackURL=https://evil.example',
      ORIGIN + '/account/reset-password?token=a&token=b',
      ORIGIN + '/account/reset-password?%74oken=a',
      ORIGIN + '/account/reset-password?token=%41',
      ORIGIN + '/account/reset-password?token=%xx',
      ORIGIN + '/account/reset-password?token=%0a',
      ORIGIN + '/account/reset-password?token=a#',
      ORIGIN + '/x/../account/reset-password?token=a',
      ORIGIN + '/account/verify-email?token=a',
      'https://user@hub.example.com/account/reset-password?token=a',
      'https://evil.example/account/reset-password?token=a',
      ' ' + input.url, input.url + ' ', input.url + '\n', input.url + '" onmouseover="x',
      ORIGIN + '/account/reset-password?token=' + 'x'.repeat(1025),
    ].map((url) => ({ ...input, url })),
  ];
  for (const value of invalid) assert.throws(() => parseMailRequest(JSON.stringify(value), ORIGIN));
  assert.throws(() => parseMailRequest(' '.repeat(16385), ORIGIN));
  assert.throws(() => canonicalOrigin('http://hub.example.com'));
  assert.throws(() => canonicalOrigin(ORIGIN + '/'));
  assert.equal(validMailbox('a'.repeat(65) + '@example.com'), false);
});
test('шаблоны неизменны, отправитель закреплён, HTML-атрибут экранируется', () => {
  // Контрольный снимок v1: изменение отправителя/текста требует нового профиля.
  assert.equal(profileFingerprint(profiles), '28bbac8b48b5dbf57d6c6b3f9ad800a660714405f7f12fbe782a5184b970d35d');
  assert.ok(Object.isFrozen(profiles));
  assert.ok(Object.isFrozen(profiles['reset-password.v1']));
  for (const kind of ['verify-email.v1', 'reset-password.v1'] as const) {
    const path = kind === 'verify-email.v1' ? 'verify-email' : 'reset-password';
    const request = parseMailRequest(JSON.stringify({ ...input, kind, url: ORIGIN + '/account/' + path + '?token=a' }), ORIGIN);
    const first = renderMail(profiles[kind], request);
    assert.deepEqual(renderMail(profiles[kind], request), first);
    assert.equal(first.from, 'Game Factory <noreply@auth.example.com>');
    assert.deepEqual(first.to, ['player@example.com']);
    assert.ok(first.html.includes('href="' + request.url + '"'));
    assert.ok(first.text.includes(request.url));
  }
  assert.equal(htmlEscape('"\'<>&'), '&quot;&#39;&lt;&gt;&amp;');
  const changed = createProfiles(ORIGIN, 'other@auth.example.com');
  assert.notEqual(profileFingerprint(changed), config.profilePin);
  assert.throws(() => assertRelayConfig({ ...config, profiles: changed }));
  assert.throws(() => assertRelayConfig({ ...config, profiles: {} as typeof profiles }));
});
test('конфигурация без секретов/отправителя/pin закрыта, значения ошибок не раскрываются', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gf-mail-config-'));
  try {
    const service = join(directory, 'service');
    const api = join(directory, 'api');
    writeFileSync(service, SECRET); writeFileSync(api, API_KEY);
    const env = {
      GF_HUB_ORIGIN: ORIGIN, GF_MAIL_FROM: 'noreply@auth.example.com',
      GF_MAIL_PROFILE_SHA256: config.profilePin, GF_MAIL_SERVICE_SECRET_FILE: service, GF_RESEND_API_KEY_FILE: api,
    };
    assert.deepEqual(relayConfigFromEnv(env), config);
    for (const key of Object.keys(env)) {
      assert.throws(() => relayConfigFromEnv({ ...env, [key]: '' }), (error: unknown) =>
        error instanceof Error && !error.message.includes(directory) && !error.message.includes(SECRET));
    }
    writeFileSync(service, ''); assert.throws(() => relayConfigFromEnv(env));
    writeFileSync(service, 'short'); assert.throws(() => relayConfigFromEnv(env));
    writeFileSync(service, SECRET); writeFileSync(api, 'short'); assert.throws(() => relayConfigFromEnv(env));
    assert.throws(() => assertRelayConfig({ ...config, serviceSecret: '' }));
    assert.throws(() => createProfiles(ORIGIN, 'a@example.com\r\nBcc:evil@example.com'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
