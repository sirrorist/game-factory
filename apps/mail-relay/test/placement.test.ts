import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('пример размещения: только выделенные сети и почтовые секреты', () => {
  const compose = readFileSync(new URL('../../../deploy/compose.mail.example.yml', import.meta.url), 'utf8');
  const service = (name: string) => new RegExp('^  ' + name + ':\\n([\\s\\S]*?)(?=^  [a-z]|^secrets:|^networks:)', 'm').exec(compose)?.[1] ?? '';
  const relay = service('mail-relay');
  const hub = service('hub');
  assert.ok(relay);
  assert.match(relay, /networks: \[gf-mail, gf-mail-egress\]/);
  assert.match(hub, /networks: \[gf-mail\]/);
  assert.match(relay, /traefik.enable: "false"/);
  assert.match(hub, /traefik.enable: "false"/);
  assert.match(relay, /secrets: \[mail_service_secret, resend_api_key\]/);
  assert.match(hub, /secrets: \[mail_service_secret\]/);
  assert.match(compose, /gf-mail:\n    internal: true/);
  assert.match(compose, /gf-mail-egress:\n    external: true/);
  assert.doesNotMatch(relay, /ports:|volumes:|gf-edge|gf-db|AUTH_SECRET|DB_PASSWORD|privileged:|network_mode:/);
  assert.doesNotMatch(hub, /resend_api_key|gf-mail-egress/);
  assert.doesNotMatch(compose, /^\s*(ports|build):/m);
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /RUN|EXPOSE|secrets/);
});
