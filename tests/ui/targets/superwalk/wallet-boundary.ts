// R5: свежий запуск и resize без reload; касания без автоматической прокрутки.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { OUT as SNAPSHOTS } from './snapshot.ts';
import { startComparison } from './server.ts';
import { gameEvidence } from './evidence.ts';
import { inspectWalletLayout } from './wallet-layout.ts';

const label = process.env.GF_UI_LABEL ?? process.argv[2] ?? 'after';
const out = join(SNAPSHOTS, 'boundary', label);
mkdirSync(out, { recursive: true });
const evidence = gameEvidence('wallet-boundary.ts');
const servers = await startComparison();
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const runs: { scenario: string; phase: string; errors: string[]; geometry?: unknown }[] = [];
let complete = false;
const sizes = [
  [790, 339], [790, 340], [790, 341], [790, 350], [790, 360], [790, 379], [790, 380], [790, 381], [790, 390],
  [600, 290], [601, 290], [620, 290], [680, 290], [700, 290],
  [740, 290], [741, 290], [900, 380], [900, 381], [1024, 480], [1024, 481], [1024, 520], [1024, 521],
] as const;
async function observe(page: Page, scenario: string, phase: string, screenshot = false) {
  const geometry = await page.evaluate(inspectWalletLayout);
  runs.push({ scenario, phase, errors: geometry.errors, geometry });
  if (screenshot) await page.screenshot({ path: join(out, `${scenario}-${phase}.png`) });
}
async function tap(page: Page, selector: string) {
  const target = await page.locator(selector).boundingBox();
  if (!target || target.x < 0 || target.y < 0 || target.x + target.width > page.viewportSize()!.width || target.y + target.height > page.viewportSize()!.height) throw new Error(`${selector}: кнопка вне экрана`);
  const hit = await page.locator(selector).evaluate(e => {
    const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === e || !!hit && e.contains(hit);
  });
  if (!hit) throw new Error(`${selector}: центр кнопки недоступен касанием`);
  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
}
async function tabs(page: Page, scenario: string, shots = false) {
  for (const tab of ['slots', 'cases', 'skins', 'withdraw']) {
    try {
      await tap(page, '#wtab-btn-' + tab);
      await page.waitForTimeout(250); // Штатная CSS-анимация появления.
      if (!await page.locator('#wtab-btn-' + tab).evaluate(e => e.classList.contains('gf-wtab-btn--active'))) throw new Error(`Касание не переключило ${tab}`);
      await observe(page, scenario, tab, shots);
    } catch (error) { runs.push({ scenario, phase: tab, errors: [String(error)] }); }
  }
}
try {
  // Оба подтверждённых размера — свежая форма, ошибка, настоящая операция и чек.
  for (const [width, height] of [[790, 341], [600, 290]] as const) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    const scenario = `fresh-${width}x${height}`;
    try {
      await page.goto(servers.after + '/?live=1');
      await page.waitForFunction(() => !!(globalThis as typeof globalThis & { __SW_UI__?: unknown }).__SW_UI__);
      await page.evaluate(() => document.fonts.ready);
      await tap(page, '#btn-wallet'); await page.waitForTimeout(250);
      await tabs(page, scenario, true);
      await page.locator('#input-withdraw-amount').fill('1000001');
      await observe(page, scenario, 'error', true);
      await page.locator('#input-withdraw-amount').fill('10');
      await tap(page, '#btn-exec-withdraw');
      await observe(page, scenario, 'progress', true);
      await page.locator('#withdraw-receipt-card').waitFor({ state: 'visible' });
      await observe(page, scenario, 'receipt', true);
      await tap(page, '#btn-wallet-close');
      runs.push({ scenario, phase: 'close', errors: await page.locator('#wallet-modal').isHidden() ? [] : ['Кошелёк не закрылся касанием'] });
    } catch (error) { runs.push({ scenario, phase: 'operation', errors: [String(error)] }); }
    finally { await context.close(); }
  }
  // Один экземпляр приложения, последовательное изменение viewport в обе стороны.
  const context = await browser.newContext({ viewport: { width: 790, height: 340 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  try {
    await page.goto(servers.after + '/?live=1');
    await page.waitForFunction(() => !!(globalThis as typeof globalThis & { __SW_UI__?: unknown }).__SW_UI__);
    await page.evaluate(() => document.fonts.ready);
    await tap(page, '#btn-wallet');
    for (const [width, height] of [...sizes, ...sizes.toReversed()]) {
      const scenario = `resize-${width}x${height}-${runs.length}`;
      await page.setViewportSize({ width, height }); await page.waitForTimeout(150);
      await tabs(page, scenario);
    }
  } catch (error) { runs.push({ scenario: 'resize', phase: 'scenario', errors: [String(error)] }); }
  finally { await context.close(); }
  if (JSON.stringify(evidence) !== JSON.stringify(gameEvidence('wallet-boundary.ts'))) throw new Error('Входы проверки изменились');
  complete = true;
} finally {
  await browser.close(); await servers.close();
  const failed = runs.filter(r => r.errors.length).length;
  writeFileSync(join(out, 'report.json'), JSON.stringify({ complete, ...evidence, sizes, runs, failed, scope: 'Живые часы/RNG/rAF, касания координатами; resize без reload в обе стороны' }, null, 2));
  console.log(`${label}: ${runs.length} состояний, ${failed} с ошибками`);
}
process.exitCode = !complete || runs.some(r => r.errors.length) ? 1 : 0;
