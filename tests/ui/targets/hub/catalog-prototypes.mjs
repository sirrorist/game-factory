// Адресные замеры прототипов; не заменяют штатную матрицу и приёмку телефона.
// node tests/ui/targets/hub/catalog-prototypes.mjs http://127.0.0.1:4193
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const out = resolve(root, 'test-results/ui/hub/runs/hub-ab-20261019/prototypes');
mkdirSync(out, { recursive: true });
const config = await (await fetch(new URL('/config.json', process.argv[2] ?? 'http://127.0.0.1:4193'))).json();
const detailsOnly = process.argv.includes('--details');
const report = detailsOnly ? JSON.parse(readFileSync(`${out}/report.json`, 'utf8')) : { baseline: config.snapshots.before, after: config.snapshots.after,
  urls: { viewer: process.argv[2], after: config.after, before: config.references[0].url },
  limitations: ['Dev Vite: actual components, mocked auth/API/iframe; archive sizes are samples.',
    'visualViewport override is a diagnostic simulation, not physical browser chrome.',
    'Actual Next and real game iframe are deferred until the owner chooses A/B.'],
  layouts: [], dynamic: [], text200: [], errors: [] };
if (detailsOnly && report.after.artifactHash !== config.snapshots.after.artifactHash) throw new Error('Сборка изменилась: повторите полный адресный прогон.');
const browser = await chromium.launch();
async function open(page, variant, owner, lines = '') {
  await page.goto(config.after + `/?scene=catalog&prototype=${variant}&owner=${owner ? 1 : 0}&lines=${lines}`);
  await page.locator('html[data-hub-ui-ready="catalog"]').waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
  });
  await page.waitForTimeout(150);
}
async function geometry(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;width:0;height:100svh;visibility:hidden;pointer-events:none;';
    document.body.append(probe); const svh = probe.getBoundingClientRect().height; probe.remove();
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height, bottom: r.bottom + scrollY }; };
    const targets = [...document.querySelectorAll('a,button')].filter(e =>
      !e.closest('[inert]') && e.checkVisibility() && getComputedStyle(e).visibility === 'visible');
    const textIssues = [];
    for (const e of targets) {
      const box = e.getBoundingClientRect();
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || !node.parentElement.checkVisibility()
          || getComputedStyle(node.parentElement).visibility !== 'visible') continue;
        const range = document.createRange(); range.selectNodeContents(node);
        if ([...range.getClientRects()].some(r => r.width && r.height &&
          (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1))) {
          textIssues.push({ text: node.textContent, target: e.textContent.trim() });
        }
      }
    }
    const overlaps = [];
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i], b = targets[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      if (Math.min(ar.right, br.right) - Math.max(ar.left, br.left) > 1 &&
        Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top) > 1) overlaps.push([a.textContent.trim(), b.textContent.trim()]);
    }
    const cards = [...document.querySelectorAll('.gf-catalog .gf-card')].map(e => ({
      ...rect(e), title: rect(e.querySelector('.gf-card__title')), cover: rect(e.querySelector('.gf-card__cover')),
      description: rect(e.querySelector('.gf-card__desc')),
      image: e.querySelector('img') ? { fit: getComputedStyle(e.querySelector('img')).objectFit,
        naturalWidth: e.querySelector('img').naturalWidth, naturalHeight: e.querySelector('img').naturalHeight,
        ...rect(e.querySelector('img')) } : null,
    }));
    return { viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport.width,
      visualHeight: visualViewport.height, scale: visualViewport.scale }, scrollY,
      rem: getComputedStyle(document.documentElement).fontSize, svh,
      header: rect(document.querySelector('.gf-header')), heading: rect(document.querySelector('.gf-catalog__heading')),
      overflow: document.documentElement.scrollWidth - innerWidth, cards, textIssues, overlaps,
      targets: targets.map(e => ({ text: e.getAttribute('aria-label') || e.textContent.trim(), ...rect(e) })),
      shortTargets: targets.filter(e => { const r = e.getBoundingClientRect(); return r.width < 47.99 || r.height < 47.99; })
        .map(e => ({ text: e.getAttribute('aria-label') || e.textContent.trim(), ...rect(e) })),
    };
  });
}
try {
  if (!detailsOnly) for (const [w, h, touch] of [[390,844,true],[390,700,true],[320,568,true],[360,800,true],
    [844,390,true],[768,1024,true],[1024,768,true],[1920,1080,false],[1920,920,false],
    [2560,1440,false],[2560,1280,false],[3840,2160,false]]) {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, colorScheme: theme });
      const page = await context.newPage();
      page.on('pageerror', e => report.errors.push(e.message));
      for (const variant of ['a', 'b']) for (const owner of [false, true]) {
        await open(page, variant, owner);
        const g = await geometry(page);
        const name = `${variant}-${w}x${h}-${theme}-${owner ? 'owner' : 'guest'}`;
        await page.screenshot({ path: `${out}/${name}.png` });
        report.layouts.push({ variant, owner, theme, touch, shot: `${name}.png`, ...g });
        if (w === 390 && h === 844 && theme === 'dark') {
          await page.evaluate(() => scrollTo(0, 550));
          const before = await geometry(page);
          await page.evaluate(() => {
            Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => 700 });
            visualViewport.dispatchEvent(new Event('resize'));
          });
          await page.waitForTimeout(150);
          const smaller = await geometry(page);
          const delta = Math.max(...before.cards.flatMap((c, i) => ['x','y','width','height'].map(k => Math.abs(c[k] - smaller.cards[i][k]))));
          report.dynamic.push({ variant, owner, delta, before, smaller });
        }
      }
      await context.close();
    }
  }
  // Собственное воспроизведение MR №12 на сохранённой базе.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(config.references[0].url + '/?scene=catalog');
  await page.locator('[data-hub-ui-ready="catalog"]').waitFor();
  await page.waitForTimeout(150);
  await page.evaluate(() => scrollTo(0, 550));
  const before = await geometry(page);
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => 700 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(150);
  report.baselineReproduction = { before, smaller: await geometry(page) };
  report.text200 = [];
  for (const variant of ['a', 'b']) {
    await open(page, variant, false);
    await page.evaluate(() => document.documentElement.style.fontSize = '32px');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${variant}-text200.png`, fullPage: true });
    await page.screenshot({ path: `${out}/${variant}-text200-top.png` });
    report.text200.push({ variant, ...await geometry(page) });
  }
  await open(page, 'a', false, '3');
  await page.screenshot({ path: `${out}/a-three-lines-390x844.png` });
  report.threeLines = await geometry(page);
  await context.close();
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ layouts: report.layouts.length, errors: report.errors,
  touchFailures: report.layouts.filter(g => g.touch && g.shortTargets.length).map(g => ({ variant: g.variant, viewport: g.viewport, targets: g.shortTargets })),
  dynamic: report.dynamic.map(g => ({ variant: g.variant, owner: g.owner, delta: g.delta })),
  phone: report.layouts.filter(g => g.viewport.width === 390 && g.viewport.height === 844 && g.theme === 'dark')
    .map(g => ({ variant: g.variant, owner: g.owner, header: g.header.height, start: g.cards[0].y, card: g.cards[0].height,
      secondCoverBottom: g.cards[1].cover.bottom, secondTitleBottom: g.cards[1].title.bottom })),
  text200: report.text200.map(g => ({ variant: g.variant, overflow: g.overflow, shortTargets: g.shortTargets, textIssues: g.textIssues, overlaps: g.overlaps })),
  aThreeLines: { cardHeight: report.threeLines.cards[0].height, secondTitleBottom: report.threeLines.cards[1].title.bottom },
  baseline: { heightBefore: report.baselineReproduction?.before.cards[0].height,
    heightAfter: report.baselineReproduction?.smaller.cards[0].height }, out }, null, 2));
