import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, isUserRole, isUserStatus, USER_ROLES, type AccessPrincipal } from '../src/access-policy.ts';

test('закрытые полномочия не следуют из факта входа или числового старшинства роли', () => {
  for (const role of USER_ROLES) {
    const principal = { id: 'a', role, status: 'active' } as const;
    assert.equal(can(principal, 'kit.view'), role === 'owner', role);
    assert.equal(can(principal, 'prereleases.view.all'), role === 'owner', role);
    assert.equal(can(principal, 'roles.assign'), role === 'owner', role);
    assert.equal(can(principal, 'games.create'), role !== 'user', role);
    assert.equal(can({ ...principal, status: 'suspended' }, 'kit.view'), false);
  }
  assert.equal(can(null, 'kit.view'), false);
  assert.equal(can({ id: 'a', role: 'superadmin', status: 'active' } as unknown as AccessPrincipal, 'kit.view'), false);
  for (const unknown of ['OWNER', '', 1, null, '__proto__']) assert.equal(isUserRole(unknown), false);
  assert.equal(isUserStatus('blocked'), false);
});

test('свои данные и игры требуют совпадения текущего владельца, в том числе у owner', () => {
  for (const role of USER_ROLES) {
    const actor = { id: 'a', role, status: 'active' } as const;
    assert.equal(can(actor, 'progress.read.own', { ownerUserId: 'a' }), true);
    assert.equal(can(actor, 'progress.read.own', { ownerUserId: 'b' }), false);
    assert.equal(can(actor, 'games.manage.own', { ownerUserId: 'a' }), role !== 'user');
    assert.equal(can(actor, 'games.manage.own', { ownerUserId: 'b' }), false);
    assert.equal(can(actor, 'games.manage.own'), false);
  }
});

test('admin не блокирует admin/owner; неизвестный целевой ресурс не разрешён', () => {
  const admin = { id: 'a', role: 'admin', status: 'active' } as const;
  for (const role of USER_ROLES) {
    assert.equal(can(admin, 'users.suspend', { ownerUserId: 'b', ownerRole: role }), role === 'user' || role === 'developer');
  }
  assert.equal(can(admin, 'users.suspend'), false);
  assert.equal(can(admin, 'games.moderate', { ownerUserId: 'b' }), false);
});
