import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { offlineProblems } from './gf.ts';

const run = promisify(execFile);

const GF = new URL('./gf.ts', import.meta.url).pathname;

function gf(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [GF, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('офлайн-проверка ловит внешний модульный скрипт', () => {
  const r = offlineProblems([
    { path: 'index.html', data: Buffer.from('<script type="module" src="main.js"></script>') },
  ]);
  assert.equal(r.errors.length, 1);
});

test('офлайн-проверка пропускает классический и встроенный модульный скрипт', () => {
  const r = offlineProblems([
    { path: 'index.html', data: Buffer.from('<script src="a.js"></script><script type="module">1</script>') },
  ]);
  assert.deepEqual(r.errors, []);
});

test('офлайн-проверка предупреждает о fetch', () => {
  const r = offlineProblems([{ path: 'a.js', data: Buffer.from('fetch("x")') }]);
  assert.equal(r.warnings.length, 1);
});

test('build: опубликованная версия неизменяема', () => {
  const data = mkdtempSync(join(tmpdir(), 'gf-data-'));
  const first = gf(['build', 'snake'], { GF_DATA_DIR: data });
  assert.equal(first.status, 0, first.stderr);
  const again = gf(['build', 'snake'], { GF_DATA_DIR: data });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /без изменений/);

  // Подменяем опубликованные файлы - хеш в meta уже не совпадёт с тем, что соберётся.
  const meta = join(data, 'storage/games/snake/1.0.0.meta.json');
  const m = JSON.parse(readFileSync(meta, 'utf8'));
  writeFileSync(meta, JSON.stringify({ ...m, hash: 'другой' }));
  const changed = gf(['build', 'snake'], { GF_DATA_DIR: data });
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /неизменяема/);
});

test('export: архив появляется в реестре', () => {
  const data = mkdtempSync(join(tmpdir(), 'gf-data-'));
  assert.equal(gf(['build', 'snake'], { GF_DATA_DIR: data }).status, 0);
  const r = gf(['export', 'snake'], { GF_DATA_DIR: data });
  assert.equal(r.status, 0, r.stderr);
  const registry = JSON.parse(readFileSync(join(data, 'registry.json'), 'utf8'));
  assert.equal(registry.games[0].export.file, 'snake-1.0.0.zip');
});

test('неизвестная игра и флаг - понятная ошибка', () => {
  const data = mkdtempSync(join(tmpdir(), 'gf-data-'));
  assert.match(gf(['build', 'nope'], { GF_DATA_DIR: data }).stderr, /не найдена/);
  assert.match(gf(['build', '--force'], { GF_DATA_DIR: data }).stderr, /неизвестный флаг/);
});


test('build --prebuilt: берёт готовый output и не запускает сборку', () => {
  const games = mkdtempSync(join(tmpdir(), 'gf-games-'));
  const data = mkdtempSync(join(tmpdir(), 'gf-data-'));
  assert.equal(gf(['new', 'ready'], { GF_GAMES_DIR: games }).status, 0);
  const env = { GF_GAMES_DIR: games, GF_DATA_DIR: data };

  // Сборки нет, а запускать её нельзя: ошибка про папку, а не падение pnpm.
  const missing = gf(['build', 'ready', '--prebuilt'], env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /нет папки/);

  mkdirSync(join(games, 'ready/dist'));
  writeFileSync(join(games, 'ready/dist/index.html'), '<!doctype html><title>ready</title>');
  writeFileSync(join(games, 'ready/dist/cover.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const r = gf(['build', 'ready', '--prebuilt'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ready@0\.1\.0: опубликована/);
});

test('check-prod: та же version с другим содержимым - красный, остальное - нет', async () => {
  const data = mkdtempSync(join(tmpdir(), 'gf-data-'));
  assert.equal(gf(['build', 'snake'], { GF_DATA_DIR: data }).status, 0);
  const tag = JSON.parse(readFileSync(join(data, 'registry.json'), 'utf8')).games[0].hash.slice(0, 16);

  // Поддельный прод: отвечает так, как настроено для текущего случая.
  let prod: { status: number; game?: string; etag?: string } = { status: 404 };
  const server = createServer((_req, res) => {
    res.writeHead(prod.status, {
      ...(prod.game ? { 'X-GF-Game': prod.game } : {}),
      ...(prod.etag ? { ETag: prod.etag } : {}),
    });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  // spawnSync заблокировал бы цикл событий, и поддельный прод не смог бы ответить.
  const check = (url = `http://127.0.0.1:${port}/{id}/`) =>
    run(process.execPath, [GF, 'check-prod'], { env: { ...process.env, GF_DATA_DIR: data, GF_PROD_GAME_URL: url } }).then(
      () => ({ code: 0, stderr: '' }),
      (e: { code: number; stderr: string }) => ({ code: e.code, stderr: e.stderr }),
    );

  try {
    prod = { status: 200, game: 'snake@1.0.0', etag: `"${tag}-f6013a00"` };
    assert.equal((await check()).code, 0, 'совпадает с продом');

    prod = { status: 200, game: 'snake@1.0.0', etag: '"0000000000000000-f6013a00"' };
    const stale = await check();
    assert.equal(stale.code, 1, 'другое содержимое при той же версии');
    assert.match(stale.stderr, /Подними "version"/);

    prod = { status: 200, game: 'snake@0.9.0', etag: '"0000000000000000-f6013a00"' };
    assert.equal((await check()).code, 0, 'на проде старая версия - это выкладка новой');

    prod = { status: 404 };
    assert.equal((await check()).code, 0, 'новой игры на проде нет');

    assert.equal((await check('http://127.0.0.1:1/{id}/')).code, 0, 'прод недоступен - только предупреждение');
    assert.equal((await check('http://127.0.0.1:1/')).code, 1, 'адрес без {id}');
  } finally {
    server.close();
  }
});

test('new: игра из шаблона vite-ts проходит проверку манифеста', () => {
  const games = mkdtempSync(join(tmpdir(), 'gf-games-'));
  const r = gf(['new', 'my-game'], { GF_GAMES_DIR: games });
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(readFileSync(join(games, 'my-game/game.json'), 'utf8'));
  assert.equal(manifest.id, 'my-game');
  assert.equal(manifest.toolchain, 'vite-ts');
  assert.equal(JSON.parse(readFileSync(join(games, 'my-game/package.json'), 'utf8')).name, '@gf-game/my-game');
  assert.equal(existsSync(join(games, 'my-game/node_modules')), false, 'node_modules шаблона скопировался');
  assert.equal(existsSync(join(games, 'my-game/dist')), false, 'сборка шаблона скопировалась');
  assert.equal(gf(['validate', 'my-game'], { GF_GAMES_DIR: games }).status, 0);

  const again = gf(['new', 'my-game'], { GF_GAMES_DIR: games });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /уже есть/);
  assert.equal(gf(['new', 'admin'], { GF_GAMES_DIR: games }).status, 1);
});
