// Адресные регрессии настоящих компонентов с UI-образцами. Не проверка auth или физического телефона.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { catalogGeometry } from '../../../e2e/hub-ui.ts';

if (process.argv[2]) process.env.GF_UI_RUN = process.argv[2];
const { OUT, startHubComparison, hubEvidence } = await import('./preview.ts');
const { treeHash } = await import('../../core/evidence.ts');
const directory = join(OUT, 'regressions');
if (existsSync(directory)) { const history = join(OUT, 'history'); mkdirSync(history, { recursive: true }); renameSync(directory, join(mkdtempSync(join(history, 'regressions-')), 'regressions')); }
mkdirSync(directory, { recursive: true });
const runnerHash = createHash('sha256').update(readFileSync(new URL(import.meta.url))).update(readFileSync(new URL('../../../e2e/hub-ui.ts', import.meta.url))).digest('hex');
const results: { name: string; error?: string; evidence?: unknown }[] = [];
const snapshot = hubEvidence('regressions.ts'), artifact = treeHash(join(OUT, 'after'));
let complete = false;
const checkpoint = () => writeFileSync(join(directory, 'report.json'), JSON.stringify({ complete, failed: results.filter(r => r.error).length, ...snapshot, artifact, runnerHash, results }, null, 2));
checkpoint();
const servers = await startHubComparison();
const browser = await chromium.launch();
async function check(name: string, run: () => Promise<unknown>) {
  try { results.push({ name, evidence: await run() }); }
  catch (error) { results.push({ name, error: String(error) }); console.error(name, String(error)); }
  checkpoint();
}
async function open(page: Page, scene = 'catalog') {
  await page.goto(`${servers.after}/?scene=${scene}`);
  await page.locator(`html[data-hub-ui-ready="${scene}"]`).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(80);
}
async function geometry(page: Page) { return page.evaluate(catalogGeometry); }

/** Управляемый серединный кадр настоящих CSS keyframes: без гонки с wall-clock под нагрузкой. */
async function holdMotion(page: Page, selector: string, phase: 'opening' | 'closing') {
  await page.evaluate(({selector, phase}) => {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      const observer = new MutationObserver(() => {
        if (node.dataset.state !== phase) return;
        observer.disconnect();
        void getComputedStyle(node).animationName;
        const animations = node.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity);
        const durations = animations.map(a => Number(a.effect?.getComputedTiming().duration));
        for (const [index, animation] of animations.entries()) { animation.pause(); animation.currentTime = durations[index]! / 2; }
        if (node instanceof HTMLDialogElement) {
          // Chromium не возвращает ::backdrop в dialog.getAnimations(); управляем теми же CSS keyframes через delay/play-state.
          const backdrop = getComputedStyle(node, '::backdrop');
          const duration = parseFloat(backdrop.animationDuration) * 1000;
          node.dataset.motionBackdrop = JSON.stringify({name:backdrop.animationName,duration});
          const style = document.createElement('style'); style.dataset.motionFor = node.id;
          const target = '#' + CSS.escape(node.id) + '[data-motion-sample="' + phase + '"]';
          style.textContent = target + '::backdrop {animation-play-state:paused!important;animation-delay:-' + duration / 2 + 'ms!important}' + target + '[data-motion-resumed]::backdrop {animation-play-state:running!important}';
          document.head.append(style);
        }
        node.dataset.motionDurations = JSON.stringify(durations);
        node.dataset.motionSample = phase;
      });
      observer.observe(node, {attributes:true, attributeFilter:['data-state']});
    }
  }, {selector, phase});
}
async function sampled(page: Page, selector: string, phase: string, modal = true) {
  const node = page.locator(`${selector}[data-motion-sample="${phase}"]`);
  await node.waitFor();
  const durations = JSON.parse((await node.getAttribute('data-motion-durations'))!) as number[];
  assert.ok(durations.length >= 1 && durations.every(d => Number.isFinite(d) && d > 0), 'Нет ненулевой CSS-анимации поверхности/backdrop');
  if (modal) { const backdrop = JSON.parse((await node.getAttribute('data-motion-backdrop'))!); assert.ok(backdrop.name !== 'none' && Number.isFinite(backdrop.duration) && backdrop.duration > 0, 'Нет ненулевой CSS-анимации backdrop'); }
  return node;
}
async function resumeMotion(page: Page, selector: string) {
  await page.locator(selector).evaluateAll(async nodes => {
    const phases = nodes.map(node => (node as HTMLElement).dataset.state);
    for (const node of nodes) {
      (node as HTMLElement).dataset.motionResumed = '1';
      for (const animation of node.getAnimations()) if (animation.playState === 'paused') animation.play();
    }
    await Promise.all(nodes.map((node,index) => new Promise<void>(accept => {
      const check = () => { if ((node as HTMLElement).dataset.state !== phases[index]) accept(); else requestAnimationFrame(check); }; check();
    })));
    for (const element of nodes) {
      const node = element as HTMLElement;
      for (const style of document.head.querySelectorAll<HTMLStyleElement>('style[data-motion-for]')) if (style.dataset.motionFor === node.id) style.remove();
      delete node.dataset.motionSample; delete node.dataset.motionDurations; delete node.dataset.motionBackdrop; delete node.dataset.motionResumed;
    }
  });
}

