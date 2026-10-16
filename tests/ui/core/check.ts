import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { gameComparison, gameEvidence } from './game.ts';
import { startComparison } from './server.ts';
import { pixelDifference } from './diff.ts';

// Универсальная проверка стартового экрана. Редкие игровые состояния — в адаптерах.
export async function checkGame(id: string): Promise<number> {
  const target = gameComparison(id), evidence = gameEvidence(id);
  const selected = process.env.GF_UI_PROFILES?.split(',');
  const profiles = selected ? target.profiles.filter(p => selected.includes(p.id)) : target.profiles;
  if (!profiles.length) throw new Error('Неизвестные GF_UI_PROFILES');
  const servers = await startComparison(target);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'], executablePath: process.env.GF_CHROMIUM_PATH || undefined });
  const results: { side: string; profile: string; scene: string; errors: string[]; screenshot: string; uiScreenshot: string }[] = [];
  const differences: { profile: string; scene: string; changedPercent: number; image: string }[] = [];
  let finished = false;
  try {
    for (const p of profiles) for (const side of ['before', 'after'] as const) {
      const context = await browser.newContext({ viewport: { width: p.width, height: p.height }, hasTouch: p.touch, isMobile: p.touch, deviceScaleFactor: 1 });
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
      try {
        await page.goto(servers[side]);
        await page.locator('html[data-gf-ready]').waitFor({ timeout: 15000 });
        await page.evaluate(() => document.fonts.ready);
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1)) errors.push('Игровое поле выходит за экран');
        const directory = join(target.out, 'shots', side, p.id); mkdirSync(directory, { recursive: true });
        const screenshot = `shots/${side}/${p.id}/start.png`, uiScreenshot = `shots/${side}/${p.id}/start-ui.png`;
        await page.screenshot({ path: join(target.out, screenshot) });
        await page.addStyleTag({ content: 'canvas{visibility:hidden!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
        await page.screenshot({ path: join(target.out, uiScreenshot) });
        results.push({ side, profile: p.id, scene: 'start', errors, screenshot, uiScreenshot });
      } catch (error) { results.push({ side, profile: p.id, scene: 'start', errors: [...errors, String(error)], screenshot: '', uiScreenshot: '' }); }
      finally { await context.close(); }
    }
    const diffPage = await browser.newPage(); await diffPage.goto(servers.url);
    for (const p of profiles) {
      if (results.some(r => r.profile === p.id && !r.uiScreenshot)) continue;
      const diff = await pixelDifference(diffPage, `${servers.url}/shots/before/${p.id}/start-ui.png`, `${servers.url}/shots/after/${p.id}/start-ui.png`);
      mkdirSync(join(target.out, 'diff', p.id), { recursive: true });
      const image = `diff/${p.id}/start.png`;
      writeFileSync(join(target.out, image), Buffer.from(diff.png, 'base64'));
      differences.push({ profile: p.id, scene: 'start', changedPercent: diff.changedPercent, image });
    }
    if (JSON.stringify(evidence) !== JSON.stringify(gameEvidence(id))) throw new Error('Сборка/инструмент изменились во время проверки');
    const failed = results.filter(r => r.side === 'after' && r.errors.length).length;
    writeFileSync(join(target.out, 'report.json'), JSON.stringify({ status: 'finished', complete: profiles.length === target.profiles.length, ...evidence, profiles, scenes: target.scenes, results, differences, failed,
      limitations: ['Только стартовый экран штатной сборки, без сценариев прохождения', 'Chromium с эмуляцией; пиксельные отличия не являются автоматическим одобрением вида'] }, null, 2));
    finished = true;
    console.log(`${id}: ${results.length} состояний, ${failed} ошибок after`);
    return failed ? 1 : 0;
  } finally {
    await browser.close(); await servers.close();
    if (!finished) writeFileSync(join(target.out, 'report.json'), JSON.stringify({ status: 'interrupted-or-failed', complete: false, failed: 1 }));
  }
}
