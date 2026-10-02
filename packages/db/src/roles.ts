// Роль хаба в базе (D-051, слайс 1.2): хаб ходит не владельцем базы, а ролью только на данные.
// Владелец базы (`gf`, суперпользователь образа postgres) - только у миграций и `admin.ts`.
// Снятая с хаба роль владельца - это и есть защита: SQL-инъекция или ошибка в хабе не создаст
// таблицу, не тронет схему и не выполнит `copy … to program` (это право только у суперпользователя).

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';

export const HUB_ROLE = 'gf_hub';

type Exec = { execute(query: SQL): PromiseLike<unknown> };

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
  await db.execute(sql.raw(`grant select, insert, update, delete on all tables in schema public to ${HUB_ROLE}`));
  // identity-колонки (scores.id) берут значения из последовательности - без usage вставка падает.
  await db.execute(sql.raw(`grant usage, select on all sequences in schema public to ${HUB_ROLE}`));
}
