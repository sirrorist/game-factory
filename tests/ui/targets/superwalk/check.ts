import { pixelDifference } from '../../core/diff.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { OUT } from './snapshot.ts';
import { PROFILES, SCENES } from './config.ts';
import { startComparison } from './server.ts';
import { gameEvidence } from './evidence.ts';
import { inspectWalletLayout } from './wallet-layout.ts';
import { trackCheck } from '../../core/report.ts';

interface Result { side: string; profile: string; scene: string; errors: string[]; controls: string[]; screenshot: string; uiScreenshot: string }

async function layout(page: Page, root: string, touch: boolean): Promise<{ errors: string[]; controls: string[] }> {
  return page.evaluate(({ root, touch }) => {
    const errors: string[] = [];
    const scope = document.querySelector<HTMLElement>(root);
    if (!scope || !scope.checkVisibility()) return { errors: [`Не появился ${root}`], controls: [] };
    const bounds = scope.getBoundingClientRect();
    if (bounds.left < -1 || bounds.top < -1 || bounds.right > innerWidth + 1 || bounds.bottom > innerHeight + 1) errors.push(`${root} выходит за экран: ${Math.round(bounds.width)}×${Math.round(bounds.height)} @ ${Math.round(bounds.left)},${Math.round(bounds.top)}`);
    if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) errors.push('Прокручивается всё игровое поле');
    const controls = [...scope.querySelectorAll<HTMLElement>('button,input,[role="button"]')].filter(e => e.checkVisibility());
    for (const e of controls) {
      const box = e.getBoundingClientRect();
      const name = e.id || e.textContent?.trim().slice(0, 35) || e.tagName;
      if (touch && (box.width < 47.5 || box.height < 47.5)) errors.push(`Цель касания ${name}: ${Math.round(box.width)}×${Math.round(box.height)} < 48`);
      if (box.width <= 0 || box.height <= 0) errors.push(`Пустая кнопка ${name}`);
      // Внутренняя вертикальная прокрутка разрешена, горизонтальная обрезка — ошибка.
      let parent = e.parentElement;
      let scrollsY = false;
      while (parent) {
        const style = getComputedStyle(parent);
        const p = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && (box.left < p.left - 1 || box.right > p.right + 1)) errors.push(`${name} обрезан по ширине в ${parent.id || parent.className}`);
        if (!scrollsY && ['hidden', 'clip'].includes(style.overflowY) && (box.top < p.top - 1 || box.bottom > p.bottom + 1)) errors.push(`${name} обрезан по высоте в ${parent.id || parent.className}`);
        if (['auto', 'scroll'].includes(style.overflowY) && parent.scrollHeight > parent.clientHeight) scrollsY = true;
        parent = parent.parentElement;
      }
    }
    for (const text of scope.querySelectorAll<HTMLElement>('.gf-card__title,.gf-card__desc,.gf-card__level')) {
      const card = text.closest('.gf-card');
      if (!card) continue;
      const a = text.getBoundingClientRect(), b = card.getBoundingClientRect();
      if (a.top < b.top - 1 || a.bottom > b.bottom + 1) errors.push(`Текст улучшения выходит из карточки: ${text.textContent?.trim()}`);
    }
    if (root === '#menu .gf-panel') {
      const cols = [...scope.querySelectorAll<HTMLElement>('.gf-menu-col')].map(el => el.getBoundingClientRect());
      if (cols.length === 2 && Math.min(cols[0]!.right, cols[1]!.right) > Math.max(cols[0]!.left, cols[1]!.left) + 1 && Math.min(cols[0]!.bottom, cols[1]!.bottom) > Math.max(cols[0]!.top, cols[1]!.top) + 1) errors.push('Снаряжение перекрывает характеристики меню');
      for (const col of scope.querySelectorAll<HTMLElement>('.gf-menu-col')) {
        if (!col.checkVisibility()) continue;
        const a = col.getBoundingClientRect();
        for (const child of col.querySelectorAll<HTMLElement>('.gf-item-row,.gf-stat-card')) {
          if (!child.checkVisibility()) continue;
          const b = child.getBoundingClientRect();
          if (b.top < a.top - 1 || b.bottom > a.bottom + 1) errors.push('Содержимое обзора выходит из своей секции');
        }
      }
    }
    if (root === '.gf-panel--gameover') {
      for (const selector of ['#toast', '#item-card-popup']) {
        const feedback = document.querySelector<HTMLElement>(selector);
        if (!feedback?.checkVisibility()) continue;
        const a = feedback.getBoundingClientRect();
        if (Math.min(bounds.right, a.right) > Math.max(bounds.left, a.left) + 1 && Math.min(bounds.bottom, a.bottom) > Math.max(bounds.top, a.top) + 1) errors.push(`Уведомление ${selector} перекрывает итоги забега`);
      }
    }
    if (['#app', '#toast', '#debug', '#item-card-popup'].includes(root)) {
      const blocked = ['#corner', '#btn-jump', '.gf-hud-left-group', '#toast', '#item-card-popup', '#debug', '#boss-hud'];
      for (const selector of ['.gf-hud-left-group', '#boss-hud', '#debug', '#toast', '#item-card-popup']) {
        const e = document.querySelector<HTMLElement>(selector);
        if (!e?.checkVisibility()) continue;
        const b = e.getBoundingClientRect();
        for (const target of blocked) {
          if (target === selector) continue;
          const other = document.querySelector<HTMLElement>(target);
          if (!other?.checkVisibility()) continue;
          const a = other.getBoundingClientRect();
          if (Math.min(b.right, a.right) > Math.max(b.left, a.left) + 1 && Math.min(b.bottom, a.bottom) > Math.max(b.top, a.top) + 1) errors.push(`${selector} перекрывает ${target}`);
        }
      }
    }
    return { errors: [...new Set(errors)], controls: controls.map(e => e.id || e.textContent?.trim().slice(0, 35) || e.tagName) };
  }, { root, touch });
}

