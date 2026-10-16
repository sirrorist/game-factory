// Адресные регрессии R1–R4: обычные часы/анимации, состояние снимается до scrollIntoView.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PROFILES } from './config.ts';
import { OUT as SNAPSHOTS, buildSnapshot } from './snapshot.ts';
import { startComparison } from './server.ts';
import { gameEvidence } from './evidence.ts';
import { inspectWalletLayout } from './wallet-layout.ts';

const label = process.env.GF_UI_LABEL ?? process.argv[2] ?? 'after';
const OUT = join(SNAPSHOTS, 'wallet-review', label);
mkdirSync(OUT, { recursive: true });
if (process.argv.includes('--build')) console.log('Проверяем:', buildSnapshot('after'));
const evidence = gameEvidence('wallet-review.ts');
const servers = await startComparison();
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const runs: { profile: string; phase: string; errors: string[]; geometry?: unknown }[] = [];
let complete = false;
try {
  const profiles = [...PROFILES, { id: 'iframe-narrow', width: 350, height: 620, touch: true }, { id: 'iframe-low', width: 790, height: 290, touch: true }];
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const observe = async (phase: string) => {
      const geometry = await page.evaluate(inspectWalletLayout);
      runs.push({ profile: profile.id, phase, errors: geometry.errors, geometry });
      if (['iframe-narrow', 'iframe-low', 'phone-portrait'].includes(profile.id)) await page.screenshot({ path: join(OUT, `${profile.id}-${phase}.png`) });
    };
    try {
      await page.goto(servers.after + '/?live=1');
      await page.waitForFunction(() => !!(globalThis as typeof globalThis & { __SW_UI__?: unknown }).__SW_UI__);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('#btn-wallet').click();
      await page.locator('#wtab-btn-withdraw').click();
      await page.waitForTimeout(250);
      await observe('form');
      await page.locator('#input-withdraw-amount').fill('1000001');
      await observe('error');
      await page.locator('#input-withdraw-amount').fill('10');
      await page.locator('#btn-exec-withdraw').click();
      await observe('progress');
      await page.waitForTimeout(700);
      await observe('progress-signing');
      await page.locator('#withdraw-receipt-card').waitFor({ state: 'visible' });
      await observe('receipt');
      // Tap по координатам не умеет программно возвращать скрытый крестик.
      const target = await page.locator('#btn-wallet-close').boundingBox();
      if (!target || target.y < 0 || target.y + target.height > profile.height) {
        runs.push({ profile: profile.id, phase: 'close', errors: ['Крестик вне экрана после вывода'] });
      } else {
        const x = target.x + target.width / 2, y = target.y + target.height / 2;
        if (profile.touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
        runs.push({ profile: profile.id, phase: 'close', errors: await page.locator('#wallet-modal').isHidden() ? [] : ['Кошелёк не закрылся касанием'] });
      }
      await page.goto(servers.after + '/?live=1');
      await page.waitForFunction(() => !!(globalThis as typeof globalThis & { __SW_UI__?: unknown }).__SW_UI__);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('#btn-wallet').click();
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        const app = (globalThis as typeof globalThis & { __SW_UI__: { walletManager: { getWalletState(): { balance: number } }; renderWalletMarketInfo(): void } }).__SW_UI__;
        // Только образец текста: не начисление, не доказательство легитимности суммы.
        app.walletManager.getWalletState().balance = 1000000;
        app.renderWalletMarketInfo();
      });
      await observe('million');
      await page.locator('#wtab-btn-cases').click();
      await observe('cases');
      await page.evaluate(() => {
        const app = (globalThis as typeof globalThis & { __SW_UI__: { walletManager: { unlockedSkinIds: Set<string> } } }).__SW_UI__;
        // Образец полной коллекции для раскладки, без имитации получения наград.
        app.walletManager.unlockedSkinIds = new Set(['skin_sock', 'skin_forest_camo', 'skin_neon_fox', 'skin_fade_tail']);
      });
      await page.locator('#wtab-btn-skins').click();
      await observe('skins');
    } catch (error) { runs.push({ profile: profile.id, phase: 'scenario', errors: [String(error)] }); }
    finally { await context.close(); }
    console.log(`${profile.id}: ${runs.filter(r => r.profile === profile.id).flatMap(r => r.errors).length} ошибок`);
  }
  if (JSON.stringify(gameEvidence('wallet-review.ts')) !== JSON.stringify(evidence)) throw new Error('Входы проверки изменились');
  complete = true;
} finally {
  await browser.close(); await servers.close();
  const failed = runs.filter(r => r.errors.length).length;
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ complete, ...evidence, runs, failed, scope: 'Нативные действия/таймеры; million — отдельный образец геометрии текста' }, null, 2));
}
process.exitCode = runs.some(r => r.errors.length) ? 1 : 0;
