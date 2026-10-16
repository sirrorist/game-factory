// Дополнительные проверки интегрального масштаба, resize и тактической прокрутки.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { OUT as SNAPSHOTS } from './snapshot.ts';
import { gameEvidence } from './evidence.ts';
import { PROFILES } from './config.ts';
import { startComparison } from './server.ts';

const OUT = join(SNAPSHOTS, 'acceptance');
mkdirSync(OUT, { recursive: true });
const evidence = gameEvidence('acceptance.ts');
const checks: { profile: string; id: string; passed: boolean; actual: unknown }[] = [];
const comparison = await startComparison();
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
let complete = false;
try {
  for (const profile of [...PROFILES, { id: 'narrow-iframe', width: 350, height: 620, touch: true }]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height },
      screen: { width: profile.width + 200, height: profile.height + 200 }, hasTouch: profile.touch, isMobile: profile.touch });
    const page = await context.newPage();
    const check = (id: string, passed: boolean, actual: unknown) => checks.push({ profile: profile.id, id, passed, actual });
    try {
      await page.goto(comparison.after + '/?scene=pause-stats');
      await page.locator('html[data-ui-ready="pause-stats"]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const items = [...document.querySelectorAll<HTMLElement>('#menu .gf-stat-card')].filter(e => e.checkVisibility());
        const list = document.getElementById('menu-stats-grid')!;
        return { cards: items.length, height: list.clientHeight, scroll: list.scrollHeight,
          font: parseFloat(getComputedStyle(document.documentElement).fontSize) };
      });
      check('pause-stats-fit', geometry.scroll <= geometry.height + 1 && geometry.cards >= 2, geometry);
      check('rem-scale', Math.abs(geometry.font - 16 * Math.max(1, Math.min(profile.width / 1920, profile.height / 1080))) < .02, geometry.font);
      await page.screenshot({ path: join(OUT, profile.id + '-pause-stats.png'), animations: 'disabled' });
      if (!profile.touch) {
        await page.goto(comparison.after + '/?scene=dashboard');
        await page.locator('html[data-ui-ready="dashboard"]').waitFor();
        const scroll = await page.evaluate(() => {
          const grid = document.getElementById('tab-stats-grid')!, map = document.getElementById('tab-pane-map')!;
          const before = map.getBoundingClientRect();
          grid.scrollTop = grid.scrollHeight;
          const after = map.getBoundingClientRect();
          return { height: grid.clientHeight, scrollHeight: grid.scrollHeight, top: grid.scrollTop, mapMoved: Math.abs(before.y - after.y) + Math.abs(before.x - after.x) };
        });
        check('Tab-independent-scroll', scroll.top > 0 && scroll.mapMoved === 0, scroll);
      }
      await page.goto(comparison.after + '/?live=1');
      await page.locator('html[data-gf-ready]').waitFor();
      const fullscreen = page.locator('#btn-fs');
      if (await fullscreen.isVisible()) {
        await fullscreen.click();
        await page.waitForTimeout(200);
        const status = await page.evaluate(() => ({ active: document.fullscreenElement !== null, width: innerWidth, height: innerHeight,
          screen: [screen.width, screen.height], toast: document.getElementById('toast')?.textContent }));
        check('native-fullscreen', status.active, status);
        if (status.active) {
          await page.evaluate(() => document.exitFullscreen());
          await page.waitForFunction(() => document.fullscreenElement === null);
        }
      }
      const resized = { width: profile.touch ? profile.height : 2560, height: profile.touch ? profile.width : 1440 };
      await page.setViewportSize(resized);
      await page.waitForTimeout(100);
      const nextFont = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
      check('resize-rem', Math.abs(nextFont - 16 * Math.max(1, Math.min(resized.width / 1920, resized.height / 1080))) < .02, nextFont);

    } finally { await context.close(); }
    console.log(profile.id, checks.filter(c => c.profile === profile.id && !c.passed));
  }
  if (JSON.stringify(evidence) !== JSON.stringify(gameEvidence('acceptance.ts'))) throw new Error('Сборка или инструмент изменились');
  complete = true;
} finally {
  await browser.close(); await comparison.close();
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ complete, ...evidence, checks, failed: checks.filter(c => !c.passed).length }, null, 2));
}
process.exitCode = checks.some(c => !c.passed) ? 1 : 0;