async function reachable(page: Page, root: string): Promise<string[]> {
  const errors: string[] = [];
  const controls = page.locator(`${root} button,${root} input,${root} [role="button"]`);
  for (const e of await controls.all()) {
    if (!await e.isVisible() || !await e.isEnabled()) continue;
    if (root !== '.gf-wallet-panel') await e.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    const result = await e.evaluate(element => {
      const b = element.getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { name: element.id || element.textContent?.trim().slice(0, 35), ok: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && !!hit && (element.contains(hit) || hit === element) };
    });
    if (!result.ok) errors.push(`Кнопка недостижима или перекрыта: ${result.name}`);
  }
  return errors;
}

async function flowChecks(page: Page, url: string, touch: boolean): Promise<string[]> {
  const failures: string[] = [];
  const activate = async (selector: string) => { const control = page.locator(selector); if (touch) { await control.scrollIntoViewIfNeeded(); await control.tap(); } else await control.click(); };
  const check = async (name: string, action: () => Promise<void>) => { try { await action(); } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message.split('\n')[0] : e}`); } };
  await check('Закрытие паузы', async () => {
    await page.goto(url + '/?scene=pause');
    await page.waitForSelector('html[data-ui-ready="pause"]');
    await activate('#btn-resume');
    await page.locator('#menu').waitFor({ state: 'hidden' });
  });
  await check('Слоты: кнопка восстанавливается после анимации', async () => {
    await page.goto(url + '/?scene=wallet-slots');
    await page.waitForSelector('html[data-ui-ready="wallet-slots"]');
    await activate('#btn-slot-spin');
    if (!await page.locator('#btn-slot-spin').isDisabled()) throw new Error('Повторная ставка не заблокирована');
    await page.waitForFunction(() => !(document.getElementById('btn-slot-spin') as HTMLButtonElement).disabled, undefined, { timeout: 5000, polling: 100 });
  });
  await check('Кейс: результат и надевание скина', async () => {
    await page.goto(url + '/?scene=wallet-cases');
    await page.waitForSelector('html[data-ui-ready="wallet-cases"]');
    await activate('#btn-open-case');
    await page.locator('#case-result-display').waitFor({ state: 'visible', timeout: 6000 });
    await activate('#btn-case-equip');
    const equipped = await page.evaluate(() => (globalThis as unknown as { __SW_UI__: { walletManager: { getEquippedSkin(): unknown } } }).__SW_UI__.walletManager.getEquippedSkin());
    if (!equipped) throw new Error('Клик не изменил экипированный скин');
    await activate('#wtab-btn-skins');
    if (!await page.locator('.gf-skin-card--equipped').count()) throw new Error('В гардеробе не показан надетый скин');
  });
  await check('Вывод: чек и возврат к форме', async () => {
    await page.goto(url + '/?scene=wallet-withdraw');
    await page.waitForSelector('html[data-ui-ready="wallet-withdraw"]');
    await activate('#btn-exec-withdraw');
    await page.locator('#withdraw-receipt-card').waitFor({ state: 'visible', timeout: 5000 });
    await activate('#btn-receipt-new');
    await page.locator('#withdraw-form-card').waitFor({ state: 'visible' });
  });
  await check('Кошелёк изолирует клавиатурные окна', async () => {
    await page.goto(url + '/?scene=wallet-withdraw');
    await page.waitForSelector('html[data-ui-ready="wallet-withdraw"]');
    await page.locator('#input-withdraw-amount').fill('25');
    await page.keyboard.press('Tab');
    if (await page.locator('#tab-modal').isVisible()) throw new Error('Tab открыл карту за кошельком');
    await page.keyboard.press('Escape');
    if (await page.locator('#menu').isVisible()) throw new Error('Escape открыл паузу за кошельком');
    await page.locator('#wallet-modal').waitFor({ state: 'hidden' });
  });
  return failures;
}

export async function runChecks(): Promise<number> {
  const evidence = gameEvidence('check.ts');
  let servers: Awaited<ReturnType<typeof startComparison>> | undefined;
  let browser;
  const results: Result[] = [];
  const differences: { profile: string; scene: string; changedPercent: number; image: string }[] = [];
  const flows: Record<string, string[]> = {};
  const selected = (process.env.GF_UI_PROFILES ?? process.env.SW_UI_PROFILES)?.split(',');
  const profiles = selected ? PROFILES.filter(p => selected.includes(p.id)) : PROFILES;
  const failed = () => results.filter(r => r.side === 'after' && r.errors.length).length + Object.entries(flows).filter(([key, errors]) => key.startsWith('after/') && errors.length).length;
  const report = trackCheck(join(OUT, 'report.json'), () => ({ generatedAt: new Date().toISOString(), complete: profiles.length === PROFILES.length,
    ...evidence, profiles, scenes: SCENES, results, flows, differences, failed: failed(),
    limitations: ['Chromium с эмуляцией касаний, не физическое устройство', 'Пиксельные отличия информируют о смене вида; оценка намеренных изменений — владельцем и проверяющим агентом', 'Состояния через временную инструментализацию; штатные действия дополнительно проверены сценариями flows'] }));
  try {
    if (!profiles.length) throw new Error('SW_UI_PROFILES не содержит известных профилей');
    servers = await startComparison();
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'], executablePath: process.env.GF_CHROMIUM_PATH || undefined });
    for (const profile of profiles) {
      for (const side of ['before', 'after'] as const) {
        const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await context.addInitScript(() => { try { localStorage.clear(); } catch {} });
        page.setDefaultTimeout(6000);
        page.on('dialog', dialog => void dialog.accept());
        let runtime: string[] = [];
        let active: Result | undefined;
        const runtimeError = (message: string) => { runtime.push(message); active?.errors.push(message); };
        page.on('pageerror', error => runtimeError(error.message));
        page.on('console', message => { if (message.type() === 'error') runtimeError(message.text()); });
        const directory = join(OUT, 'shots', side, profile.id);
        mkdirSync(directory, { recursive: true });
        for (const scene of SCENES) {
          runtime = [];
          const errors: string[] = [];
          const result: Result = { side, profile: profile.id, scene: scene.id, errors, controls: [], screenshot: '', uiScreenshot: '' };
          active = result;
          results.push(result); report.checkpoint();
          // Каждая сцена с исходным состоянием, без сохранений предыдущего сценария.
          await page.goto(`${servers[side]}/?scene=${scene.id}&touch=${Number(profile.touch)}`);
          await page.waitForSelector(`html[data-ui-ready="${scene.id}"]`, { timeout: 15000 }).catch(() => errors.push('Сценарий не готов'));
          // Геометрию снимаем после CSS-анимаций: scale(0.96) давал ложные размеры кнопок.
          await page.evaluate(() => { for (const a of document.getAnimations()) { if (a.effect?.getComputedTiming().iterations === Infinity) a.cancel(); else a.finish(); } });
          if (!await page.locator('html[data-gf-ready]').count()) errors.push('SDK ready() не вызван');
          const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
          if (coarse !== profile.touch) errors.push('Режим ввода не совпал с профилем');
          if (await page.locator('html').getAttribute('data-ui-touch') !== String(profile.touch)) errors.push('Штатный контроллер не определил режим ввода');
          const geometry = await layout(page, scene.root, profile.touch);
          result.controls = geometry.controls;
          errors.push(...geometry.errors);
          if (scene.root === '.gf-wallet-panel') errors.push(...(await page.evaluate(inspectWalletLayout)).errors);
          const expected: Record<string, string> = { 'wallet-result': '#case-result-display', 'wallet-receipt': '#withdraw-receipt-card' };
          if (expected[scene.id] && !await page.locator(expected[scene.id]!).isVisible()) errors.push(`Не появился ${expected[scene.id]}`);
          const screenshot = `shots/${side}/${profile.id}/${scene.id}.png`;
          const uiScreenshot = `shots/${side}/${profile.id}/${scene.id}-ui.png`;
          await page.screenshot({ path: join(OUT, screenshot), animations: 'disabled' });
          result.screenshot = screenshot; report.checkpoint();
          const style = await page.addStyleTag({ content: 'canvas { visibility:hidden!important } *,*::before,*::after { animation:none!important;transition:none!important;caret-color:transparent!important }' });
          await page.screenshot({ path: join(OUT, uiScreenshot), animations: 'disabled' });
          result.uiScreenshot = uiScreenshot; report.checkpoint();
          await style.evaluate(e => e.parentNode?.removeChild(e));
          errors.push(...await reachable(page, scene.root), ...runtime);
          result.errors = [...new Set(errors)]; report.checkpoint();
        }
        if (profile.id === 'phone-portrait' || profile.id === 'fullhd') {
          active = undefined;
          runtime = [];
          flows[`${side}/${profile.id}`] = [...await flowChecks(page, servers[side], profile.touch), ...runtime];
          report.checkpoint();
        }
        await context.close();
        const group = results.filter(r => r.side === side && r.profile === profile.id);
        console.log(`${side} ${profile.id}: ${group.length} экранов, ${group.reduce((n, r) => n + r.errors.length, 0)} нарушений`);
      }
    }
    const diffPage = await browser.newPage();
    await diffPage.goto(servers.url);
    for (const profile of profiles) for (const scene of SCENES) {
      const diff = await pixelDifference(diffPage, `${servers.url}/shots/before/${profile.id}/${scene.id}-ui.png`, `${servers.url}/shots/after/${profile.id}/${scene.id}-ui.png`);
      const image = `diff/${profile.id}/${scene.id}.png`;
      mkdirSync(join(OUT, 'diff', profile.id), { recursive: true });
      writeFileSync(join(OUT, image), Buffer.from(diff.png, 'base64'));
      differences.push({ profile: profile.id, scene: scene.id, changedPercent: Number(diff.changedPercent.toFixed(3)), image });
      report.checkpoint();
    }
    if (JSON.stringify(evidence) !== JSON.stringify(gameEvidence('check.ts'))) throw new Error('Сборка или инструмент поменялись во время проверки');
    report.finish();
    console.log(`UI ${profiles.length === PROFILES.length ? 'полный' : 'ЧАСТИЧНЫЙ'}: ${failed() ? 'НЕ ПРОШЛО' : 'ПРОШЛО'} · ${results.length} снимков · ${OUT}/report.json`);
    return failed() ? 1 : 0;
  } catch (error) {
    report.fail(error); throw error;
  } finally {
    report.close();
    try { await browser?.close(); } finally { await servers?.close(); }
  }
}
