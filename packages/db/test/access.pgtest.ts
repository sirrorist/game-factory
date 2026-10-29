import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  accessActorContext, accessEvents, bootstrapOwner, can, changeUserAccess, readSessionAccess, readUserAccess,
  schema, session, user, type UserRole,
} from '../src/index.ts';
import { createOwner, setPassword } from '../src/admin.ts';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { ensureHubRole, HUB_ROLE } from '../src/roles.ts';
import { createHubAuth, SESSION_COOKIE } from '../../../apps/hub/src/lib/auth-core.ts';

const client = new PGlite();
const db = drizzle(client, { schema });
const password = 'Тестовый пароль только для временной БД';
const origin = 'https://hub.example';
const operator = { kind: 'operator' } as const;

before(async () => {
  // Настоящий переход со старой схемы и данными, а не только создание пустых таблиц.
  const oldDir = mkdtempSync(join(tmpdir(), 'gf-access-old-schema-'));
  mkdirSync(join(oldDir, 'meta'));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 2);
  writeFileSync(join(oldDir, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(oldDir, `${entry.tag}.sql`));
  await migrate(db, { migrationsFolder: oldDir });
  await client.exec(`insert into "user" (id,name,email) values ('legacy','Старая учётка','legacy@example.test');
    insert into game_saves (user_id,game_id,key,value) values ('legacy','snake','progress','{"level":7}');
    insert into scores (user_id,game_id,score) values ('legacy','snake',42);
    insert into session (id,token,user_id,expires_at) values ('legacy-session','legacy-token','legacy',now()+interval '1 day');`);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});
after(() => client.close());

async function fixture(id: string, role: UserRole = 'user') {
  await db.insert(user).values({ id, name: id, email: `${id}@example.test`, role });
  return (await readUserAccess(db, id))!;
}

async function putSession(id: string, userId: string, generation: number) {
  await db.insert(session).values({ id, userId, token: `token-${id}`, securityGeneration: generation,
    expiresAt: new Date(Date.now() + 60_000) });
}

async function rejectsDb(action: PromiseLike<unknown>, expected: RegExp) {
  await assert.rejects(Promise.resolve(action), (error: unknown) => {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error && expected.test(cause.message);
  });
}