try {
  for (const theme of ['dark', 'light'] as const) {
    for (const [width, height] of [[314,844],[320,844],[360,800],[390,844],[425,844],[439,956],[440,956],[441,956],[639,844],[640,844],[641,844],[844,390],[959,768],[960,768],[1099,768],[1100,920],[1101,920],[1920,720],[1920,920],[1920,1080],[2560,1280],[2560,1440],[3840,2160]] as const) {
      await check(`catalog ${width}×${height} ${theme}`, async () => {
        const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1100, isMobile: width < 1100, colorScheme: theme });
        try {
          await open(page); const measured = await geometry(page); assert.deepEqual(measured.issues, []);
          assert.equal(measured.font, Number((16 * Math.max(1, width / 1920)).toFixed(4)));
          assert.equal(measured.columns, width < 640 ? 1 : width < 1100 ? 2 : 3);
          const stableBefore = JSON.stringify(measured.cards);
          await page.setViewportSize({ width, height: height + 240 });
          assert.equal(JSON.stringify((await geometry(page)).cards), stableBefore, 'Высота окна меняет карточки');
          await page.setViewportSize({ width, height });
          const stability = await page.evaluate(() => {
            const viewport = visualViewport!, height = viewport.height, scale = viewport.scale;
            Object.defineProperty(viewport, 'height', { configurable: true, get: () => height - 180 });
            Object.defineProperty(viewport, 'scale', { configurable: true, get: () => 1.5 });
            viewport.dispatchEvent(new Event('resize')); window.scrollTo(0, 160);
            return { height, scale, simulated: true };
          });
          await page.waitForTimeout(80);
          assert.equal(JSON.stringify((await geometry(page)).cards), stableBefore, 'Карточки скачут от visualViewport/прокрутки');
          await page.evaluate(() => { delete (visualViewport as unknown as Record<string, unknown>).height; delete (visualViewport as unknown as Record<string, unknown>).scale; window.scrollTo(0, 0); });
          await page.screenshot({ path: join(directory, `catalog-${width}x${height}-${theme}.png`) });
          return { ...measured, stability };
        } finally { await page.close(); }
      });
    }
    for (const width of [314,390,440,844,1920]) await check(`text 200% ${width} ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 920 }, hasTouch: true, colorScheme: theme });
      try {
        await open(page); await page.addStyleTag({ content: 'html { font-size: max(200%, .8333333333vw) !important; }' }); await page.waitForTimeout(80);
        const measured = await geometry(page); assert.deepEqual(measured.issues, []);
        await page.screenshot({ path: join(directory, `text200-${width}-${theme}.png`), fullPage: true });
        return measured;
      } finally { await page.close(); }
    });
    for (const [width, height, enlarged] of [[314,844,true],[844,390,false],[844,390,true]] as const) await check(`popup usable ${width} text200=${enlarged} ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true, colorScheme: theme });
      try {
        await open(page);
        if (enlarged) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.getByRole('button', { name: 'Открыть меню' }).click(); await page.waitForTimeout(280);
        for (const control of await page.locator('.gf-popup--drawer').locator('a,button').all()) {
          await control.scrollIntoViewIfNeeded(); assert.ok(await control.evaluate(e => { const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width/2, r.y+r.height/2); return !!hit && (hit===e || e.contains(hit)); }), 'Недостижимый пункт меню');
        }
        await page.locator('.gf-popup--drawer').evaluate(e => { e.scrollTop = 0; });
        await page.screenshot({ path: join(directory, `drawer-usable-${width}-${enlarged}-${theme}.png`) });
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        await page.locator('.gf-game-tags__more:not([tabindex])').first().click(); await page.waitForTimeout(280);
        const dialog = page.locator('.gf-tags-dialog[open]');
        const bounds = await dialog.boundingBox(); assert.ok(bounds && bounds.y >= -1 && bounds.y+bounds.height <= height+1, 'Попап выходит из viewport');
        const close = dialog.getByRole('button', {name:'Закрыть', exact:true}); await close.scrollIntoViewIfNeeded();
        assert.ok(await close.evaluate(e => {const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;}));
        await page.screenshot({ path: join(directory, `tags-usable-${width}-${enlarged}-${theme}.png`) });
        await close.click(); await page.waitForTimeout(250); assert.equal(await page.locator('dialog[open]').count(), 0);
        return {reachable:true, enlarged};
      } finally {await page.close();}
    });
    for (const scene of ['game','game-loading','login','login-unavailable','account','account-empty','account-error','kit','not-found','catalog-empty']) await check(`other pages text200 ${scene} ${theme}`, async () => {
      const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true,colorScheme:theme});
      try {
        await open(page,scene); await page.addStyleTag({content:'html {font-size:200%!important}'}); await page.waitForTimeout(80);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), 'Увеличенный текст расширяет страницу');
        await page.screenshot({path:join(directory,`text200-${scene}-${theme}.png`)});
        if (scene === 'kit' || scene.startsWith('game')) {
          const issues = await page.evaluate(() => {
            const errors: string[] = [];
            for (const record of document.querySelectorAll('.gf-record')) {
              const box=record.getBoundingClientRect();
              for (const item of record.children) {const r=item.getBoundingClientRect(); if (r.left < box.left-1 || r.right > box.right+1 || r.top < box.top-1 || r.bottom > box.bottom+1) errors.push('Содержимое рекорда вне плашки');}
            }
            if (document.querySelector('.gf-kit-page')) {
              for (const toast of document.querySelectorAll('.gf-toast')) { const r=toast.getBoundingClientRect(); if (r.width < 200 || r.height > 500) errors.push('Тост сжат до нечитаемой колонки'); }
              const controls=[...document.querySelectorAll<HTMLElement>('.gf-kit-page button')].filter(e=>e.checkVisibility({visibilityProperty:true}) && !e.closest('[inert]'));
              for(let i=0;i<controls.length;i++) for(let j=i+1;j<controls.length;j++) {const a=controls[i]!.getBoundingClientRect(),b=controls[j]!.getBoundingClientRect(); if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1 && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1) errors.push('Кнопки образцов пересекаются');}
              for (const heading of document.querySelectorAll('.gf-kit-menu-preview h3')) {const a=heading.getBoundingClientRect(),b=heading.closest('.gf-replay-demo')!.querySelector('.gf-replay')!.getBoundingClientRect();if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)errors.push('Повтор перекрывает заголовок меню');}
            }
            return errors;
          }); assert.deepEqual(issues, []);
        }

        if (scene.startsWith('game')) {
          const full = page.locator('.gf-game-full-title'); await full.scrollIntoViewIfNeeded();
          assert.equal(await full.textContent(), 'Superwalk');
          assert.ok(await full.evaluate(e => {const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&s.webkitLineClamp==='none'&&e.scrollHeight<=e.clientHeight+1;}), 'Полное название игры недоступно ниже iframe');
          await page.screenshot({path:join(directory,`text200-${scene}-fulltitle-${theme}.png`)});
        }
        if(scene==='login') { const field=page.locator('input').first();await field.focus();await page.evaluate(()=>{Object.defineProperty(visualViewport!,'height',{configurable:true,get:()=>360});visualViewport!.dispatchEvent(new Event('resize'));});await field.scrollIntoViewIfNeeded();assert.equal(await field.evaluate(e=>document.activeElement===e),true);await page.locator('button[type=submit]').scrollIntoViewIfNeeded(); }
        if(scene==='account') {await page.getByRole('button',{name:'Добавить passkey'}).click();await page.locator('.gf-popup-notice').waitFor({state:'visible'});await page.getByRole('button',{name:'Закрыть сообщение'}).click();await page.waitForTimeout(250);await page.getByRole('button',{name:'Удалить',exact:true}).first().click();assert.ok(await page.locator('.gf-popup-notice').isVisible());}
        return {horizontalOverflow:false};
      } finally {await page.close();}
    });
    await check(`drawer transitions and focus ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width: 314, height: 844 }, hasTouch: true, colorScheme: theme });
      try {
        await page.route(`${servers.after}/`, route => route.fulfill({ path: join(OUT, 'after/index.html'), contentType: 'text/html' }));
        await open(page);
        const trigger = page.getByRole('button', { name: 'Открыть меню' });
        const dialog = page.locator('.gf-popup--drawer');
        const frames: unknown[] = [];
        for (const close of ['escape', 'button', 'backdrop', 'link', 'resize'] as const) {
          await holdMotion(page, '.gf-popup--drawer', 'opening');
          await trigger.click();
          await sampled(page, '.gf-popup--drawer', 'opening');
          const opening = await dialog.evaluate(e => ({ state: e.getAttribute('data-state'), opacity: +getComputedStyle(e).opacity, x: e.getBoundingClientRect().x, backdrop: getComputedStyle(e, '::backdrop').opacity }));
          assert.ok(opening.opacity > 0 && opening.opacity < 1 && opening.x > 70 && +opening.backdrop > 0 && +opening.backdrop < 1, 'Нет выдвижения/затухания входа и backdrop');
          await page.screenshot({ path: join(directory, `drawer-${theme}-${close}-opening.png`) });
          await resumeMotion(page, '.gf-popup--drawer');
          await page.waitForFunction(() => document.querySelector('.gf-popup--drawer')?.getAttribute('data-state') === 'open');
          const full = await dialog.evaluate(e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(), active = e.querySelector('.is-active')!; return { x: r.x, width: r.width, border: s.borderRightWidth, activeBackground: getComputedStyle(active).backgroundColor, after: getComputedStyle(active, '::after').content, scrollLocked: getComputedStyle(document.body).overflow, modal: e.matches(':modal') }; });
          assert.equal(full.x, 70); assert.equal(full.width, 244); assert.equal(full.border, '0px'); assert.equal(full.after, 'none'); assert.equal(full.scrollLocked, 'hidden'); assert.equal(full.modal, true);
          // Ловушка фокуса в обоих направлениях.
          await dialog.getByRole('link').last().focus(); await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Закрыть меню');
          await page.keyboard.press('Shift+Tab'); assert.ok(await dialog.evaluate(e => e.contains(document.activeElement)));
          if (close !== 'link') await holdMotion(page, '.gf-popup--drawer', 'closing');
          if (close === 'escape') await page.keyboard.press('Escape');
          else if (close === 'button') await page.getByRole('button', { name: 'Закрыть меню' }).click();
          else if (close === 'backdrop') await page.mouse.click(20, 150);
          else if (close === 'link') await dialog.getByRole('link', { name: 'Игры', exact: true }).click();
          else await page.setViewportSize({ width: 1200, height: 844 });
          if (close !== 'link') {
            await sampled(page, '.gf-popup--drawer', 'closing');
            const closing = await dialog.evaluate(e => ({ state: e.getAttribute('data-state'), open: (e as HTMLDialogElement).open, x: e.getBoundingClientRect().x, opacity: +getComputedStyle(e).opacity, backdrop: getComputedStyle(e, '::backdrop').opacity }));
            assert.equal(closing.state, 'closing'); assert.ok(closing.open && closing.opacity > 0 && closing.opacity < 1 && closing.x > 70 && +closing.backdrop > 0 && +closing.backdrop < 1, 'Выход оборван');
            await page.screenshot({ path: join(directory, `drawer-${theme}-${close}-closing.png`) }); frames.push({ close, opening, full, closing, sampling: 'Середина настоящей CSS-анимации с управляемым currentTime' });
            await resumeMotion(page, '.gf-popup--drawer');
          }
          if (close === 'link') { await page.locator('html[data-hub-ui-ready="catalog"]').waitFor(); await page.evaluate(() => document.fonts.ready); }
          await page.waitForFunction(() => !document.querySelector('.gf-popup--drawer[open]'));
          assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
          if (close !== 'resize' && close !== 'link') assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
          if (close === 'resize') await page.setViewportSize({ width: 314, height: 844 });
        }
        // Программное повторное открытие во время выхода не должно завершаться старым promise.
        await trigger.click(); await page.waitForTimeout(40); await page.keyboard.press('Escape');
        await trigger.evaluate(e => (e as HTMLButtonElement).click()); await page.waitForFunction(() => document.querySelector('.gf-popup--drawer')?.getAttribute('data-state') === 'open');
        assert.equal(await dialog.getAttribute('data-state'), 'open');
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        await page.emulateMedia({ reducedMotion: 'reduce' }); await trigger.click();
        await page.waitForFunction(() => document.querySelector('.gf-popup--drawer')?.getAttribute('data-state') === 'open');
        assert.equal(await dialog.evaluate(e => getComputedStyle(e).animationName), 'none');
        await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.gf-popup--drawer[open]'));
        return frames;
      } finally { await page.close(); }
    });
    await check(`tags and notification lifecycle ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: theme });
      try {
        await open(page); const trigger = page.locator('.gf-game-tags__more:not([tabindex])').first();
        await holdMotion(page, '.gf-tags-dialog', 'opening'); await trigger.click(); await sampled(page, '.gf-tags-dialog', 'opening'); assert.ok(await page.locator('.gf-tags-dialog[open]').evaluate(e => +getComputedStyle(e).opacity > 0 && +getComputedStyle(e).opacity < 1)); assert.equal(await page.locator('.gf-tags-dialog[open]').getAttribute('data-state'), 'opening');
        await resumeMotion(page, '.gf-tags-dialog[open]'); await page.waitForFunction(() => document.querySelector('.gf-tags-dialog[open]')?.getAttribute('data-state') === 'open');
        await holdMotion(page, '.gf-tags-dialog[open]', 'closing'); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
        await sampled(page, '.gf-tags-dialog', 'closing'); assert.equal(await page.locator('.gf-tags-dialog[open]').getAttribute('data-state'), 'closing');
        assert.ok(await page.locator('.gf-tags-dialog[open]').evaluate(e => +getComputedStyle(e).opacity > 0 && +getComputedStyle(e).opacity < 1));
        await page.screenshot({ path: join(directory, `tags-${theme}-closing.png`) });
        await resumeMotion(page, '.gf-tags-dialog[open]'); await page.waitForFunction(() => !document.querySelector('.gf-tags-dialog[open]')); assert.equal(await page.locator('dialog[open]').count(), 0); assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
        await open(page, 'account-error');
        const notice = page.locator('.gf-popup-notice'); await page.waitForFunction(() => document.querySelector('.gf-popup-notice')?.getAttribute('data-state') === 'open');
        assert.equal(await notice.evaluate(e => getComputedStyle(e).borderTopWidth), '1px');
        assert.equal(await notice.getAttribute('role'), 'alert'); assert.equal(await page.locator(':modal').count(), 0);
        await holdMotion(page, '.gf-popup-notice', 'closing'); await page.getByRole('button', { name: 'Закрыть сообщение' }).click(); await sampled(page, '.gf-popup-notice', 'closing', false);
        assert.equal(await notice.getAttribute('data-state'), 'closing');
        assert.ok(await notice.evaluate(e => +getComputedStyle(e).opacity > 0 && +getComputedStyle(e).opacity < 1)); assert.ok((await notice.textContent())!.includes('Не удалось загрузить'));
        await page.screenshot({ path: join(directory, `notice-${theme}-closing.png`) }); await resumeMotion(page, '.gf-popup-notice'); await page.waitForFunction(() => document.querySelector('.gf-popup-notice')?.getAttribute('data-state') === 'closed'); assert.equal(await notice.isVisible(), false);
        await open(page, 'kit');
        await holdMotion(page, '.gf-popup-notice', 'opening'); await page.getByRole('button', {name:'Показать уведомление'}).click();
        const entering = await sampled(page, '.gf-popup-notice', 'opening', false);
        assert.ok(await entering.evaluate(e => +getComputedStyle(e).opacity > 0 && +getComputedStyle(e).opacity < 1));
        await page.screenshot({path:join(directory, `notice-${theme}-opening.png`)});
        await resumeMotion(page, '.gf-popup-notice'); await page.getByRole('button',{name:'Закрыть сообщение'}).click();
        await page.waitForFunction(() => document.querySelector('.gf-popup-notice')?.getAttribute('data-state') === 'closed');
        return { tagsCloseAnimated: true, noticeBorder: 1, noticeNonModal: true, noticeEntryAnimated:true };
      } finally { await page.close(); }
    });
  }
  await check('different source ratios and mutation sensitivity', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await open(page);
      for (const [width, height] of [[120,360],[640,120]] as const) {
        await page.locator('.gf-card img').first().evaluate(async (e, size) => { const img = e as HTMLImageElement; img.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><rect width="100%" height="100%" fill="orange"/><rect x="1" y="1" width="${size.width-2}" height="${size.height-2}" fill="none" stroke="red" stroke-width="2"/></svg>`); await img.decode(); }, { width, height });
        assert.deepEqual((await geometry(page)).issues, []);
        await page.screenshot({ path: join(directory, `cover-source-${width}x${height}.png`) });
      }
      await page.addStyleTag({ content: '.gf-card img {object-fit:cover!important}' });
      assert.ok((await geometry(page)).issues.includes('Обложка обрезается/искажается'), 'Проверка пропускает мутацию crop');
      await open(page);
      await page.addStyleTag({ content: '.gf-card img {transform:scale(1.2)!important}' });
      assert.ok((await geometry(page)).issues.includes('Изображение не совпадает с полной рамкой'), 'Не обнаружено увеличение изображения с crop');
      await open(page);
      await page.addStyleTag({ content: '.gf-game-tags {height:10px!important;overflow:hidden}' });
      assert.ok((await geometry(page)).issues.includes('Тег обрезан или выпирает'), 'Не обнаружен вертикальный clip тегов');
      await open(page);
      const before = (await geometry(page)).cards;
      await page.evaluate(() => { visualViewport!.addEventListener('resize', () => { document.querySelector<HTMLElement>('.gf-card')!.style.height = `${visualViewport!.height}px`; }); Object.defineProperty(visualViewport!, 'height', { configurable: true, get: () => 500 }); visualViewport!.dispatchEvent(new Event('resize')); });
      assert.notDeepEqual((await geometry(page)).cards, before, 'Проверка пропускает зависимость от visualViewport');
      return { cropMutationDetected: true, viewportMutationDetected: true, transformedImageDetected: true, clippedTagsDetected: true };
    } finally { await page.close(); }
  });
  assert.equal(createHash('sha256').update(readFileSync(new URL(import.meta.url))).update(readFileSync(new URL('../../../e2e/hub-ui.ts', import.meta.url))).digest('hex'), runnerHash, 'Инструмент менялся во время прогона');
  assert.equal(treeHash(join(OUT, 'after')), artifact, 'Сборка менялась во время прогона'); complete = true;
} finally {
  await browser.close(); await servers.close();
  const report = { complete, failed: results.filter(r => r.error).length, ...snapshot, artifact, runnerHash, results,
    limitations: ['visualViewport изменён синтетически при неизменном layout viewport; физическое скрытие панели/pinch zoom не проверены', 'Серединные кадры анимаций используют настоящий CSS с pause/currentTime=duration/2, затем play и проверку завершения', 'Chromium, образцы данных; настоящий Next/iframe проверяются отдельно'] };
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Hub regressions: ${results.length}, failed ${report.failed}`); process.exitCode = report.failed ? 1 : 0;
}
