// Адресная приёмка исправленного прототипа. Плотность и строки кнопок — явные критерии.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../../../../test-results/ui/hub/runs/hub-menu-20261019/evidence/', import.meta.url));
mkdirSync(out, { recursive: true });
const viewer = process.argv[2] ?? 'http://127.0.0.1:4195';
const config = await (await fetch(viewer + '/config.json')).json();
const report = { status: 'running', snapshots: config.snapshots, viewer, url: config.after + '/?scene=catalog&prototype=c',
  layouts: [], dynamic: [], interactions: [], errors: [], failures: [],
  limitations: ['Dev Vite; auth/API/iframe mocked', 'Synthetic visualViewport override; physical browser chrome untested',
    'Screenshots supplied by the owner do not establish exact CSS viewport or browser zoom'] };
const save = () => writeFileSync(out + 'report.json', JSON.stringify(report, null, 2));
const check = (condition, name, details = null) => { if (!condition) report.failures.push({ name, details }); };
save();
const browser = await chromium.launch();
async function open(page, owner) {
  await page.goto(report.url + '&owner=' + (owner ? '1' : '0'));
  await page.locator('html[data-hub-ui-ready="catalog"]').waitFor();
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); });
  await page.waitForTimeout(100);
}
async function measure(page) {
  return page.evaluate(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height, right: r.right, bottom: r.bottom + scrollY }; };
    // showModal делает фон неактивным без атрибута inert на каждом узле.
    const modal = document.querySelector('dialog:modal');
    const visible = e => (!modal || modal.contains(e)) && !e.closest('[inert]') && e.checkVisibility() && getComputedStyle(e).visibility === 'visible';
    const textRects = e => {
      const list = [], walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (!n.textContent.trim() || !visible(n.parentElement)) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        list.push(...[...r.getClientRects()].filter(b => b.width && b.height).map(b => ({ x: b.x, y: b.y + scrollY, right: b.right, bottom: b.bottom + scrollY, text: n.textContent.trim() })));
      }
      return list;
    };
    const targets = [...document.querySelectorAll('a,button')].filter(visible).map(e => ({
      ...rect(e), text: e.getAttribute('aria-label') || e.textContent.trim(), textRects: textRects(e),
    }));
    const overflowText = targets.flatMap(t => t.textRects.filter(r => r.x < t.x - 1 || r.right > t.right + 1 || r.y < t.y - 1 || r.bottom > t.bottom + 1).map(r => ({ target: t.text, rect: r })));
    const overlaps = [];
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i], b = targets[j];
      if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1) overlaps.push([a.text, b.text]);
    }
    const cards = [...document.querySelectorAll('.gf-catalog .gf-card')].map(e => {
      const actions = [...e.querySelectorAll('.gf-card__actions > a')].map(a => ({ ...rect(a), text: a.textContent.trim(), textRects: textRects(a) }));
      const image = e.querySelector('img');
      return { ...rect(e), title: rect(e.querySelector('h2')), cover: rect(e.querySelector('.gf-card__cover')), footer: rect(e.querySelector('.gf-card__actions')), actions,
        fit: image ? getComputedStyle(image).objectFit : null, natural: image ? [image.naturalWidth, image.naturalHeight] : null };
    });
    const svh = document.createElement('div'); svh.style.cssText = 'position:absolute;height:100svh;visibility:hidden;pointer-events:none'; document.body.append(svh);
    const stableHeight = svh.getBoundingClientRect().height; svh.remove();
    return { viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport.width, visualHeight: visualViewport.height, scale: visualViewport.scale, svh: stableHeight }, scrollY,
      rem: getComputedStyle(document.documentElement).fontSize, overflow: document.documentElement.scrollWidth - innerWidth,
      header: rect(document.querySelector('.gf-header')), brand: rect(document.querySelector('.gf-logo')),
      pointer: { coarse: matchMedia('(pointer:coarse)').matches, anyCoarse: matchMedia('(any-pointer:coarse)').matches },
      brandWordDisplay: getComputedStyle(document.querySelector('.gf-logo__word')).display,
      gridColumns: getComputedStyle(document.querySelector('.gf-catalog__grid')).gridTemplateColumns,
      cards, targets, overflowText, overlaps };
  });
}
function layoutChecks(g, label, touch, enlarged = false) {
  check(g.overflow <= 1, label + ': document overflow', g.overflow);
  check(!g.overflowText.length, label + ': text outside controls', g.overflowText);
  check(!g.overlaps.length, label + ': overlapping controls', g.overlaps);
  check(g.brandWordDisplay !== 'none', label + ': brand name hidden');
  if (touch || g.pointer.anyCoarse) check(!g.targets.some(t => t.width < 47.99 || t.height < 47.99), label + ': touch area under 48', g.targets.filter(t => t.width < 47.99 || t.height < 47.99));
  for (const c of g.cards) {
    check(Math.abs(c.cover.width / c.cover.height - 16 / 9) < 0.005, label + ': cover ratio', c.cover);
    if (c.fit) check(c.fit === 'contain', label + ': cropped image', c.fit);
    if (!enlarged && c.actions.length === 2) {
      const [play, download] = c.actions;
      check(Math.abs(play.y - download.y) < 1 && download.width > play.width, label + ': action proportions', c.actions);
      const ys = download.textRects.map(r => r.y);
      check(!ys.length || Math.max(...ys) - Math.min(...ys) <= 1, label + ': archive size wrapped', download);
      check(Math.abs(play.bottom + parseFloat(g.rem) * 0.1875 - download.bottom) < 1, label + ': visual button bottoms', c.actions);
    }
  }
}
try {
  for (const [width, height, touch] of [[390,844,true],[1920,920,false],[844,390,true],[768,1024,true],
    [1183,984,false],[1220,994,false],[390,700,true],[320,568,true],[360,800,true],[1024,768,true],
    [1920,1080,false],[2560,1440,false],[2560,1280,false],[3840,2160,false]]) {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: theme });
      const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
      for (const owner of [false, true]) {
        const label = `${width}x${height}-${theme}-${owner ? 'owner' : 'guest'}`;
        await open(page, owner);
        const g = await measure(page);
        await page.screenshot({ path: out + label + '.png' });
        report.layouts.push({ label, touch, owner, theme, shot: label + '.png', ...g });
        layoutChecks(g, label, touch);
        if (width === 390 && height === 844) check(g.cards[0].bottom <= height && g.cards[1].cover.bottom <= height && g.cards[1].title.bottom <= height,
          label + ': phone first screen', { first: g.cards[0].bottom, secondCover: g.cards[1].cover.bottom, secondTitle: g.cards[1].title.bottom });
        if (width >= 1100) check(g.cards.slice(0, 6).every(c => c.bottom <= height), label + ': desktop two complete rows', g.cards.slice(0, 6).map(c => c.bottom));
        if (width === 768) check(g.cards.slice(0, 4).every(c => c.bottom <= height), label + ': tablet two complete rows', g.cards.slice(0, 4).map(c => c.bottom));
        if (width === 844 && height === 390) {
          check(g.cards[0].height <= height - 32, label + ': landscape full card after header', g.cards[0].height);
          await page.evaluate(y => scrollTo(0, y - 16), g.cards[0].y);
          await page.screenshot({ path: out + label + '-scrolled.png' });
        }
        if (width === 390 && height === 844 && theme === 'dark') {
          await page.evaluate(() => scrollTo(0, 550));
          const before = await measure(page);
          await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => 700 }); visualViewport.dispatchEvent(new Event('resize')); });
          await page.waitForTimeout(100);
          const after = await measure(page);
          const delta = Math.max(...before.cards.flatMap((c,i) => ['x','y','width','height'].map(k => Math.abs(c[k] - after.cards[i][k]))));
          report.dynamic.push({ label, delta, before, after }); check(delta <= 1, label + ': visualViewport shifts catalog', delta);
        }
        save();
      }
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  const page = await context.newPage();
  for (const owner of [false, true]) {
    await open(page, owner);
    const trigger = page.getByRole('button', { name: 'Открыть меню' });
    await trigger.click();
    const menu = page.locator('.gf-menu-dialog');
    await menu.waitFor({ state: 'visible' });
    check(await page.getByRole('button', { name: 'Закрыть меню' }).evaluate(e => e === document.activeElement), 'menu: initial focus');
    check(await trigger.getAttribute('aria-expanded') === 'true', 'menu: expanded');
    const before = await measure(page); layoutChecks(before, 'menu-' + owner, true);
    const hits = await menu.locator('a,button').evaluateAll(elements => elements.map(e => {
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { text: e.getAttribute('aria-label') || e.textContent.trim(), reachable: e === hit || e.contains(hit) };
    }));
    check(hits.every(h => h.reachable), 'menu: pointer hit testing', hits);
    for (let i = 0; i < hits.length + 1; i++) {
      await page.keyboard.press('Tab');
      check(await menu.evaluate(e => e.contains(document.activeElement)), 'menu: Tab escaped dialog');
    }
    await page.keyboard.press('Shift+Tab');
    check(await menu.evaluate(e => e.contains(document.activeElement)), 'menu: Shift+Tab escaped dialog');
    await page.screenshot({ path: out + `menu-${owner ? 'owner' : 'guest'}.png` });
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.gf-menu-trigger').getAttribute('aria-expanded') === 'false');
    check(await trigger.evaluate(e => e === document.activeElement), 'menu: focus return');
    check(await trigger.getAttribute('aria-expanded') === 'false', 'menu: closed state');
    report.interactions.push({ owner, kind: 'menu', before, hits });
    await page.evaluate(() => document.documentElement.style.fontSize = '32px');
    await page.waitForTimeout(100);
    const text = await measure(page); layoutChecks(text, 'text200-' + owner, true, true);
    await page.screenshot({ path: out + `text200-${owner ? 'owner' : 'guest'}.png`, fullPage: true });
    report.interactions.push({ owner, kind: 'text200', geometry: text });
  }
  await context.close();
  // Проверяем, что критерий действительно видит перенос из отвергнутого А.
  try {
    const old = await (await fetch('http://127.0.0.1:4194/config.json')).json();
    const c = await browser.newContext({ viewport: { width: 1920, height: 920 }, colorScheme: 'dark' });
    const p = await c.newPage(); await p.goto(old.after + '/?scene=catalog&prototype=a');
    await p.locator('[data-hub-ui-ready="catalog"]').waitFor(); await p.evaluate(() => document.fonts.ready);
    const oldGeometry = await measure(p);
    report.rejected = { snapshots: old.snapshots, geometry: oldGeometry };
    const detected = oldGeometry.cards.some(c => { const ys = c.actions[1]?.textRects.map(r => r.y) ?? []; return ys.length && Math.max(...ys) - Math.min(...ys) > 1; });
    check(detected, 'negative control: rejected action wrapping not detected');
    await c.close();
  } catch (e) { report.failures.push({ name: 'negative control unavailable', details: String(e) }); }
  report.status = 'finished';
} finally { await browser.close(); save(); }
console.log(JSON.stringify({ status: report.status, url: report.url, layouts: report.layouts.length, errors: report.errors, failures: report.failures,
  dynamic: report.dynamic.map(d => ({ label: d.label, delta: d.delta })),
  firstScreens: report.layouts.filter(g => g.theme === 'dark' && !g.owner).map(g => ({ label: g.label, firstHeight: g.cards[0].height, firstStart: g.cards[0].y,
    secondTitleBottom: g.cards[1].title.bottom, row2Bottom: g.cards[g.gridColumns.split(' ').length * 2 - 1].bottom, columns: g.gridColumns })), out }, null, 2));
if (report.failures.length || report.errors.length) process.exitCode = 1;
