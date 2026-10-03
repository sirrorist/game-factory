// Скриншоты игры в трёх раскладках - доказательство "ПК = телефон" для приёмки (docs/GAME-TZ.md, D-061).
// pnpm shots <id>: собирает игру во временный каталог, поднимает сервер игр на свободном порту,
// открывает игру сама по себе (standalone) на ПК, телефоне боком и стоя, ждёт ready(), снимает
// экран через 3 с игры и пишет, были ли ошибки в консоли и включился ли тач (pointer: coarse).
// Снимки - в test-results/shots/<id>/ (в .gitignore). Нужен Chromium: pnpm exec playwright install chromium.
// На сервере (VPS-1) не запускать - памяти на Chromium рядом с продом нет (D-049).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPlayServer } from '../apps/play-server/src/server.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const PROFILES = [
  { name: 'pc-1280x720', viewport: { width: 1280, height: 720 }, touch: false },
  { name: 'phone-landscape-844x390', viewport: { width: 844, height: 390 }, touch: true },
  { name: 'phone-portrait-390x844', viewport: { width: 390, height: 844 }, touch: true },
] as const;

const id = process.argv[2];
if (!id || !/^[a-z0-9-]+$/.test(id)) {
  console.error('нужен id игры: pnpm shots <id>');
  process.exit(2);
}

const data = mkdtempSync(join(tmpdir(), 'gf-shots-'));
const built = spawnSync(process.execPath, [join(ROOT, 'tools/gf.ts'), 'build', id], {
  env: { ...process.env, GF_DATA_DIR: data },
  stdio: 'inherit',
});
if (built.status !== 0) process.exit(built.status ?? 1);

const server = createPlayServer({ baseHost: 'play.localhost', port: 0, host: '127.0.0.1', hubOrigins: [], dataDir: data });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const url = `http://${id}.play.localhost:${port}/`;
const out = join(ROOT, 'test-results', 'shots', id);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  // Без GPU WebGL рисует программно - явно, иначе Three.js однажды останется без WebGL (как в e2e)
  args: ['--enable-unsafe-swiftshader'],
  executablePath: process.env.GF_CHROMIUM_PATH || undefined,
});
let failed = false;
try {
  for (const p of PROFILES) {
    const context = await browser.newContext({
      viewport: p.viewport,
      hasTouch: p.touch,
      isMobile: p.touch,
      deviceScaleFactor: p.touch ? 2 : 1,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(url);
    const ready = await page
      .waitForSelector('html[data-gf-ready]', { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(3000);
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const file = join(out, `${p.name}.png`);
    await page.screenshot({ path: file });
    const verdict = ready && errors.length === 0 ? 'ok' : 'ОШИБКА';
    if (verdict !== 'ok') failed = true;
    console.log(`${verdict}  ${p.name}: ready=${ready}, pointer:coarse=${coarse}, ошибок=${errors.length} -> ${file}`);
    for (const e of errors.slice(0, 5)) console.log(`      ${e}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
