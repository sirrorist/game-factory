// Общий стенд e2e: собранные данные, сервер игр и эталонный хаб.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlayServer } from '../../apps/play-server/src/server.ts';

const ROOT = new URL('../../', import.meta.url).pathname;

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
