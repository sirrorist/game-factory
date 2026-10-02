// Команды владельца на сервере - в одноразовом контейнере `migrate`, ролью владельца базы:
//
//   docker compose run --rm -it migrate node src/admin.ts create-owner --email <почта> --name <имя>
//   docker compose run --rm -it migrate node src/admin.ts set-password --email <почта>
//
// Пароль - только скрытым вводом (правило кита: не в аргументах и не в переменных) или файлом
// GF_ADMIN_PASSWORD_FILE (e2e). Регистрации через хаб нет (D-047, Р3): владелец - только отсюда,
// а сброс пароля без почты - `set-password`.
//
// Хеш - тот же scrypt, что у Better Auth (`@better-auth/utils/password`): хаб проверяет пароль
// своим кодом, совпадение форматов держит тест хаба (apps/hub/test/password.test.ts).

import { randomBytes, scrypt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { account, createDb, databaseUrl, passkey, session, user, type AnyDb } from './index.ts';

import { MIN_PASSWORD_LENGTH } from './policy.ts';

export { MIN_PASSWORD_LENGTH };
const SCRYPT = { N: 16384, r: 16, p: 1, dkLen: 64 };

/** Хеш пароля в формате Better Auth: `<соль hex>:<ключ hex>`, соль - строкой, пароль - NFKC. */
export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): Promise<string> {
  return new Promise((resolve, reject) => {
    const { N, r, p, dkLen } = SCRYPT;
    scrypt(password.normalize('NFKC'), salt, dkLen, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(`${salt}:${key.toString('hex')}`),
    );
  });
}

function newId(): string {
  return randomBytes(24).toString('base64url');
}

export async function createOwner(db: AnyDb, email: string, name: string, password: string): Promise<string> {
  checkPassword(password);
  const id = newId();
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (taken) throw new Error(`пользователь ${email} уже есть - сменить пароль: set-password`);
    await tx.insert(user).values({ id, email, name, emailVerified: true });
    await tx.insert(account).values({ id: newId(), accountId: id, providerId: 'credential', userId: id, password: hash });
  });
  return id;
}

export async function setPassword(db: AnyDb, email: string, password: string): Promise<void> {
  checkPassword(password);
  const hash = await hashPassword(password);
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!u) throw new Error(`пользователя ${email} нет`);
  const done = await db
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(eq(account.userId, u.id))
    .returning({ id: account.id });
  if (!done.length) throw new Error(`у ${email} нет входа по паролю`);
  // Новый пароль - значит, старый мог утечь: все сессии - заново, и passkey тоже - тот, кто
  // знал пароль, мог добавить свой ключ и войти им после смены пароля. Свои - добавить на /account.
  await db.delete(session).where(eq(session.userId, u.id));
  await db.delete(passkey).where(eq(passkey.userId, u.id));
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`пароль короче ${MIN_PASSWORD_LENGTH} символов`);
}

/** Скрытый ввод: терминал в сыром режиме, символы не печатаются. */
function askHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error('нужен терминал (docker compose run -it) или GF_ADMIN_PASSWORD_FILE');
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let buf = '';
    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          finish();
          resolve(buf);
          return;
        }
        if (c === '\u0003') {
          finish();
          reject(new Error('прервано'));
          return;
        }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  const file = process.env.GF_ADMIN_PASSWORD_FILE;
  if (file) return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  const first = await askHidden('Пароль: ');
  const again = await askHidden('Ещё раз: ');
  if (first !== again) throw new Error('пароли не совпали');
  return first;
}

function arg(args: string[], name: string): string {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (!v) throw new Error(`нужен --${name}`);
  return v;
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (cmd !== 'create-owner' && cmd !== 'set-password') {
    throw new Error('команды: create-owner --email <почта> --name <имя> | set-password --email <почта>');
  }
  const email = arg(args, 'email').trim().toLowerCase();
  const name = cmd === 'create-owner' ? arg(args, 'name') : '';
  const url = databaseUrl();
  if (!url) throw new Error('база не настроена: нужен GF_DATABASE_URL или GF_DB_HOST + GF_DB_PASSWORD_FILE');
  const password = await readPassword();
  const { db, close } = createDb(url);
  try {
    if (cmd === 'create-owner') console.log(`владелец заведён: ${email} (${await createOwner(db, email, name, password)})`);
    else {
      await setPassword(db, email, password);
      console.log(`пароль сменён: ${email}; сессии и passkey сброшены - войти паролем, passkey добавить заново`);
    }
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    // Ошибка запроса drizzle несёт в сообщении весь SQL с параметрами (хеш пароля) - печатаем причину.
    const err = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    console.error(`gf-admin: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
