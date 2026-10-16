import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Comparison } from './types.ts';
import { startComparison } from './server.ts';

export async function verifyViewer(target: Comparison) {
  const server = await startComparison(target);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'], executablePath: process.env.GF_CHROMIUM_PATH || undefined });
  const errors: string[] = [], checks: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url);
    const frame = (side: string) => page.frameLocator(`#${side} iframe`);
    await frame('after').locator('body').waitFor(); await frame('before').locator('body').waitFor();
    const initial = target.profiles[0]!;
    for (const side of ['before', 'after']) {
      const actual = await frame(side).locator('html').evaluate(() => [innerWidth, innerHeight]);
      if (actual[0] !== initial.width || actual[1] !== initial.height) throw new Error('Viewport iframe не совпал с выбранным');
    }
    checks.push('Одинаковый viewport обеих версий');
    for (const mode of ['before', 'after', 'both']) {
      await page.locator(`[data-mode="${mode}"]`).click();
      for (const side of ['before', 'after']) if (await page.locator('#' + side).isVisible() !== (mode === 'both' || mode === side)) throw new Error('Неверная видимость колонок');
    }
    checks.push('Переключение до / после / обе');
    await page.locator('#actual').check();
    const fixed = await frame('after').locator('html').evaluate(() => [innerWidth, innerHeight]);
    if (fixed[0] !== initial.width || fixed[1] !== initial.height) throw new Error('Масштаб изменил viewport');
    checks.push('100% меняет только предпросмотр');
    await frame('before').locator('html').evaluate(() => localStorage.setItem('gf-ui-origin-check', 'before'));
    if (await frame('after').locator('html').evaluate(() => localStorage.getItem('gf-ui-origin-check')) !== null) throw new Error('Версии разделяют localStorage');
    checks.push('Разные origins и localStorage');
    mkdirSync(join(target.out, 'viewer'), { recursive: true });
    await page.locator('#actual').uncheck();
    await page.screenshot({ path: join(target.out, 'viewer', 'compare.png') });
    if (errors.length) throw new Error(errors.join('\n'));
    writeFileSync(join(target.out, 'viewer-report.json'), JSON.stringify({ complete: true, failed: 0, checks, scope: 'Просмотрщик, не прохождение игры и не вход/API' }, null, 2));
    console.log(`${target.id}: просмотрщик — ${checks.length} проверок прошли`);
  } catch (error) {
    writeFileSync(join(target.out, 'viewer-report.json'), JSON.stringify({ complete: false, failed: 1, checks, error: String(error) }, null, 2));
    throw error;
  } finally { await browser.close(); await server.close(); }
}
