import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { OUT as SNAPSHOTS, startHubComparison, hubEvidence } from './preview.ts';
import { treeHash } from '../../core/evidence.ts';
import { HUB_SCENES } from './config.ts';

const OUT = join(SNAPSHOTS, 'live');
const servers = await startHubComparison();
mkdirSync(OUT, { recursive: true });
const evidence = hubEvidence('live.ts');
const artifact = treeHash(join(SNAPSHOTS, 'after'));
const browser = await chromium.launch();
const observations: unknown[] = [];
let complete = false;
let failed = 0;
const runnerHash = createHash('sha256').update(readFileSync(new URL('./live.ts', import.meta.url))).digest('hex');
try {
  for (const theme of ['dark', 'light'] as const) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: theme });
    await page.goto(servers.after + '/?scene=game');
    await page.locator('html[data-hub-ui-ready="game"]').waitFor();
    await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
    await page.getByTestId('exit-fullscreen').waitFor();
    const geometry = await page.evaluate(() => {
      const iframe = document.getElementById('game')!, parent = iframe.parentElement!;
      const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, top: r.top }; };
      return { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, iframe: rect(iframe), parent: rect(parent),
        iframeClass: iframe.className, parentClass: parent.className, gutter: getComputedStyle(document.documentElement).scrollbarGutter };
    });
    observations.push({ theme, geometry });
    if (geometry.iframe.width !== geometry.width || geometry.iframe.height !== geometry.height) failed++;
    console.log(JSON.stringify({ theme, geometry }));
    await page.screenshot({ path: join(OUT, theme + '-fullscreen.png') });
    await page.getByTestId('exit-fullscreen').click();
    await page.close();
  }
  for (const theme of ['dark', 'light'] as const) {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, colorScheme: theme });
    const page = await context.newPage();
    for (const scene of HUB_SCENES) {
      await page.goto(`${servers.after}/?scene=${scene.id}`);
      await page.locator(`html[data-hub-ui-ready="${scene.id}"]`).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(180);
      const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, coarse: matchMedia('(pointer: coarse)').matches,
        targets: [...document.querySelectorAll<HTMLElement>('button,a,input')].filter(e => e.checkVisibility()).map(e => {
          const r = e.getBoundingClientRect(); return { name: e.getAttribute('aria-label') || e.textContent?.trim(), width: r.width, height: r.height };
        }) }));
      if (!geometry.coarse || geometry.targets.some(e => e.width < 47.5 || e.height < 47.5)) failed++;
      const screenshot = `touch-landscape-${theme}-${scene.id}.png`;
      await page.screenshot({ path: join(OUT, screenshot), fullPage: false, animations: 'disabled' });
      observations.push({ theme, scene: scene.id, geometry, screenshot });
    }
    await page.emulateMedia({ forcedColors: 'active' });
    const scrollbar = await page.evaluate(() => ({ thumb: getComputedStyle(document.documentElement, '::-webkit-scrollbar-thumb').backgroundColor,
      track: getComputedStyle(document.documentElement, '::-webkit-scrollbar-track').backgroundColor, forced: matchMedia('(forced-colors: active)').matches }));
    if (!scrollbar.forced || scrollbar.thumb === scrollbar.track) failed++;
    observations.push({ theme, forcedColors: scrollbar });
    await context.close();
  }
  if (treeHash(join(SNAPSHOTS, 'after')) !== artifact) throw new Error('Сборка поменялась во время проверки');
  if (JSON.stringify(evidence) !== JSON.stringify(hubEvidence('live.ts'))) throw new Error('Сборка или инструмент сменились во время live');
  complete = true;
} finally {
  await browser.close(); await servers.close();
  const report = { complete, failed, ...evidence, artifact, runnerHash, observations, scope: 'UI-образцы: fullscreen, viewport-снимки landscape и forced-colors; не auth/bridge' };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(SNAPSHOTS, 'live-report.json'), JSON.stringify(report, null, 2));
}
process.exitCode = failed ? 1 : 0;
