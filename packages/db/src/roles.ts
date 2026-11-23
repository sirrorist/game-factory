// Роль хаба в базе (D-051, слайс 1.2): хаб ходит не владельцем базы, а ролью только на данные.
// Владелец базы (`gf`, суперпользователь образа postgres) - только у миграций и `admin.ts`.
// Снятая с хаба роль владельца - это и есть защита: SQL-инъекция или ошибка в хабе не создаст
// таблицу, не тронет схему и не выполнит `copy … to program` (это право только у суперпользователя).

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';

export const HUB_ROLE = 'gf_hub';
export const AUTH_ROLE = 'gf_auth';

type Exec = { execute(query: SQL): PromiseLike<unknown> };

async function revokeColumnGrants(db: Exec, role: typeof HUB_ROLE | typeof AUTH_ROLE) {
  // Табличный REVOKE не снимает ранее выданные права отдельных колонок.
  await db.execute(sql.raw(`do $$ declare r record; begin
    for r in select n.nspname,c.relname,string_agg(quote_ident(a.attname),',') as columns
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      where n.nspname in ('public','auth_private') and c.relkind in ('r','p')
      group by n.nspname,c.relname loop
      execute format('revoke select (%s), insert (%s), update (%s), references (%s) on table %I.%I from ${role}, public',
        r.columns,r.columns,r.columns,r.columns,r.nspname,r.relname);
    end loop;
  end $$`));
}

