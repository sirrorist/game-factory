// Только тестовый стенд. Не наследуем ключи и настройки машины, запускающей CI.
import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export function requireCheck(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error(label);
}
export function testDatabaseUrl(raw: string | undefined): string {
  requireCheck(raw, 'не задан отдельный адрес тестовой БД');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('неверный адрес тестовой БД'); }
  requireCheck(url.protocol === 'postgres:' && url.hostname === '127.0.0.1' && url.port === '5432' &&
    url.username === 'gf_ci' && url.password === 'auth-a-ci-only' && url.pathname === '/gf_auth_a' &&
    !url.search && !url.hash, 'разрешена только выделенная синтетическая CI-БД');
  return url.href;
}
export function cleanEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC',
    NEXT_TELEMETRY_DISABLED: '1', ...extra };
}
export function standaloneArgs(layout: string, fixtures: string, entry = join(layout, 'apps/hub/server.js')): string[] {
  return ['--permission', `--allow-fs-read=${layout}`, `--allow-fs-read=${fixtures}`, entry];
}
export function inside(root: string, path: string): boolean {
  const part = relative(resolve(root), resolve(path));
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep));
}
export async function checkLayout(root: string): Promise<void> {
  const canonical = await realpath(root);
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      requireCheck(inside(canonical, await realpath(path)), 'standalone содержит внешнюю ссылку');
    } else if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name));
    }
  }
  await visit(root);
}
export async function until(check: () => Promise<boolean>, label: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  do {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(label);
}
// Никаких дампов объекта ошибки: URL, SQL и args могут содержать bearer/пароли.
export async function safeCase(fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch { throw new Error('интеграционный сценарий не выполнен; исходные данные скрыты'); }
}
