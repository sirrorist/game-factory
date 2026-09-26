// Общий стенд e2e: собранные данные, сервер игр и эталонный хаб.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { chromium, type Browser } from 'playwright';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlayServer } from '../../apps/play-server/src/server.ts';

const ROOT = new URL('../../', import.meta.url).pathname;

/** Версия игры из её game.json: тесты не должны ломаться при выпуске новой версии. */
export function gameVersion(id: string): string {
  return (JSON.parse(readFileSync(join(ROOT, 'games', id, 'game.json'), 'utf8')) as { version: string }).version;
}

export function buildData(): string {
  const data = mkdtempSync(join(tmpdir(), 'gf-e2e-'));
  for (const cmd of [['build'], ['export']]) {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools/gf.ts'), ...cmd], {
      env: { ...process.env, GF_DATA_DIR: data },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`gf ${cmd.join(' ')}: ${r.stderr}`);
  }
  return data;
}

/**
 * Chromium без GPU рисует WebGL программно (SwiftShader). Молчаливый откат на него
 * объявлен устаревшим - флаг включает его явно, иначе Three.js однажды останется без WebGL.
 * GF_CHROMIUM_PATH - готовый браузер, когда скачать свой нельзя (облачная среда агента, П-030).
 */
export function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    args: ['--enable-unsafe-swiftshader'],
    executablePath: process.env.GF_CHROMIUM_PATH || undefined,
  });
}

export function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

export async function startPlay(data: string, hubOrigins: string[]): Promise<{ server: Server; port: number }> {
  const server = createPlayServer({ baseHost: 'play.localhost', port: 0, host: '127.0.0.1', hubOrigins, dataDir: data });
  return { server, port: await listen(server) };
}

/** Эталонный хаб: страница с iframe и мостом из packages/hub-bridge, TS отдаётся без сборщика. */
export function mockHub(config: () => { gameId: string; gameOrigin: string }): Server {
  const html = readFileSync(join(ROOT, 'tests/e2e/fixtures/mock-hub.html'), 'utf8');
  const bridge = stripTypeScriptTypes(readFileSync(join(ROOT, 'packages/hub-bridge/src/index.ts'), 'utf8'));
  return createServer((req, res) => {
    if (req.url === '/') {
      // "<" экранируется, чтобы конфиг не мог закрыть <script>.
      const cfg = JSON.stringify(config()).replace(/</g, '\\u003c');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html.replace('__CONFIG__', cfg));
    } else if (req.url === '/bridge.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(bridge);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

/** Свободный порт: занять нулевой и отпустить. Нужен заранее - хаб и сервер игр ссылаются друг на друга. */
export async function freePort(): Promise<number> {
  const s = createServer();
  const port = await listen(s);
  await close(s);
  return port;
}

export interface Hub {
  origin: string;
  stop(): Promise<void>;
}

/**
 * Настоящий хаб (apps/hub) из готовой сборки `pnpm hub:build`: так e2e проверяет то же,
 * что поедет на сервер, а не режим разработки.
 */
export async function startHub(opts: { port: number; dataDir: string; playPort: number }): Promise<Hub> {
  const dir = join(ROOT, 'apps/hub');
  if (!existsSync(join(dir, '.next/BUILD_ID'))) throw new Error('хаб не собран: сначала pnpm hub:build');
  const child: ChildProcess = spawn(
    process.execPath,
    [join(dir, 'node_modules/next/dist/bin/next'), 'start', '--port', String(opts.port)],
    {
      cwd: dir,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        GF_DATA_DIR: opts.dataDir,
        GF_PLAY_PUBLIC_ORIGIN_TEMPLATE: `http://{id}.play.localhost:${opts.playPort}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));

  const origin = `http://localhost:${opts.port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`хаб упал при старте:\n${log}`);
    try {
      const r = await fetch(`http://127.0.0.1:${opts.port}/`);
      if (r.ok) break;
    } catch {
      // ещё не слушает
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`хаб не ответил за 30 с:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    origin,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}
