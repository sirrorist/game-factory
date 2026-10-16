import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildSnapshot, OUT } from './snapshot.ts';
import { startComparison } from './server.ts';
import { gameEvidence } from './evidence.ts';

// Проверяем сам просмотрщик и воспроизводимость снимков независимо от матрицы раскладок.
const evidence = gameEvidence('smoke.ts');
writeFileSync(join(OUT, 'tool-smoke.json'), JSON.stringify({ status: 'running', complete: false, ...evidence }));
const comparison = await startComparison();
let browser;
const verified: string[] = [];
try {
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'], executablePath: process.env.GF_CHROMIUM_PATH || undefined });
  assert.throws(() => buildSnapshot('before', 'HEAD'), /База уже существует/);
  verified.push('Существующая база не перезаписывается');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.goto(comparison.url);
  const afterFrame = () => page.frameLocator('#after iframe');
  await afterFrame().locator('html[data-ui-ready="hud"]').waitFor();
  assert.deepEqual(await afterFrame().locator('html').evaluate(() => [innerWidth, innerHeight]), [390, 844]);
  assert.equal(await afterFrame().locator('#touch').isVisible(), true);
  assert.ok(await afterFrame().locator('#btn-menu').evaluate(e => e.getBoundingClientRect().height) >= 48);
  verified.push('Мобильный iframe: 390×844, тач-вид, кнопки 48 px');
  await page.locator('[data-mode="after"]').click();
  assert.equal(await page.locator('#before').isVisible(), false);
  assert.equal(await page.locator('#after').isVisible(), true);
  await page.locator('[data-mode="before"]').click();
  assert.equal(await page.locator('#after').isVisible(), false);
  await page.locator('[data-mode="both"]').click();
  assert.equal(await page.locator('#after').isVisible(), true);
  verified.push('До, после и обе: переключение видимости работает');
  await page.locator('#profile').selectOption('qhd');
  await afterFrame().locator('html[data-ui-ready="hud"]').waitFor();
  assert.deepEqual(await afterFrame().locator('html').evaluate(() => [innerWidth, innerHeight]), [2560, 1440]);
  await page.locator('#actual').check();
  assert.deepEqual(await afterFrame().locator('html').evaluate(() => [innerWidth, innerHeight]), [2560, 1440]);
  verified.push('QHD и масштаб 100% не изменяют viewport iframe');
  await page.locator('#content').selectOption('shots');
  await afterFrame().locator('img').waitFor();
  await afterFrame().locator('img').evaluate(async img => { await (img as HTMLImageElement).decode(); });
  assert.equal(await afterFrame().locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth), 2560);
  verified.push('Снимки загружаются в обоих iframe');
  // Повторное открытие тех же редких сцен должно давать абсолютно одинаковый UI.
  const checkPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const scene of ['hud-rich', 'wallet-result', 'debug']) {
    const images: Buffer[] = [];
    for (let n = 0; n < 2; n++) {
      await checkPage.goto(`${comparison.after}/?scene=${scene}&touch=1`);
      await checkPage.locator(`html[data-ui-ready="${scene}"]`).waitFor({ timeout: 15000 });
      await checkPage.addStyleTag({ content: 'canvas{visibility:hidden!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      images.push(await checkPage.screenshot({ animations: 'disabled' }));
    }
    assert.deepEqual(images[0], images[1], `Сценарий ${scene} не воспроизводится`);
    verified.push(`Повторный ${scene}: снимки UI совпадают побайтно`);
  }
  if (process.env.SW_UI_OFFLINE) {
    const html = readFileSync(process.env.SW_UI_OFFLINE, 'utf8');
    assert.ok(!html.includes('__SW_UI__') && !html.includes('uiCryptoSeed'), 'Тестовый хук попал в обычную сборку');
    const offline = await browser.newPage();
    const offlineErrors: string[] = [];
    offline.on('pageerror', error => offlineErrors.push(error.message));
    offline.on('console', message => { if (message.type() === 'error') offlineErrors.push(message.text()); });
    await offline.goto(pathToFileURL(process.env.SW_UI_OFFLINE).href);
    await offline.locator('html[data-gf-ready]').waitFor({ timeout: 15000 });
    await offline.locator('#btn-menu').click();
    await offline.locator('#menu').waitFor({ state: 'visible' });
    assert.deepEqual(offlineErrors, []);
    verified.push('Обычная сборка: без тестовых хуков, file:// ready и меню, ошибок нет');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(gameEvidence('smoke.ts'), evidence, 'Сборка или инструмент поменялись во время проверки');
  writeFileSync(join(OUT, 'tool-smoke.json'), JSON.stringify({ status: 'passed', complete: true, ...evidence, generatedAt: new Date().toISOString(), offline: process.env.SW_UI_OFFLINE ?? null, verified }, null, 2));
  console.log(verified.join('\n'));
} catch (error) {
  writeFileSync(join(OUT, 'tool-smoke.json'), JSON.stringify({ status: 'failed', verified, error: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); await comparison.close(); }
