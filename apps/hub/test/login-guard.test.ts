// Лимит входа (lib/login-guard.ts): серия неверных паролей - бан адреса, повторный бан дольше.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, ipKey, LoginGuard } from '../src/lib/login-guard.ts';

const MIN = 60_000;

test('пять неверных паролей за окно - бан на 15 минут, другие адреса не задеты', () => {
  const g = new LoginGuard();
  for (let i = 0; i < 4; i++) assert.equal(g.fail('192.0.2.1', i * 1000), null);
  assert.deepEqual(g.check('192.0.2.1', 4000), { banned: false });
  assert.deepEqual(g.fail('192.0.2.1', 5000), { bannedForS: 15 * 60 });
  assert.equal(g.check('192.0.2.1', 6000).banned, true);
  assert.equal(g.check('192.0.2.2', 6000).banned, false);
  assert.equal(g.check('192.0.2.1', 5000 + 15 * MIN).banned, false);
});

test('неудачи вне окна не копятся; верный пароль сбрасывает счёт', () => {
  const g = new LoginGuard();
  // По одной раз в 20 минут - окно 15: сколько ни ошибайся так, бана нет.
  for (let i = 0; i < 8; i++) assert.equal(g.fail('ip', i * 20 * MIN), null, `попытка ${i + 1}`);
  assert.equal(g.check('ip', 160 * MIN).banned, false);
  for (let i = 0; i < 4; i++) g.fail('ip2', i);
  g.success('ip2');
  assert.equal(g.fail('ip2', 10), null);
});

test('каждый следующий бан вдвое дольше, но не дольше суток', () => {
  const g = new LoginGuard();
  let now = 0;
  const lengths: number[] = [];
  for (let round = 0; round < 10; round++) {
    let ban = null;
    for (let i = 0; i < 5; i++) ban = g.fail('ip', now++);
    lengths.push(ban!.bannedForS);
    now += ban!.bannedForS * 1000 + 1;
  }
  assert.deepEqual(lengths.slice(0, 4), [900, 1800, 3600, 7200]);
  assert.equal(Math.max(...lengths), 24 * 3600);
});

test('память ограничена: перебор адресов не растит таблицу без конца', () => {
  const g = new LoginGuard({ maxEntries: 100 });
  for (let i = 0; i < 1000; i++) g.fail(`ip-${i}`, i);
  assert.equal(g.size, 100);
  // Забыты самые старые: у первого адреса счёт начат заново, у свежего - нет.
  for (let i = 0; i < 3; i++) g.fail('ip-0', 2000 + i);
  assert.equal(g.fail('ip-0', 2010), null);
  for (let i = 0; i < 3; i++) g.fail('ip-999', 2000 + i);
  assert.ok(g.fail('ip-999', 2010));
});

test('адрес клиента - только из X-Real-Ip и только похожий на адрес', () => {
  assert.equal(clientIp(new Headers({ 'x-real-ip': '203.0.113.7' })), '203.0.113.7');
  assert.equal(clientIp(new Headers({ 'x-real-ip': '2001:db8::1' })), '2001:db8::1');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7' })), 'unknown');
  assert.equal(clientIp(new Headers({ 'x-real-ip': 'evil ip=192.0.2.4' })), 'unknown');
  assert.equal(clientIp(new Headers()), 'unknown');
});

test('IPv6 считается сетью /64: смена адреса внутри сети лимит не обходит', () => {
  assert.equal(ipKey('192.0.2.7'), '192.0.2.7');
  assert.equal(ipKey('2001:db8:0:1::1'), '2001:db8:0:1::/64');
  assert.equal(ipKey('2001:0db8:0000:0001:aaaa:bbbb:cccc:dddd'), '2001:db8:0:1::/64');
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  const g = new LoginGuard();
  let ban = null;
  for (let i = 1; i <= 5; i++) ban = g.fail(ipKey(`2001:db8:0:1::${i}`), i);
  assert.ok(ban, 'пять адресов одной /64 - бан');
  assert.equal(g.check(ipKey('2001:db8:0:1::ffff'), 10).banned, true);
  assert.equal(g.check(ipKey('2001:db8:0:2::1'), 10).banned, false);
});
