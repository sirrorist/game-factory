// Совместная проверка общего просмотрщика с сайтом, специальным и обычным адаптером игры.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './core/paths.ts';
import { loadAdapter } from './core/adapters.ts';
import { assertDevelopment, startComparison } from './core/server.ts';

assertDevelopment();
const out = join(ROOT, 'test-results/project-ui-migration'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'], executablePath: process.env.GF_CHROMIUM_PATH || undefined });
const observations: unknown[] = [];
let complete = false;
try {
  for (const id of ['hub', 'superwalk', 'snake']) {
    if (id === 'snake') process.env.GF_UI_RUN = 'project-tool'; else delete process.env.GF_UI_RUN;
    const adapter = await loadAdapter(id), target = adapter.comparison(), server = await startComparison(target);
    // Не навязываем iframe глобальную media-эмуляцию: проверяем наследование
    // color-scheme от просмотрщика, как в обычном браузере.
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: null });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(server.url);
      if (!target.themes && await page.locator('#theme-label').isVisible()) throw new Error('У игры показан пустой выбор темы');
      for (const theme of target.themes ?? ['default']) {
        if (theme !== 'default') { await page.locator('#theme').selectOption(theme); await page.waitForTimeout(250); }
        for (const side of ['before', 'after']) {
          const html = page.frameLocator(`#${side} iframe`).locator('html[data-ui-ready],html[data-hub-ui-ready],html[data-gf-ready]');
          await html.waitFor({ timeout: 15000 });
          const state = await html.evaluate(() => ({ width: innerWidth, height: innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches }));
          if (state.width !== target.profiles[0]!.width || state.height !== target.profiles[0]!.height) throw new Error('Размер iframe изменился');
          if (theme !== 'default' && state.dark !== (theme === 'dark')) throw new Error('Выбор темы не изменил prefers-color-scheme внутри iframe');
          observations.push({ id, side, theme, state });
        }
        await page.screenshot({ path: join(out, `${id}-${theme}-compare.png`), fullPage: true });
      }
      if (errors.length) throw new Error(errors.join('\n'));
    } finally { await page.close(); await server.close(); }
  }
  complete = true;
} finally {
  await browser.close();
  const runnerHash = createHash('sha256').update(readFileSync(new URL('./browser-smoke.ts', import.meta.url))).digest('hex');
  writeFileSync(join(out, 'browser-smoke.json'), JSON.stringify({ complete, failed: complete ? 0 : 1, runnerHash, observations, scope: 'Общий viewer, три цели, темы, viewport; не auth/API/прохождение' }, null, 2));
}