test('миграция сохраняет старые данные, не повышает учётку, bootstrap выбирает только её явно', async () => {
  const legacy = (await readUserAccess(db, 'legacy'))!;
  assert.equal(legacy.role, 'user');
  assert.equal(legacy.securityGeneration, 0);
  const saves = await client.query<{ value: string }>(`select value from game_saves where user_id='legacy'`);
  assert.equal(saves.rows[0]?.value, '{"level":7}');
  assert.equal((await client.query(`select score from scores where user_id='legacy'`)).rows.length, 1);
  assert.equal(can(await readSessionAccess(db, 'legacy-session'), 'kit.view'), false);
  await bootstrapOwner(db, 'legacy', 'Явный выбор владельца на тестовой БД');
  assert.equal((await readUserAccess(db, 'legacy'))?.role, 'owner');
  assert.equal(await readSessionAccess(db, 'legacy-session'), null);
  await assert.rejects(bootstrapOwner(db, 'legacy', 'Повторный bootstrap'), /owner уже назначен/);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

test('последнего активного owner нельзя понизить, заблокировать или удалить даже прямым SQL', async () => {
  const change = { actor: operator, targetUserId: 'legacy', reason: 'Проверка последнего owner' };
  await rejectsDb(changeUserAccess(db, { ...change, role: 'user' }), /последнего активного owner/);
  await rejectsDb(changeUserAccess(db, { ...change, status: 'suspended' }), /последнего активного owner/);
  await rejectsDb(db.delete(user).where(eq(user.id, 'legacy')), /последнего активного owner/);
  await rejectsDb(db.update(user).set({ role: 'developer' }).where(eq(user.id, 'legacy')), /последнего активного owner/);
  assert.equal((await readUserAccess(db, 'legacy'))?.role, 'owner');
});

test('изменение доступа атомарно отзывает сессии, увеличивает поколение и записывает причину', async () => {
  const target = await fixture('changing', 'developer');
  await putSession('changing-old', target.id, target.securityGeneration);
  await changeUserAccess(db, { actor: { kind: 'user', userId: 'legacy' }, targetUserId: target.id,
    role: 'user', reason: 'Понижение тестового разработчика' });
  assert.equal(await readSessionAccess(db, 'changing-old'), null);
  assert.equal((await readUserAccess(db, target.id))?.securityGeneration, 1);
  await rejectsDb(putSession('inflight-stale', target.id, 0), /доступ изменён/);
  await putSession('changing-new', target.id, 1);
  assert.equal(can(await readSessionAccess(db, 'changing-new'), 'games.create'), false);
  const events = await db.select().from(accessEvents).where(and(eq(accessEvents.targetUserId, target.id), eq(accessEvents.action, 'access.changed')));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.actorId, 'legacy');
  assert.equal(events[0]?.previousRole, 'developer');
  assert.equal(events[0]?.nextRole, 'user');
  assert.equal(events[0]?.reason, 'Понижение тестового разработчика');
});

test('user/admin не назначают роли; ошибка и повтор без изменения не создают ложный переход', async () => {
  for (const role of ['user', 'admin'] as const) {
    const actor = await fixture(`actor-${role}`, role);
    await assert.rejects(changeUserAccess(db, { actor: { kind: 'user', userId: actor.id }, targetUserId: actor.id,
      role: 'owner', reason: 'Недопустимое повышение' }), /недостаточно прав/);
    assert.equal((await readUserAccess(db, actor.id))?.role, role);
  }
  const before = (await readUserAccess(db, 'changing'))!;
  await assert.rejects(changeUserAccess(db, { actor: operator, targetUserId: 'changing', role: 'owner', reason: '' }), /причина/);
  await changeUserAccess(db, { actor: operator, targetUserId: 'changing', role: before.role, reason: 'Без изменения роли' });
  assert.equal((await readUserAccess(db, 'changing'))?.securityGeneration, before.securityGeneration);
});

test('две параллельно запрошенные смены оставляют хотя бы одного активного owner', async () => {
  // PGlite обслуживает одну PG-сессию: это проверка результата, не двух backend-соединений.
  await changeUserAccess(db, { actor: operator, targetUserId: 'changing', role: 'owner', reason: 'Второй owner для проверки' });
  const results = await Promise.allSettled([
    changeUserAccess(db, { actor: operator, targetUserId: 'legacy', role: 'user', reason: 'Переход первого owner' }),
    changeUserAccess(db, { actor: operator, targetUserId: 'changing', status: 'suspended', reason: 'Переход второго owner' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const remaining = await db.select().from(user).where(and(eq(user.role, 'owner'), eq(user.status, 'active')));
  assert.equal(remaining.length, 1);
});

test('admin меняет статус только user/developer и не получает право менять роли', async () => {
  const actor = { kind: 'user', userId: 'actor-admin' } as const;
  await fixture('moderated', 'developer');
  await changeUserAccess(db, { actor, targetUserId: 'moderated', status: 'suspended', reason: 'Модерация' });
  assert.equal((await readUserAccess(db, 'moderated'))?.status, 'suspended');
  for (const id of ['actor-admin', 'legacy', 'changing']) {
    const target = (await readUserAccess(db, id))!;
    if (target.role === 'admin' || target.role === 'owner') {
      await assert.rejects(changeUserAccess(db, { actor, targetUserId: id, status: 'suspended', reason: 'Недопустимая модерация' }), /недостаточно прав/);
    }
  }
  await assert.rejects(changeUserAccess(db, { actor, targetUserId: 'moderated', role: 'user', reason: 'Недопустимая смена роли' }), /недостаточно прав/);
});

test('ограничения БД запрещают неизвестные роли/статус и устаревшую или заблокированную сессию', async () => {
  await fixture('constraints');
  await assert.rejects(db.update(user).set({ role: 'superadmin' }).where(eq(user.id, 'constraints')));
  await assert.rejects(db.update(user).set({ status: 'invalid' }).where(eq(user.id, 'constraints')));
  await changeUserAccess(db, { actor: operator, targetUserId: 'constraints', status: 'suspended', reason: 'Блокировка' });
  await rejectsDb(putSession('blocked-session', 'constraints', 1), /доступ изменён/);
  await rejectsDb(db.update(user).set({ securityGeneration: 0 }).where(eq(user.id, 'constraints')), /уменьшать/);
});

test('роль подключения хаба не меняет полномочия и не переписывает журнал', async () => {
  await ensureHubRole(db, 'only-test-hub-password-1234');
  await db.execute(sql.raw(`set role ${HUB_ROLE}`));
  try {
    await db.insert(user).values({ id: 'from-auth', name: 'Профиль', email: 'from-auth@example.test' });
    await db.update(user).set({ name: 'Новое имя' }).where(eq(user.id, 'from-auth'));
    await assert.rejects(db.update(user).set({ role: 'owner' }).where(eq(user.id, 'from-auth')));
    await assert.rejects(db.insert(user).values({ id: 'injected', name: 'x', email: 'x@example.test', role: 'owner' }));
    await assert.rejects(db.delete(user).where(eq(user.id, 'from-auth')));
    await assert.rejects(db.delete(accessEvents));
    await db.execute(sql`create temporary table fake_access_user (like public."user" including all)`);
    await assert.rejects(db.execute(sql`create trigger forge_access_event after insert on fake_access_user
      for each row execute function public.gf_record_user_access()`));
    await putSession('from-auth-session', 'from-auth', 0);
  } finally {
    await db.execute(sql`reset role`);
  }
});

test('F4: custom GUC хаба не подделывает автора/причину события, операторский контекст сохраняется', async () => {
  await ensureHubRole(db, 'only-test-hub-password-1234');
  await db.transaction(async (tx) => {
    await accessActorContext(tx, operator, 'Проверенный контекст оператора');
    await tx.insert(user).values({ id: 'event-operator', name: 'Оператор', email: 'event-operator@example.test' });
  });
  const [trusted] = await db.select().from(accessEvents).where(eq(accessEvents.targetUserId, 'event-operator'));
  assert.equal(trusted?.actorKind, 'operator');
  assert.equal(trusted?.actorId, null);
  assert.equal(trusted?.reason, 'Проверенный контекст оператора');

  // SET LOCAL ROLE проверяет именно вызывающую роль, а не владельца соединения
  // либо current_user внутри SECURITY DEFINER, где это уже владелец функции.
  for (const claimed of ['operator', 'user', 'invalid']) {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role ${HUB_ROLE}`));
      await tx.execute(sql`select set_config('gf.access_actor_kind', ${claimed}, true),
        set_config('gf.access_actor_id', 'forged-owner-id', true),
        set_config('gf.access_reason', 'Подставленная причина', true)`);
      await tx.insert(user).values({ id: `event-forged-${claimed}`, name: 'Хаб', email: `event-forged-${claimed}@example.test` });
      const [event] = await tx.select().from(accessEvents).where(eq(accessEvents.targetUserId, `event-forged-${claimed}`));
      assert.equal(event?.actorKind, 'system', 'подключение хаба не выбирает автора события');
      assert.equal(event?.actorId, null);
      assert.equal(event?.reason, 'Изменение через подключение БД');
    });
  }
});

function auth() {
  return createHubAuth(db, origin, 'temporary-test-auth-secret-012345678901234567890123456789');
}

async function requestAuth(service: ReturnType<typeof auth>, path: string, body?: Record<string, unknown>, cookie?: string) {
  return service.handler(new Request(`${origin}/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-real-ip': '127.0.0.1', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

function sessionCookie(response: Response): string {
  const value = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(value, 'успешный вход выдаёт __Host-сессию');
  assert.match(value, /; Secure/i);
  assert.match(value, /; HttpOnly/i);
  assert.doesNotMatch(value, /; Domain=/i);
  return value.split(';')[0]!;
}

test('реальные HTTP auth: роль не меняется через профиль, регистрация/удаление закрыты, old cookie отозвана', async () => {
  const id = await createOwner(db, 'http-owner@example.test', 'Тестовый owner', password);
  const service = auth();
  const login = await requestAuth(service, 'sign-in/email', { email: 'http-owner@example.test', password });
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = sessionCookie(login);
  const sessionResponse = await requestAuth(service, 'get-session', undefined, cookie);
  const logged = await sessionResponse.json();
  assert.equal(can(await readSessionAccess(db, logged.session.id), 'kit.view'), true);
  for (const body of [{ role: 'user' }, { status: 'suspended' }, { securityGeneration: 42 }, { emailVerified: true }]) {
    const response = await requestAuth(service, 'update-user', { name: 'Профиль', ...body }, cookie);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal((await readUserAccess(db, id))?.role, 'owner');
  const deletion = await requestAuth(service, 'delete-user', { password }, cookie);
  assert.notEqual(deletion.status, 200);
  const signup = await requestAuth(service, 'sign-up/email', { email: 'new@example.test', password, name: 'Новый' });
  assert.notEqual(signup.status, 200);
  await changeUserAccess(db, { actor: operator, targetUserId: id, role: 'user', reason: 'Отзыв роли в HTTP-сценарии' });
  assert.equal(await (await requestAuth(service, 'get-session', undefined, cookie)).json(), null);
  const again = await requestAuth(service, 'sign-in/email', { email: 'http-owner@example.test', password });
  assert.equal(again.status, 200);
  const newSession = await (await requestAuth(service, 'get-session', undefined, sessionCookie(again))).json();
  assert.equal(can(await readSessionAccess(db, newSession.session.id), 'kit.view'), false);
});

test('блокировка закрывает новый парольный вход и общий путь создания сессий passkey, разблокировка не оживляет old cookie', async () => {
  const id = await createOwner(db, 'http-blocked@example.test', 'Блокируемый', password);
  const service = auth();
  const login = await requestAuth(service, 'sign-in/email', { email: 'http-blocked@example.test', password });
  assert.equal(login.status, 200);
  const cookie = sessionCookie(login);
  await changeUserAccess(db, { actor: operator, targetUserId: id, status: 'suspended', reason: 'Блокировка HTTP' });
  const blocked = await requestAuth(service, 'sign-in/email', { email: 'http-blocked@example.test', password });
  assert.notEqual(blocked.status, 200);
  assert.equal(blocked.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`)), false);
  assert.equal(await (await service.$context).internalAdapter.createSession(id), null);
  const update = await requestAuth(service, 'update-user', { name: 'Не должно сохраниться' }, cookie);
  assert.notEqual(update.status, 200);
  assert.equal((await readUserAccess(db, id))?.name, 'Блокируемый');
  await changeUserAccess(db, { actor: operator, targetUserId: id, status: 'active', reason: 'Разблокировка HTTP' });
  assert.equal(await (await requestAuth(service, 'get-session', undefined, cookie)).json(), null);
  assert.equal((await requestAuth(service, 'sign-in/email', { email: 'http-blocked@example.test', password })).status, 200);
});

test('аварийная смена пароля остаётся атомарным отзывом сессий и passkey', async () => {
  const id = await createOwner(db, 'reset@example.test', 'Сброс', password);
  await putSession('before-reset', id, 0);
  await setPassword(db, 'reset@example.test', 'Другой тестовый пароль для БД');
  assert.equal((await readUserAccess(db, id))?.securityGeneration, 1);
  assert.equal(await readSessionAccess(db, 'before-reset'), null);
  await rejectsDb(putSession('reset-inflight', id, 0), /доступ изменён/);
});

test('реальный вход и изменение профиля работают с ограниченной SQL-ролью хаба', async () => {
  await createOwner(db, 'limited-db@example.test', 'Ограниченный SQL', password);
  const service = auth();
  await ensureHubRole(db, 'only-test-hub-password-1234');
  await db.execute(sql.raw(`set role ${HUB_ROLE}`));
  try {
    const login = await requestAuth(service, 'sign-in/email', { email: 'limited-db@example.test', password });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = sessionCookie(login);
    const profile = await requestAuth(service, 'update-user', { name: 'Обновлённый профиль' }, cookie);
    assert.equal(profile.status, 200, await profile.clone().text());
    const current = await (await requestAuth(service, 'get-session', undefined, cookie)).json();
    assert.equal(current.user.name, 'Обновлённый профиль');
    assert.equal(can(await readSessionAccess(db, current.session.id), 'kit.view'), true);
  } finally {
    await db.execute(sql`reset role`);
  }
});