/** Строковый литерал SQL: при standard_conforming_strings (по умолчанию с PG 9.1) хватает удвоить '. */
export function quoteLiteral(value: string): string {
  if (value.includes('\0')) throw new Error('в строке для SQL нулевой байт');
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * SCRAM-SHA-256-верификатор пароля в формате Postgres (RFC 5802/7677): роли ставится он, а не
 * пароль. Открытый пароль тогда не попадает ни в SQL, ни в журнал Postgres или drizzle при сбое
 * запроса. SASLprep не делаем - пароль только из печатного ASCII, для него SASLprep - тождество.
 */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  if (!/^[\x21-\x7e]+$/.test(password)) throw new Error('пароль роли - только печатный ASCII без пробелов');
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/**
 * Завести или обновить роль хаба и выдать ей права на текущие таблицы. Зовётся после миграций
 * (`migrate.ts`): новая таблица получает права в той же выкладке. Пароль - из файла-секрета;
 * повторный запуск ставит его заново, так меняют пароль роли.
 */
export async function ensureHubRole(db: Exec, password: string): Promise<void> {
  if (password.length < 16) throw new Error(`пароль роли ${HUB_ROLE} короче 16 символов`);
  await db.execute(sql.raw(`do $$ begin
    if not exists (select from pg_roles where rolname = '${HUB_ROLE}') then create role ${HUB_ROLE}; end if;
  end $$`));
  // Явно всё "no": роль могли завести руками с лишним.
  await db.execute(
    sql.raw(
      `alter role ${HUB_ROLE} with login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${quoteLiteral(scramVerifier(password))}`,
    ),
  );
  // С PG 15 у PUBLIC нет create в public, но база могла прийти из дампа старой версии.
  await db.execute(sql.raw('revoke create on schema public from public'));
  await db.execute(sql.raw(`grant usage on schema public to ${HUB_ROLE}`));
  // Белый список: новая таблица никогда не получает случайных прав хаба.
  // Снимаем также column-level grants прошлых запусков и косвенное членство.
  await db.execute(sql.raw(`do $$ declare r record; begin
    for r in select pr.rolname from pg_auth_members m join pg_roles pr on pr.oid=m.roleid
      join pg_roles member_role on member_role.oid=m.member where member_role.rolname='${HUB_ROLE}' loop
      execute format('revoke %I from ${HUB_ROLE}', r.rolname);
    end loop;
    if exists(select 1 from pg_class c join pg_namespace object_schema on object_schema.oid=c.relnamespace
      join pg_roles owner_role on owner_role.oid=c.relowner where object_schema.nspname !~ '^pg_(toast_)?temp_' and owner_role.rolname='${HUB_ROLE}') then
      raise exception 'роль хаба не должна владеть объектами БД';
    end if;
  end $$`));
  await db.execute(sql.raw(`revoke all on all tables in schema public from ${HUB_ROLE}, public`));
  await revokeColumnGrants(db,HUB_ROLE);
  await db.execute(sql.raw(`revoke all on all functions in schema public from ${HUB_ROLE}`));
  await db.execute(sql.raw(`revoke all on all sequences in schema public from ${HUB_ROLE}, public`));
  await db.execute(sql.raw(`grant select, insert, update, delete on account, passkey, verification,
    game_saves, scores, auth_actions, auth_mail_operations, auth_mail_counters to ${HUB_ROLE}`));
  await db.execute(sql.raw(`grant select on "user", access_events, access_lock, auth_recovery_guards to ${HUB_ROLE}`));
  await db.execute(sql.raw(`grant select, insert, delete on session to ${HUB_ROLE}`));
  await db.execute(sql.raw(`revoke update (id, token, user_id, security_generation, created_at, ip_address, user_agent, expires_at, updated_at)
    on session from ${HUB_ROLE}, public`));
  await db.execute(sql.raw(`grant update (expires_at, updated_at) on session to ${HUB_ROLE}`));
  // identity нужна только scores; журнал хаб не вставляет и его sequence не получает.
  await db.execute(sql.raw(`grant usage, select on sequence scores_id_seq to ${HUB_ROLE}`));
  // До усиленного входа управление правами — только операторским подключением.
  // Better Auth меняет профиль, но не может записать роль, статус или поколение.
  await db.execute(sql.raw(`revoke insert, update, delete on "user" from ${HUB_ROLE}`));
  // INSERT перечисляет и DEFAULT-колонки Drizzle; значения прав ограничивает триггер.
  await db.execute(sql.raw(`grant insert, update (name, email, email_verified, image, updated_at) on "user" to ${HUB_ROLE}`));
  await db.execute(sql.raw(`revoke insert, update, delete on access_events from ${HUB_ROLE}`));
  await db.execute(sql.raw(`revoke insert, update, delete on access_lock from ${HUB_ROLE}`));
  await db.execute(sql.raw(`revoke insert, update, delete on auth_recovery_guards from ${HUB_ROLE}`));
  await db.execute(sql.raw(`grant execute on function gf_consume_auth_action(text,text,text,text) to ${HUB_ROLE}`));
  await db.execute(sql.raw(`grant execute on function gf_auth_mail_lock() to ${HUB_ROLE}`));
  await db.execute(sql.raw(`revoke all on schema auth_private from ${HUB_ROLE}, public`));
  await db.execute(sql.raw(`revoke all on all tables in schema auth_private from ${HUB_ROLE}, public`));
  await db.execute(sql.raw(`revoke all on all sequences in schema auth_private from ${HUB_ROLE}, public`));
  for (const signature of B_WRITERS) await db.execute(sql.raw(`revoke all on function ${signature} from ${HUB_ROLE}, public`));
  await db.execute(sql.raw(`grant execute on function gf_b_session_access(text,text), gf_b_required(text) to ${HUB_ROLE}`));
}

const B_WRITERS = [
  'gf_b_reserve(text,text,text)',
  'gf_b_password_context(text,integer,text,text,text,text,text,text,text)',
  'gf_b_totp_login(text,text,text,text,bigint,text,text,text)',
  'gf_b_snapshot(text,text)',
  'gf_b_password_login(text,text,text,text)',
  'gf_b_setup(text,text,text)',
  'gf_b_exchange_enrol(text,text)',
  'gf_b_totp_pending(text,text,text,text)',
  'gf_b_totp_complete(text,text,text,text,bigint,text[],text,text)',
  'gf_b_backup_context(text,text)',
  'gf_b_uv_login_context(text,text)',
  'gf_b_backup_recover(text,text,text,text,text)',
  'gf_b_password_change(text,text,text,text,text)',
  'gf_b_backup_rotate(text,text,text[],text)',
  'gf_b_disable_optional(text,text)',
  'gf_b_uv_snapshot(text)',
  'gf_b_enrol_key(text,jsonb)',
  'gf_b_uv_context(text,text,text)',
  'gf_b_uv_finish(text,integer,text,text,integer,text,text,text,text,text[],text)',
];

/** Только процедуры auth, без прямых SELECT/DML закрытой схемы и без членства gf_hub. */
export async function ensureAuthRole(db: Exec, password: string): Promise<void> {
  if (password.length < 16) throw new Error('пароль роли auth короче 16 символов');
  const verifier = scramVerifier(password);
  await db.execute(sql.raw(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='${AUTH_ROLE}') then create role ${AUTH_ROLE}; end if;
  end $$`));
  await db.execute(sql.raw(`alter role ${AUTH_ROLE} with login nosuperuser nocreatedb nocreaterole noinherit
    noreplication nobypassrls password ${quoteLiteral(verifier)}`));
  await db.execute(sql.raw(`do $$ declare r record; begin
    for r in select pr.rolname from pg_auth_members m join pg_roles pr on pr.oid=m.roleid
      join pg_roles member_role on member_role.oid=m.member where member_role.rolname='${AUTH_ROLE}' loop
      execute format('revoke %I from ${AUTH_ROLE}',r.rolname);
    end loop;
    if exists(select 1 from pg_class c join pg_namespace object_schema on object_schema.oid=c.relnamespace
      join pg_roles owner_role on owner_role.oid=c.relowner where object_schema.nspname !~ '^pg_(toast_)?temp_' and owner_role.rolname='${AUTH_ROLE}') then
      raise exception 'роль auth не должна владеть объектами БД';
    end if;
  end $$`));
  await db.execute(sql.raw(`revoke all on all tables in schema public from ${AUTH_ROLE}`));
  await revokeColumnGrants(db,AUTH_ROLE);
  await db.execute(sql.raw(`revoke all on all functions in schema public from ${AUTH_ROLE}`));
  await db.execute(sql.raw(`revoke all on all sequences in schema public from ${AUTH_ROLE}`));
  await db.execute(sql.raw(`revoke all on schema auth_private from ${AUTH_ROLE}`));
  await db.execute(sql.raw(`revoke all on all tables in schema auth_private from ${AUTH_ROLE}`));
  await db.execute(sql.raw(`revoke all on all sequences in schema auth_private from ${AUTH_ROLE}`));
  await db.execute(sql.raw(`grant usage on schema public to ${AUTH_ROLE}`));
  await db.execute(sql.raw(`revoke all on function gf_b_operator_enrol(text,text,text,text), gf_b_fresh(text,text) from ${AUTH_ROLE}`));
  await db.execute(sql.raw(`grant execute on function gf_b_session_access(text,text), gf_b_required(text) to ${AUTH_ROLE}`));
  for (const signature of B_WRITERS) await db.execute(sql.raw(`grant execute on function ${signature} to ${AUTH_ROLE}`));
}
