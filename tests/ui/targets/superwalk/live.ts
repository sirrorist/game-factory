import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Frame, Page } from 'playwright';
import { PROFILES } from './config.ts';
import { OUT, ROOT } from './snapshot.ts';
import { startComparison } from './server.ts';
import { gameEvidence } from './evidence.ts';
import { inspectWalletLayout } from './wallet-layout.ts';

// Этот прогон не использует prepareScene: часы, мир, CSS и случайность остаются живыми.
// Единственный управляемый RNG-вход — отдельная явно обозначенная проверка выигрыша.
interface Profile { id: string; width: number; height: number; touch: boolean; parent?: { width: number; height: number } }
interface Assertion { id: string; expected: unknown; actual: unknown; passed: boolean }
interface Run { side: 'before' | 'after'; profile: string; checks: Assertion[]; screenshots: string[]; runtime: string[]; video?: string; input?: unknown }
interface Wallet {
  getBalance(): number;
  getWalletState(): { transactions: { type: string }[] };
  getEquippedSkin(): { name: string } | null;
  getCaseOpening?(): { skin: { id: string }; isNew: boolean; revealed: boolean; compensationGfc: number } | null;
  getMarket(): { getSpotPrice(): number };
  executeWithdrawal(amount: number): { success: boolean; error?: string; receipt?: unknown };
  playSlots(): unknown;
}
interface App {
  walletManager: Wallet; openMenu(): void; renderWalletMarketInfo(): void; updateDashboard(): void;
  inventory: { weapons: Map<string, number>; tomes: Map<string, number> }; ownedItems: Map<string, number>;
}
type InstrumentedWindow = typeof globalThis & { __SW_UI__: App };
interface Session { context: BrowserContext; page: Page; frame: Page | Frame; run: Run; profile: Profile }

const LIVE = join(OUT, 'live');
const IFRAME_PROFILES: Profile[] = [
  { id: 'iframe-desktop', width: 990, height: 680, touch: false, parent: { width: 1024, height: 920 } },
  { id: 'iframe-mobile', width: 464, height: 620, touch: true, parent: { width: 520, height: 800 } },
  { id: 'iframe-phone-portrait', width: 350, height: 620, touch: true, parent: { width: 390, height: 844 } },
  { id: 'iframe-phone-landscape', width: 790, height: 290, touch: true, parent: { width: 844, height: 390 } },
  { id: 'iframe-landscape-boundary', width: 790, height: 341, touch: true, parent: { width: 844, height: 390 } },
  { id: 'iframe-landscape-narrow', width: 600, height: 290, touch: true, parent: { width: 650, height: 390 } },
];

function check(s: Session, id: string, expected: unknown, actual: unknown, passed: boolean): void {
  s.run.checks.push({ id, expected, actual, passed });
}

async function open(browser: Browser, url: string, side: Run['side'], profile: Profile): Promise<Session> {
  const context = await browser.newContext({
    viewport: profile.parent ?? { width: profile.width, height: profile.height },
    hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: 1,
    recordVideo: ['fullhd', 'phone-portrait', 'iframe-phone-landscape'].includes(profile.id)
      ? { dir: join(LIVE, 'video'), size: { width: Math.min(profile.parent?.width ?? profile.width, 1024), height: Math.min(profile.parent?.height ?? profile.height, 900) } } : undefined,
  });
  await context.addInitScript(() => { try {
    if (!sessionStorage.getItem('sw-live-initialized')) {
      localStorage.clear(); sessionStorage.setItem('sw-live-initialized', '1');
    }
  } catch {} });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const run: Run = { side, profile: profile.id, checks: [], screenshots: [], runtime: [] };
  page.on('pageerror', e => run.runtime.push(e.message));
  page.on('console', e => { if (e.type() === 'error') run.runtime.push(e.text()); });
  page.on('dialog', dialog => void dialog.accept());
  let frame: Page | Frame = page;
  if (profile.parent) {
    // Оболочка не имитирует hub bridge или пользователя. Размер iframe измеряется отдельно.
    await page.route('**/live-wrapper', route => route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#10121a}iframe{display:block;border:0;width:${profile.width}px;height:${profile.height}px}</style><iframe src="${url}/?live=1" title="Superwalk"></iframe>` }));
    await page.goto(url + '/live-wrapper');
    const iframe = await page.locator('iframe').elementHandle();
    const content = await iframe?.contentFrame();
    if (!content) throw new Error('Не появился iframe');
    frame = content;
  } else await page.goto(url + '/?live=1');
  await frame.waitForFunction(() => !!(globalThis as InstrumentedWindow).__SW_UI__, undefined, { timeout: 20000 });
  await frame.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const s = { context, page, frame, run, profile };
  run.input = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight, coarse: matchMedia('(pointer: coarse)').matches, raf: requestAnimationFrame.toString(), random: Math.random.toString(), date: Date.now.toString() }));
  const clock = await frame.evaluate(async () => {
    const native = [requestAnimationFrame, Math.random, Date.now, crypto.getRandomValues].every(fn => fn.toString().includes('[native code]'));
    const ticks = await Promise.race([
      new Promise<number[]>(resolve => requestAnimationFrame(a => requestAnimationFrame(b => resolve([a, b])))),
      new Promise<number[]>(resolve => setTimeout(() => resolve([]), 2500)),
    ]);
    return { native, ticks };
  });
  check(s, 'live-clock-and-RNG', { native: true, advancingFrames: true }, clock, clock.native && clock.ticks.length === 2 && clock.ticks[1]! > clock.ticks[0]!);
  check(s, 'viewport', [profile.width, profile.height], await frame.evaluate(() => [innerWidth, innerHeight]),
    await frame.evaluate(({ width, height }) => innerWidth === width && innerHeight === height, profile));
  check(s, 'SDK-ready', true, await frame.locator('html[data-gf-ready]').count(), await frame.locator('html[data-gf-ready]').count() === 1);
  if (!profile.parent) check(s, 'coarse-input', profile.touch, await frame.evaluate(() => matchMedia('(pointer: coarse)').matches), await frame.evaluate(() => matchMedia('(pointer: coarse)').matches) === profile.touch);
  return s;
}

async function capture(s: Session, name: string): Promise<void> {
  if (!['fullhd', 'phone-portrait', 'iframe-desktop', 'iframe-phone-landscape'].includes(s.profile.id)) return;
  const file = `${s.run.side}-${s.profile.id}-${name}.png`;
  await s.page.screenshot({ path: join(LIVE, file), fullPage: true });
  s.run.screenshots.push(file);
}

async function click(s: Session, selector: string): Promise<void> {
  const target = s.frame.locator(selector);
  const wallet = await target.evaluate(e => !!e.closest('#wallet-modal'));
  if (wallet) {
    const accessible = await target.evaluate(e => {
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && !!hit && (e === hit || e.contains(hit));
    });
    if (!accessible) throw new Error(`${selector} недоступен до программной прокрутки`);
  } else await target.scrollIntoViewIfNeeded();
  if (s.profile.touch) await target.tap(); else await target.click();
}

async function reachability(s: Session, scope: string, name: string): Promise<void> {
  const observations: { id: string; hit: boolean; width: number; height: number }[] = [];
  for (const target of await s.frame.locator(`${scope} button,${scope} input`).all()) {
    if (!await target.isVisible() || !await target.isEnabled()) continue;
    if (!await target.evaluate(e => !!e.closest('#wallet-modal'))) await target.scrollIntoViewIfNeeded().catch(() => {});
    observations.push(await target.evaluate(e => {
      const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { id: e.id || e.textContent?.trim().slice(0, 40) || e.tagName,
        hit: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && !!hit && (hit === e || e.contains(hit)), width: r.width, height: r.height };
    }));
  }
  check(s, `${name}-reachable`, 'Все видимые доступные контролы имеют доступный центр', observations, observations.length > 0 && observations.every(o => o.hit));
  if (s.profile.touch) check(s, `${name}-touch`, 'Все цели >=48 CSS px', observations, observations.every(o => o.width >= 47.5 && o.height >= 47.5));
}

async function scrolling(s: Session, scope: string, name: string): Promise<void> {
  const geometry = await s.frame.evaluate(scope => {
    const root = document.querySelector<HTMLElement>(scope)!;
    const visible = (e: HTMLElement) => e.checkVisibility() && e.getBoundingClientRect().width > 0;
    const items = [root, ...root.querySelectorAll<HTMLElement>('*')].filter(visible);
    const y = items.filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).map(e => ({ id: e.id || e.className, client: e.clientHeight, scroll: e.scrollHeight }));
    const x = items.filter(e => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1).map(e => ({ id: e.id || e.className, client: e.clientWidth, scroll: e.scrollWidth }));
    const r = root.getBoundingClientRect();
    return { y, x, root: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, width: innerWidth, height: innerHeight,
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } };
  }, scope);
  check(s, `${name}-vertical-scroll`, '0 прокручиваемых областей в кошельке/паузе', geometry.y, geometry.y.length === 0);
  check(s, `${name}-horizontal-scroll`, 0, geometry.x, geometry.x.length === 0);
  check(s, `${name}-document-scroll`, { width: geometry.width, height: geometry.height }, geometry.document, geometry.document.width <= geometry.width + 1 && geometry.document.height <= geometry.height + 1);
  check(s, `${name}-bounds`, 'В пределах iframe/экрана', geometry.root, geometry.root.left >= -1 && geometry.root.top >= -1 && geometry.root.right <= geometry.width + 1 && geometry.root.bottom <= geometry.height + 1);
  if (scope === '.gf-wallet-panel') {
    const contents = await s.frame.evaluate(inspectWalletLayout);
    check(s, `${name}-contents-and-close`, 'Текст внутри секций, нет перекрытий/скрытой прокрутки, крестик доступен', contents, contents.errors.length === 0);
  }
}

async function walletOpen(s: Session): Promise<void> {
  // При захвате мыши абсолютные координаты клика не перемещают игровой курсор.
  // Открываем паузу штатным Escape, вместо насильственного DOM-click.
  if (!await s.frame.locator('#menu').isVisible() && !await s.frame.locator('#wallet-modal').isVisible()) {
    await s.page.keyboard.press('Escape');
    await s.page.waitForTimeout(350);
  }
  if (await s.frame.locator('#menu').isVisible()) await click(s, '#btn-menu-wallet');
  else await click(s, '#btn-wallet');
  await s.frame.locator('#wallet-modal').waitFor({ state: 'visible' });
  await s.page.waitForTimeout(300);
}

async function keyboardReopenWallet(s: Session, name: string): Promise<void> {
  // Это настоящие клавиши: Escape возвращает паузу, Enter активирует её кнопку.
  // Не тратим короткое окно спина на ожидание устойчивости координат mouse-click.
  await s.page.keyboard.press('Escape');
  const state = await s.frame.evaluate(() => ({ closed: document.getElementById('wallet-modal')!.hidden === true,
    menu: !document.getElementById('menu')!.hidden, focus: document.activeElement?.id }));
  check(s, `${name}-keyboard-close`, true, state, state.closed);
  if (state.closed && state.menu && state.focus === 'btn-menu-wallet') {
    await s.page.keyboard.press('Enter');
  } else {
    if (!state.closed) await click(s, '#btn-wallet-close');
    await walletOpen(s);
  }
}

async function feedbackState(s: Session) {
  return s.frame.evaluate(() => {
    const toast = document.getElementById('toast')!;
    const feedback = document.querySelector<HTMLElement>('.gf-feedback') ?? toast;
    const css = getComputedStyle(feedback), toastCss = getComputedStyle(toast);
    const rect = toast.getBoundingClientRect(), menu = document.querySelector<HTMLElement>('#menu .gf-panel')!.getBoundingClientRect();
    const visible = !toast.hidden && toastCss.display !== 'none' && toastCss.visibility === 'visible' && Number(toastCss.opacity) > 0 && rect.width > 0 && rect.height > 0;
    return { wrapperPresent: feedback !== toast, visibility: css.visibility, toastHidden: toast.hidden,
      toastVisibility: toastCss.visibility, toastOpacity: toastCss.opacity, text: toast.textContent, visible,
      overlap: visible && Math.min(rect.right, menu.right) > Math.max(rect.left, menu.left) + 1 && Math.min(rect.bottom, menu.bottom) > Math.max(rect.top, menu.top) + 1,
      toastRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      menuRect: { left: menu.left, top: menu.top, right: menu.right, bottom: menu.bottom } };
  });
}

async function layouts(s: Session): Promise<void> {
  if (!await s.frame.locator('#menu').isVisible()) await s.frame.evaluate(() => (globalThis as InstrumentedWindow).__SW_UI__.openMenu());
  await s.page.waitForTimeout(300);
  if (s.profile.parent) await click(s, '#menu .gf-panel__title');
  const debugBefore = await s.frame.evaluate(() => document.getElementById('debug')!.hidden);
  await s.page.keyboard.press('F3');
  const debugDuring = await s.frame.evaluate(() => document.getElementById('debug')!.hidden);
  await s.page.keyboard.press('F3');
  const debugAfter = await s.frame.evaluate(() => document.getElementById('debug')!.hidden);
  check(s, 'pause-F3-toggle', { toggles: true, restores: true }, { before: debugBefore, during: debugDuring, after: debugAfter }, debugBefore !== debugDuring && debugAfter === debugBefore);
  const pausedFeedback = await feedbackState(s);
  check(s, 'pause-feedback-hidden', { visibility: 'hidden', toastHidden: false, overlap: false }, pausedFeedback,
    pausedFeedback.visibility === 'hidden' && pausedFeedback.toastHidden === false && !pausedFeedback.overlap);
  await scrolling(s, '.gf-panel--pause', 'menu');
  await capture(s, 'menu-top');
  await reachability(s, '#menu', 'menu');
  await capture(s, 'menu-scrolled');
  // Наполненная пауза проверяется без остановки rAF/часов и без подмены DOM-карточек.
  const rich = await s.frame.evaluate(() => {
    const app = (globalThis as InstrumentedWindow).__SW_UI__;
    const saved = { weapons: [...app.inventory.weapons], tomes: [...app.inventory.tomes], items: [...app.ownedItems] };
    app.inventory.weapons.set('spark_sling', 5);
    app.inventory.tomes.set('tome_haste', 5);
    app.inventory.tomes.set('tome_might', 5);
    for (const id of ['acorn', 'swift_feather', 'magnet_pebble', 'burdock', 'lucky_paw', 'fang', 'honeycomb', 'spring_boots', 'rage_totem', 'storm_bead', 'mirror_bark', 'four_leaf', 'ninth_tail', 'phoenix_down']) app.ownedItems.set(id, 12);
    app.updateDashboard();
    return saved;
  });
  await scrolling(s, '.gf-panel--pause', 'menu-rich');
  const richGeometry = await s.frame.evaluate(() => {
    const rect = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    const sections = [...document.querySelectorAll<HTMLElement>('.gf-menu-overview .gf-menu-col')].filter(e => e.checkVisibility()).map(rect);
    const controls = [...document.querySelectorAll<HTMLElement>('#menu .gf-item-row,#menu .gf-stat-card')].filter(e => e.checkVisibility()).map(rect);
    const overlaps: unknown[] = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!, b = controls[j]!;
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1) overlaps.push({ a, b });
    }
    for (let i = 0; i < sections.length; i++) for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i]!, b = sections[j]!;
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1) overlaps.push({ sectionA: a, sectionB: b });
    }
    return { itemCount: document.querySelectorAll('#menu .gf-item-row').length, cardCount: controls.length, sections, overlaps };
  });
  check(s, 'menu-rich-card-section-overlap', { itemCount: '>=18', overlaps: 0 }, richGeometry, richGeometry.itemCount >= 18 && richGeometry.overlaps.length === 0);
  await reachability(s, '#menu', 'menu-rich');
  await capture(s, 'menu-rich');
  if (s.run.side === 'after') {
    for (const tab of ['items', 'stats']) {
      await click(s, `#menu-tab-${tab}`);
      const cards: { width: number; height: number; name: string; offsets: number[] }[] = [];
      const pageCounts: number[] = [];
      do {
        const visible = await s.frame.evaluate(() => [...document.querySelectorAll<HTMLElement>('#menu .gf-item-row,#menu .gf-stat-card')].filter(e => e.checkVisibility()).map(e => {
          const r = e.getBoundingClientRect();
          const children = [...e.querySelectorAll<HTMLElement>('.gf-item-row__name,.gf-item-row__desc,.gf-item-row__badge')].map(c => c.getBoundingClientRect().top - r.top);
          return { width: r.width, height: r.height, name: e.textContent?.trim() ?? '', offsets: children };
        }));
        cards.push(...visible); pageCounts.push(visible.length);
        if (await s.frame.locator('#menu-page-next').isDisabled()) break;
        await click(s, '#menu-page-next');
      } while (pageCounts.length < 30);
      const unique = new Set(cards.map(c => c.name));
      check(s, `menu-${tab}-pagination`, 'Все карточки доступны по одному разу', { count: cards.length, unique: unique.size, pageCounts },
        unique.size === cards.length && cards.length >= (tab === 'items' ? 18 : 12));
      const first = cards[0]!;
      check(s, `menu-${tab}-stable-cards`, 'Одинаковые ширина/высота/позиции текста на страницах', cards,
        cards.every(c => Math.abs(c.width - first.width) < 1 && Math.abs(c.height - first.height) < 1 && c.offsets.every((v, i) => Math.abs(v - first.offsets[i]!) < 1)));
      if (tab === 'stats') check(s, 'menu-stats-two-columns', 'Хотя бы две карточки на странице', pageCounts, pageCounts[0]! >= 2);
    }
    await click(s, '#menu-tab-items');
    const duplicates = await s.frame.locator('#btn-debug-toggle').count();
    check(s, 'menu-no-duplicate-perf', 1, duplicates, duplicates === 1);
  }
  await s.frame.evaluate(saved => {
    const app = (globalThis as InstrumentedWindow).__SW_UI__;
    app.inventory.weapons = new Map(saved.weapons); app.inventory.tomes = new Map(saved.tomes); app.ownedItems = new Map(saved.items);
    app.updateDashboard();
  }, rich);
  await walletOpen(s);
  await scrolling(s, '.gf-wallet-panel', 'wallet-slots');
  const tabs = await s.frame.evaluate(() => {
    const e = document.querySelector<HTMLElement>('.gf-wallet-tabs')!;
    return { rows: new Set([...e.querySelectorAll<HTMLElement>('button')].map(b => Math.round(b.getBoundingClientRect().top))).size,
      widths: [...e.querySelectorAll<HTMLElement>('button')].map(b => b.getBoundingClientRect().width), horizontal: e.scrollWidth - e.clientWidth, vertical: e.scrollHeight - e.clientHeight };
  });
  const rows = s.profile.width >= 900 ? s.profile.height <= 520 ? 2 : 4 : s.profile.width < 600 && s.profile.height <= 720 ? 1 : s.profile.width < 600 || s.profile.height <= 480 ? 2 : 1;
  check(s, 'wallet-tab-rows', rows, tabs, tabs.rows === rows && tabs.horizontal <= 1 && tabs.vertical <= 1);
  await reachability(s, '#wtab-slots', 'slots');
  await capture(s, 'wallet-slots');
  await click(s, '#wtab-btn-cases');
  await scrolling(s, '.gf-wallet-panel', 'wallet-cases');
  await click(s, '#wtab-btn-skins');
  await scrolling(s, '.gf-wallet-panel', 'wallet-skins');
  await reachability(s, '#wtab-skins', 'skins');
  await click(s, '#wtab-btn-withdraw');
  await scrolling(s, '.gf-wallet-panel', 'wallet-withdraw');
  const input = await s.frame.locator('#input-withdraw-amount').evaluate(e => {
    const r = e.getBoundingClientRect(), parent = e.parentElement!.getBoundingClientRect(), css = getComputedStyle(e);
    return { width: r.width, parentWidth: parent.width, height: r.height, background: css.backgroundColor, color: css.color, font: css.fontSize, borderRadius: css.borderRadius };
  });
  check(s, 'withdraw-input-style', 'Темное поле, ширина >=70% контейнера, высота >=44', input, input.background !== 'rgb(255, 255, 255)' && input.background !== 'rgba(0, 0, 0, 0)' && input.width >= input.parentWidth * .7 && input.height >= 44);
  const calc = await s.frame.evaluate(() => [...document.querySelectorAll<HTMLElement>('.gf-calc-row')].map(row => {
    const label = row.querySelector('span')!.getBoundingClientRect(), value = row.querySelector('b')!.getBoundingClientRect();
    return { text: row.textContent, display: getComputedStyle(row).display, gap: value.left - label.right, stacked: value.top >= label.bottom - 1 };
  }));
  check(s, 'withdraw-calculation-layout', 'Расчётные строки разделены промежутком >=6px или перенесены на новую строку', calc, calc.length === 4 && calc.every(r => r.gap >= 6 || r.stacked));
  const limits = await s.frame.locator('#input-withdraw-amount').evaluate(e => ({ min: (e as HTMLInputElement).min, max: (e as HTMLInputElement).max, step: (e as HTMLInputElement).step }));
  check(s, 'withdraw-contract-limits', { min: '1', max: '1000000', step: '1' }, limits, limits.min === '1' && limits.max === '1000000' && limits.step === '1');
  await reachability(s, '#wtab-withdraw', 'withdraw');
  await capture(s, 'withdraw-form');
}

async function focus(s: Session): Promise<void> {
  const debugBefore = await s.frame.evaluate(() => document.getElementById('debug')!.hidden);
  await s.page.keyboard.press('F3');
  const debugAfter = await s.frame.evaluate(() => document.getElementById('debug')!.hidden);
  check(s, 'wallet-F3-isolated', debugBefore, debugAfter, debugBefore === debugAfter);
  await s.frame.locator('#btn-wallet-close').focus();
  const order = await s.frame.evaluate(() => [...document.querySelectorAll<HTMLElement>('#wallet-modal button,#wallet-modal input,[tabindex]')].filter(e => e.closest('#wallet-modal') && e.checkVisibility() && !e.hasAttribute('disabled') && e.tabIndex >= 0).map(e => e.id));
  const records: { direction: string; expected: string; id: string; inside: boolean; dashboard: boolean }[] = [];
  let current = order.indexOf('btn-wallet-close');
  for (const direction of ['Tab', 'Shift+Tab']) for (let i = 0; i < order.length + 2; i++) {
    current = (current + (direction === 'Tab' ? 1 : -1) + order.length) % order.length;
    await s.page.keyboard.press(direction);
    const observed = await s.frame.evaluate(direction => ({ direction, id: document.activeElement?.id ?? '', inside: !!document.activeElement?.closest('#wallet-modal'), dashboard: !document.getElementById('tab-modal')!.hidden }), direction);
    records.push({ ...observed, expected: order[current]! });
  }
  check(s, 'wallet-focus-trap', { inside: true, dashboard: false, forwardAndReverseSteps: 2 * (order.length + 2), order }, records, records.length > 8 && records.every(r => r.inside && !r.dashboard && r.id === r.expected));
  await s.frame.locator('#btn-withdraw-max').focus();
  await s.page.keyboard.press('Space');
  const max = await s.frame.locator('#input-withdraw-amount').inputValue();
  const balance = await s.frame.evaluate(() => (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getBalance());
  check(s, 'wallet-Space-Max', String(balance), max, max === String(balance));
  await s.frame.locator('#input-withdraw-amount').fill('25');
  await s.page.keyboard.press('ControlOrMeta+A');
  await s.page.keyboard.type('27');
  const selected = await s.frame.locator('#input-withdraw-amount').inputValue();
  check(s, 'wallet-Ctrl-A-input', '27', selected, selected === '27');
  await s.page.keyboard.press('ArrowUp');
  const stepped = await s.frame.locator('#input-withdraw-amount').inputValue();
  check(s, 'wallet-ArrowUp-input', '28', stepped, stepped === '28');
  await s.frame.locator('#input-withdraw-amount').fill('50');
  await capture(s, 'withdraw-focus');
  // Escape только закрывает кошелёк, а игровое удержание Tab остаётся самостоятельным.
  await s.frame.locator('#btn-wallet-close').focus();
  await s.page.keyboard.press('Escape');
  check(s, 'wallet-Escape', true, await s.frame.locator('#wallet-modal').isHidden(), await s.frame.locator('#wallet-modal').isHidden());
  const menuRestore = await s.frame.evaluate(() => ({ menu: !document.getElementById('menu')!.hidden, focus: document.activeElement?.id }));
  check(s, 'wallet-menu-origin-restore', { menu: true, focus: 'btn-menu-wallet' }, menuRestore, menuRestore.menu && menuRestore.focus === 'btn-menu-wallet');
  if (await s.frame.locator('#menu').isVisible()) await click(s, '#btn-resume');
  const resumedFeedback = await feedbackState(s);
  check(s, 'resume-feedback-visibility', 'visible после закрытия паузы', resumedFeedback.visibility, resumedFeedback.visibility === 'visible');
  await click(s, '#btn-wallet');
  await s.frame.locator('#wallet-modal').waitFor({ state: 'visible' });
  await s.page.keyboard.press('Escape');
  const restored = await s.frame.evaluate(() => ({ id: document.activeElement?.id, walletHidden: document.getElementById('wallet-modal')!.hidden }));
  check(s, 'wallet-focus-restore', 'btn-wallet', restored, restored.id === 'btn-wallet' && restored.walletHidden === true);
  if (await s.frame.locator('#menu').isVisible()) await click(s, '#btn-resume');
  // Захват мыши не влияет на keydown/keyup: не кликаем canvas абсолютными координатами.
  await s.page.keyboard.down('Tab');
  await s.page.waitForTimeout(150);
  const down = await s.frame.locator('#tab-modal').isVisible();
  await s.page.keyboard.up('Tab');
  const up = await s.frame.locator('#tab-modal').isHidden();
  check(s, 'gameplay-Tab-hold', { down: true, up: true }, { down, up }, down && up);
  await s.page.waitForTimeout(300); // Дать завершиться штатному возврату pointer lock.
}

async function slotState(s: Session) {
  return s.frame.evaluate(() => ({
    panel: (() => { const r = document.querySelector('.gf-wallet-panel')!.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
    time: performance.now(),
    walletVisible: !document.getElementById('wallet-modal')!.hidden,
    balance: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getBalance(),
    visible: Number(document.getElementById('wallet-balance-num')!.textContent!.replace(/[^\d.-]/g, '')),
    count: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getWalletState().transactions.length,
    status: document.getElementById('slot-status')!.textContent,
    blurred: document.querySelectorAll('.gf-reel-strip--blur').length,
    disabled: (document.getElementById('btn-slot-spin') as HTMLButtonElement).disabled,
    expensiveDisabled: ['btn-slot-spin', 'btn-open-case', 'btn-exec-withdraw'].map(id => (document.getElementById(id) as HTMLButtonElement).disabled),
    transforms: ['reel-strip-1', 'reel-strip-2', 'reel-strip-3'].map(id => new DOMMatrixReadOnly(getComputedStyle(document.getElementById(id)!).transform).m42),
    animations: ['reel-strip-1', 'reel-strip-2', 'reel-strip-3'].flatMap(id => document.getElementById(id)!.getAnimations().map(a => ({ id, state: a.playState, pending: a.pending, time: a.currentTime }))),
  }));
}

async function slots(s: Session, deterministic = false): Promise<void> {
  await walletOpen(s);
  await click(s, '#wtab-btn-slots');
  if (deterministic) await s.frame.evaluate(() => {
    const wallet = (globalThis as InstrumentedWindow).__SW_UI__.walletManager;
    const original = wallet.playSlots.bind(wallet);
    wallet.playSlots = () => {
      const random = crypto.getRandomValues.bind(crypto), now = Date.now;
      try {
        crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
          if (!array) return array;
          const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
          bytes.fill(0); if (bytes.length === 16) bytes[3] = 11;
          return array;
        });
        Date.now = () => 1700000000000;
        return original();
      } finally { crypto.getRandomValues = random; Date.now = now; wallet.playSlots = original; }
    };
  });
  const old = await slotState(s);
  await click(s, '#btn-slot-spin');
  const start = await slotState(s);
  if (!deterministic) await s.frame.waitForFunction(() => {
    const strip = document.getElementById('reel-strip-3')!;
    return (document.getElementById('btn-slot-spin') as HTMLButtonElement).disabled
      && Math.abs(new DOMMatrixReadOnly(getComputedStyle(strip).transform).m42) > .05;
  }, undefined, { timeout: 1800, polling: 'raf' });
  if (deterministic) {
    const balances = await s.frame.evaluate(() => ({
      hud: Number(document.getElementById('hud-gfc-val')!.textContent),
      fiat: Number(document.getElementById('wallet-fiat-num')!.textContent!.replace(/[^\d.-]/g, '')),
      price: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getMarket().getSpotPrice(),
    }));
    check(s, 'controlled-pending-HUD-fiat', { hud: 90, fiat: '90*spot округлённо до цента' }, balances, balances.hud === 90 && Math.abs(balances.fiat - balances.price * 90) <= .015);
    // Все ранние чтения выполняем одним заданием браузера: Playwright-клики могут
    // занять дольше спина на загруженном SwiftShader. Обработчики остаются настоящими.
    const early = await s.frame.evaluate(() => {
      document.getElementById('wtab-btn-withdraw')!.click();
      const input = document.getElementById('input-withdraw-amount') as HTMLInputElement;
      const previous = input.value;
      const maxButton = document.getElementById('btn-withdraw-max') as HTMLButtonElement;
      maxButton.click();
      const max = input.value;
      input.value = '121'; input.dispatchEvent(new Event('input', { bubbles: true }));
      const message = document.getElementById('withdraw-input-error')?.textContent ?? null;
      input.value = '100'; input.dispatchEvent(new Event('input', { bubbles: true }));
      return { max, previous, maxDisabled: maxButton.disabled, message, disabled: (document.getElementById('btn-exec-withdraw') as HTMLButtonElement).disabled };
    });
    const max = early.max;
    check(s, 'controlled-pending-withdraw-Max', 'Выключенная кнопка сохраняет поле; доступная показывает90', early,
      early.maxDisabled ? max === early.previous : max === '90');
    const message = early.message;
    check(s, 'controlled-pending-available-error', 'Ошибка содержит доступные90 и не раскрывает120', message, !!message && /\b90\b/.test(message) && !/\b120\b/.test(message));
    check(s, 'controlled-pending-valid100-disabled', true, early.disabled, early.disabled);
  }
  let mid;
  // Закрытие не прерывает уже совершённую операцию; повторное открытие её не повторяет.
  if (!deterministic) {
    await keyboardReopenWallet(s, 'slot');
    await s.frame.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    const reopened = await slotState(s);
    check(s, 'slot-reopen-pending', { visible: old.balance - 10, count: start.count, disabled: true, walletVisible: true }, reopened, reopened.visible === old.balance - 10 && reopened.count === start.count && reopened.disabled && reopened.walletVisible);
    await s.page.waitForTimeout(100);
    await s.frame.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    const moving = await slotState(s);
    mid = moving;
    const delta = moving.transforms.map((y, i) => y - reopened.transforms[i]!);
    check(s, 'slot-reopen-motion', '>0.02px движение хотя бы одного барабана за100ms', { from: reopened.transforms, to: moving.transforms, delta, elapsed: moving.time - start.time }, delta.some(d => Math.abs(d) > .02));
  } else { await s.page.waitForTimeout(650); mid = await slotState(s); }
  check(s, `${deterministic ? 'controlled-' : ''}slot-pending-balance`, old.balance - 10, { start, mid }, start.visible === old.balance - 10 && mid.visible === old.balance - 10);
  check(s, 'slot-animation-active', { disabled: true, blurred: '>0' }, { start, mid }, start.disabled && mid.disabled && start.blurred > 0 && mid.blurred > 0);
  check(s, 'slot-parallel-operations-blocked', [true, true, true], start.expensiveDisabled, start.expensiveDisabled.every(Boolean));
  if (deterministic) check(s, 'controlled-real-win', { payout: 30, finalBalance: 120 }, start.balance, start.balance === 120);
  await capture(s, deterministic ? 'controlled-slot-start' : 'slot-start');
  await s.frame.waitForFunction(() => !(document.getElementById('btn-slot-spin') as HTMLButtonElement).disabled, undefined, { timeout: 6000 });
  const end = await slotState(s);
  check(s, 'slot-end-balance', { visible: end.balance, count: start.count, blurred: 0 }, end, end.visible === end.balance && end.count === start.count && end.blurred === 0);
  check(s, 'slot-end-animation-stopped', 'Нет running/pending анимаций барабанов после результата', end.animations, end.animations.every(a => a.state !== 'running' && !a.pending));
  check(s, 'slot-stable-panel', old.panel, end.panel, end.panel.every((v, i) => Math.abs(v - old.panel[i]!) < 1));
  await scrolling(s, '.gf-wallet-panel', 'wallet-slot-result');
  if (deterministic) {
    const form = { value: await s.frame.locator('#input-withdraw-amount').inputValue(), disabled: await s.frame.locator('#btn-exec-withdraw').isDisabled() };
    check(s, 'controlled-post-stop-valid100-enabled', { value: '100', disabled: false }, form, form.value === '100' && !form.disabled);
    await click(s, '#wtab-btn-slots');
  }
  await capture(s, deterministic ? 'controlled-slot-end' : 'slot-end');
}

async function caseState(s: Session) {
  return s.frame.evaluate(() => {
    const box = document.getElementById('case-roulette-container')!.getBoundingClientRect();
    const cards = [...document.querySelectorAll<HTMLElement>('.gf-roulette-card')].map((e, i) => { const r = e.getBoundingClientRect(); return { index: i, text: e.querySelector('.gf-roulette-card-name')?.textContent, center: (r.left + r.right) / 2, visible: r.right > box.left + 1 && r.left < box.right - 1 && r.bottom > box.top && r.top < box.bottom }; });
    const winner = cards[32];
    return { time: performance.now(), visible: cards.filter(c => c.visible).length, cardCount: cards.length, winnerDelta: winner ? winner.center - (box.left + box.right) / 2 : null,
      panel: (() => { const r = document.querySelector('.gf-wallet-panel')!.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
      winnerTitle: winner?.text, resultTitle: document.getElementById('case-win-title')!.textContent,
      resultHidden: document.getElementById('case-result-display')!.hidden,
      disabled: (document.getElementById('btn-open-case') as HTMLButtonElement).disabled,
      expensiveDisabled: ['btn-slot-spin', 'btn-open-case', 'btn-exec-withdraw'].map(id => (document.getElementById(id) as HTMLButtonElement).disabled),
      transform: new DOMMatrixReadOnly(getComputedStyle(document.getElementById('case-roulette-track')!).transform).m41,
      target: new DOMMatrixReadOnly(document.getElementById('case-roulette-track')!.style.transform || 'none').m41,
      animations: document.getElementById('case-roulette-track')!.getAnimations().map(a => ({ state: a.playState, pending: a.pending, time: a.currentTime })),
      opening: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getCaseOpening?.(),
      balance: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getBalance(), count: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getWalletState().transactions.length };
  });
}

async function resize(s: Session, width: number): Promise<void> {
  if (s.profile.parent) await s.page.locator('iframe').evaluate((e, width) => { (e as HTMLIFrameElement).style.width = `${width}px`; }, width);
  else await s.page.setViewportSize({ width, height: s.profile.height });
  await s.frame.waitForFunction(width => innerWidth === width, width);
  await s.page.waitForTimeout(100);
  await s.frame.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function cases(s: Session): Promise<void> {
  await click(s, '#wtab-btn-cases');
  const idle = await caseState(s);
  check(s, 'case-idle-cards', '>0 видимых карточек', idle, idle.visible > 0);
  await capture(s, 'case-idle');
  await click(s, '#btn-open-case');
  const start = await caseState(s);
  await capture(s, 'case-start');
  await s.page.waitForTimeout(900);
  const mid = await caseState(s);
  check(s, 'case-moving-cards', '>0 видимых start/mid карточек; повтор заблокирован', { start, mid }, start.visible > 0 && mid.visible > 0 && start.disabled && mid.disabled);
  check(s, 'case-parallel-operations-blocked', [true, true, true], start.expensiveDisabled, start.expensiveDisabled.every(Boolean));
  await capture(s, 'case-mid');
  // Проверяем повторное открытие до дорогого resize 4K → 420 px. На SwiftShader
  // сама перестройка может занять остаток штатного спина; после неё законно видеть
  // уже выданный результат вместо продолжающегося движения.
  await keyboardReopenWallet(s, 'case');
  const reopened = await caseState(s);
  check(s, 'case-reopen-no-duplicate', { count: start.count, balance: start.balance, disabled: true }, reopened, reopened.count === start.count && reopened.balance === start.balance && reopened.disabled);
  await s.page.waitForTimeout(100);
  const moving = await caseState(s);
  check(s, 'case-reopen-motion', '|delta|>0.02px за100ms', { from: reopened.transform, to: moving.transform }, Math.abs(moving.transform - reopened.transform) > .02);
  if (s.run.side === 'after') {
    await click(s, '#wtab-btn-skins');
    const inOtherTab = await caseState(s);
    check(s, 'case-other-tab-pending', { hidden: true, revealed: false, count: start.count }, inOtherTab,
      inOtherTab.resultHidden && inOtherTab.opening?.revealed === false && inOtherTab.count === start.count);
    await click(s, '#wtab-btn-cases');
  }
  await resize(s, Math.max(320, Math.min(420, s.profile.width - 60)));
  await s.frame.waitForFunction(() => !document.getElementById('case-result-display')!.hidden, undefined, { timeout: 7000 });
  const end = await caseState(s);
  check(s, 'case-end-cards', '>0 видимых карточек', end, end.visible > 0);
  check(s, 'case-end-animation-stopped', 'Нет running/pending анимации после результата', end.animations, end.animations.every(a => a.state !== 'running' && !a.pending));
  check(s, 'case-winner-marker', '|delta| <=21px, title соответствует карточке32', end, end.winnerDelta !== null && Math.abs(end.winnerDelta) <= 21 && end.winnerTitle === end.resultTitle);
  const compensation = end.opening?.compensationGfc ?? 0;
  check(s, 'case-debit-before-award', { balance: idle.balance - 50, count: idle.count + 1, revealed: false }, start, start.balance === idle.balance - 50 && start.count === idle.count + 1 && start.opening?.revealed === false);
  check(s, 'case-end-one-award', { balance: idle.balance - 50 + compensation, count: start.count + 1, revealed: true }, end, end.balance === idle.balance - 50 + compensation && end.count === start.count + 1 && end.opening?.revealed === true);
  await resize(s, s.profile.width);
  const restoredSize = await caseState(s);
  check(s, 'case-stable-panel', idle.panel, restoredSize.panel, restoredSize.panel.every((v, i) => Math.abs(v - idle.panel[i]!) < 1));
  await scrolling(s, '.gf-wallet-panel', 'wallet-case-result');
  check(s, 'case-post-resize-winner-marker', '|delta|<=21px после возврата размера', restoredSize, restoredSize.winnerDelta !== null && Math.abs(restoredSize.winnerDelta) <= 21);
  await capture(s, 'case-end');
  await click(s, '#btn-wallet-close');
  await walletOpen(s);
  const retained = await caseState(s);
  check(s, 'case-result-retained', { title: end.resultTitle, hidden: false, count: end.count }, retained, !retained.resultHidden && retained.resultTitle === end.resultTitle && retained.count === end.count);
  await click(s, '#btn-case-equip');
  const equipped = await s.frame.evaluate(() => (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getEquippedSkin()?.name);
  check(s, 'case-equip-result', end.resultTitle, equipped, equipped === end.resultTitle);
}

async function withdraw(s: Session): Promise<void> {
  await click(s, '#wtab-btn-withdraw');
  const old = await slotState(s);
  await s.frame.locator('#input-withdraw-amount').fill('-1');
  const before = await s.frame.evaluate(() => (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getWalletState().transactions.length);
  if (await s.frame.locator('#btn-exec-withdraw').isEnabled()) await click(s, '#btn-exec-withdraw');
  await s.page.waitForTimeout(150);
  const invalid = await s.frame.evaluate(() => ({ disabled: (document.getElementById('btn-exec-withdraw') as HTMLButtonElement).disabled,
    signing: !document.getElementById('withdraw-status-box')!.hidden && /[123]\/3|Подпис|Валидация/.test(document.getElementById('withdraw-status-text')!.textContent ?? ''),
    count: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getWalletState().transactions.length,
    balance: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getBalance() }));
  check(s, 'withdraw-invalid-early', { signing: false, count: before, balance: old.balance }, invalid, !invalid.signing && invalid.count === before && invalid.balance === old.balance);
  // У исходной версии отрицательное значение проходит в имитацию подписания.
  if (invalid.signing) {
    await s.page.waitForTimeout(1800);
    if (await s.frame.locator('#btn-receipt-new').isVisible()) await click(s, '#btn-receipt-new');
  }
  for (const value of ['0', '', '1.5', '1000001']) {
    const state = await slotState(s);
    await s.frame.locator('#input-withdraw-amount').fill(value);
    const validation = await s.frame.evaluate(() => ({
      disabled: (document.getElementById('btn-exec-withdraw') as HTMLButtonElement).disabled,
      error: document.getElementById('withdraw-input-error')?.textContent?.trim() ?? '',
      errorVisible: document.getElementById('withdraw-input-error')?.checkVisibility() ?? false,
      count: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getWalletState().transactions.length,
      balance: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getBalance(),
    }));
    check(s, `withdraw-invalid-input-${value || 'empty'}`, 'Непустая видимая ошибка или выключенная кнопка до операции', validation, validation.disabled || (validation.errorVisible && validation.error.length > 0));
    check(s, `withdraw-invalid-unchanged-${value || 'empty'}`, { count: state.count, balance: state.balance }, validation, validation.count === state.count && validation.balance === state.balance);
    await scrolling(s, '.gf-wallet-panel', 'wallet-invalid-' + (value || 'empty'));
  }
  await s.frame.locator('#input-withdraw-amount').fill('10');
  const faultOld = await slotState(s);
  await s.frame.evaluate(() => {
    const wallet = (globalThis as InstrumentedWindow).__SW_UI__.walletManager;
    Object.assign(globalThis, { __SW_LIVE_WITHDRAW__: wallet.executeWithdrawal.bind(wallet) });
    wallet.executeWithdrawal = () => ({ success: false, error: 'Проверочный отказ' });
  });
  try {
    await click(s, '#btn-exec-withdraw');
    await s.frame.waitForFunction(() => !(document.getElementById('btn-exec-withdraw') as HTMLButtonElement).disabled, undefined, { timeout: 7000 });
    const fault = await s.frame.evaluate(() => ({ message: document.getElementById('withdraw-status-text')!.textContent,
      visible: !document.getElementById('withdraw-status-box')!.hidden,
      count: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getWalletState().transactions.length,
      balance: (globalThis as InstrumentedWindow).__SW_UI__.walletManager.getBalance() }));
    check(s, 'withdraw-injected-failure', { message: 'Проверочный отказ', visible: true, count: faultOld.count, balance: faultOld.balance }, fault,
      fault.visible && !!fault.message?.includes('Проверочный отказ') && fault.count === faultOld.count && fault.balance === faultOld.balance);
  } finally {
    await s.frame.evaluate(() => {
      const scratch = globalThis as InstrumentedWindow & { __SW_LIVE_WITHDRAW__?: Wallet['executeWithdrawal'] };
      if (scratch.__SW_LIVE_WITHDRAW__) scratch.__SW_UI__.walletManager.executeWithdrawal = scratch.__SW_LIVE_WITHDRAW__;
      delete scratch.__SW_LIVE_WITHDRAW__;
    });
  }
  if (await s.frame.locator('#btn-exec-withdraw').isEnabled()) await click(s, '#btn-exec-withdraw');
  else throw new Error('Корректная сумма10 не разблокировала кнопку');
  await s.page.waitForTimeout(150);
  await scrolling(s, '.gf-wallet-panel', 'wallet-withdraw-progress');
  await capture(s, 'withdraw-progress');
  await s.frame.locator('#withdraw-receipt-card').waitFor({ state: 'visible', timeout: 7000 });
  const receipt = await s.frame.evaluate(() => {
    const button = document.getElementById('btn-receipt-new')!.getBoundingClientRect();
    const text = document.querySelector<HTMLElement>('#withdraw-receipt-card .gf-parody-disclaimer')!.getBoundingClientRect();
    return { gap: text.top - button.bottom, buttonBottom: button.bottom, textTop: text.top };
  });
  check(s, 'receipt-disclaimer-gap', '>=8px после border-box кнопки', receipt, receipt.gap >= 8);
  await scrolling(s, '.gf-wallet-panel', 'wallet-receipt');
  await reachability(s, '#wallet-modal', 'receipt-and-header');
  await capture(s, 'withdraw-receipt');
  await click(s, '#btn-receipt-new');
  check(s, 'receipt-return-form', true, await s.frame.locator('#withdraw-form-card').isVisible(), await s.frame.locator('#withdraw-form-card').isVisible());
}

async function caseReload(s: Session): Promise<void> {
  await walletOpen(s);
  await click(s, '#wtab-btn-cases');
  const idle = await caseState(s);
  await click(s, '#btn-open-case');
  const pending = await caseState(s);
  await s.page.reload();
  await s.frame.waitForFunction(() => !!(globalThis as InstrumentedWindow).__SW_UI__);
  await walletOpen(s);
  await click(s, '#wtab-btn-cases');
  const resumed = await caseState(s);
  check(s, 'case-reload-pending', { count: pending.count, balance: pending.balance, skin: pending.opening?.skin.id }, resumed,
    resumed.count === pending.count && resumed.balance === pending.balance && resumed.opening?.skin.id === pending.opening?.skin.id && resumed.disabled);
  await s.frame.waitForFunction(() => !document.getElementById('case-result-display')!.hidden, undefined, { timeout: 7000 });
  const end = await caseState(s);
  check(s, 'case-reload-one-award', { count: idle.count + 2, balance: idle.balance - 50 + (end.opening?.compensationGfc ?? 0) }, end,
    end.count === idle.count + 2 && end.opening?.revealed === true && end.balance === idle.balance - 50 + (end.opening?.compensationGfc ?? 0));
  await s.page.reload();
  await s.frame.waitForFunction(() => !!(globalThis as InstrumentedWindow).__SW_UI__);
  await walletOpen(s);
  await click(s, '#wtab-btn-cases');
  const retained = await caseState(s);
  check(s, 'case-reload-complete-idempotent', { count: end.count, balance: end.balance, title: end.resultTitle }, retained,
    retained.count === end.count && retained.balance === end.balance && retained.resultTitle === end.resultTitle && !retained.resultHidden);
  await scrolling(s, '.gf-wallet-panel', 'wallet-case-reload');
  await capture(s, 'case-reload');
}

export async function runLiveChecks(): Promise<number> {
  const evidence = gameEvidence('live.ts');
  mkdirSync(LIVE, { recursive: true });
  const snapshot = Object.fromEntries(['before', 'after'].map(side => [side, JSON.parse(readFileSync(join(OUT, side, 'snapshot.json'), 'utf8')) as Record<string, unknown>]));
  const hashes = Object.fromEntries(['before', 'after'].map(side => [side, createHash('sha256').update(readFileSync(join(OUT, side, 'index.html'))).digest('hex')]));
  const runnerHash = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  for (const side of ['before', 'after']) if (hashes[side] !== snapshot[side]?.hash) throw new Error(`${side}: HTML отличается от записанного snapshot hash`);
  const pending = JSON.stringify({ status: 'running', complete: false, failed: null, startedAt: new Date().toISOString(), snapshots: snapshot, hashes }, null, 2);
  writeFileSync(join(LIVE, 'live-report.json'), pending);
  writeFileSync(join(OUT, 'live-report.json'), pending);
  const servers = await startComparison();
  let browser: Browser | undefined;
  const runs: Run[] = [];
  const profiles: Profile[] = [...PROFILES, ...IFRAME_PROFILES];
  const selected = (process.env.GF_UI_PROFILES ?? process.env.SW_UI_PROFILES)?.split(',');
  const chosen = selected ? profiles.filter(p => selected.includes(p.id)) : profiles;
  if (!chosen.length) { await servers.close(); throw new Error('Неизвестный SW_UI_PROFILES'); }
  let fatal: string | undefined;
  const checkpoint = () => writeFileSync(join(LIVE, 'checkpoint.json'), JSON.stringify({ status: 'running', complete: false,
    updatedAt: new Date().toISOString(), snapshots: snapshot, hashes, runnerHash, runs,
    failed: runs.filter(r => r.side === 'after').flatMap(r => r.checks).filter(c => !c.passed).length }, null, 2));
  try {
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'], executablePath: process.env.GF_CHROMIUM_PATH || undefined });
    for (const profile of chosen) for (const side of ['before', 'after'] as const) {
      let s: Session | undefined;
      try {
        s = await open(browser, servers[side], side, profile);
        runs.push(s.run);
        for (const [name, action] of [['layout', layouts], ['focus-Tab', focus], ['slots', slots], ['cases', cases], ['withdraw', withdraw]] as const) {
          try { await action(s); }
          catch (error) { check(s, name + '-completed', 'Сценарий завершён', String(error), false); await capture(s, name + '-failure').catch(() => {}); }
        }
        check(s, 'browser-errors', [], s.run.runtime, s.run.runtime.length === 0);
        s.run.video = await s.page.video()?.path();
      } catch (error) { runs.push({ side, profile: profile.id, checks: [{ id: 'startup', expected: 'Игра запущена', actual: String(error), passed: false }], runtime: [], screenshots: [] }); }
      finally { await s?.context.close(); }
      console.log(`live ${side}/${profile.id}: ${runs.filter(r => r.side === side && r.profile === profile.id).flatMap(r => r.checks).filter(c => !c.passed).length} нарушений`);
      if (side === 'after') {
        const failures = runs.filter(r => r.side === side && r.profile === profile.id).flatMap(r => r.checks).filter(c => !c.passed);
        if (failures.length) console.log(JSON.stringify({ profile: profile.id, failures }));
      }
      checkpoint();
    }
    // Эта проба не подменяет payout/manager: она задаёт вход реальному казино на один вызов.
    const fullhd = profiles.find(p => p.id === 'fullhd')!;
    for (const side of ['before', 'after'] as const) {
      const s = await open(browser, servers[side], side, fullhd);
      s.run.profile = 'controlled-win-fullhd';
      runs.push(s.run);
      try { await slots(s, true); }
      catch (error) { check(s, 'controlled-win-completed', 'Завершён', String(error), false); }
      finally { check(s, 'browser-errors', [], s.run.runtime, s.run.runtime.length === 0); await s.context.close(); }
      if (side === 'after') {
        const failures = s.run.checks.filter(c => !c.passed);
        if (failures.length) console.log(JSON.stringify({ profile: s.run.profile, failures }));
      }
      checkpoint();
    }
    for (const profile of PROFILES.filter(p => ['phone-portrait', 'phone-landscape', 'fullhd'].includes(p.id))) {
      const s = await open(browser, servers.after, 'after', profile);
      s.run.profile = 'reload-' + profile.id;
      runs.push(s.run);
      try { await caseReload(s); }
      catch (error) { check(s, 'case-reload-completed', 'Завершён', String(error), false); await capture(s, 'case-reload-failure'); }
      finally { check(s, 'browser-errors', [], s.run.runtime, s.run.runtime.length === 0); await s.context.close(); }
      console.log(`live ${s.run.profile}: ${s.run.checks.filter(c => !c.passed).length} нарушений`);
      checkpoint();
    }
  } catch (error) { fatal = String(error); }
  finally { await browser?.close(); await servers.close(); }
  const finalHashes = Object.fromEntries(['before', 'after'].map(side => [side, createHash('sha256').update(readFileSync(join(OUT, side, 'index.html'))).digest('hex')]));
  if (['before', 'after'].some(side => finalHashes[side] !== hashes[side])) fatal = 'HTML сменился во время live-прогона; результаты не принимаются для этой сборки';
  const finalRunnerHash = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  if (finalRunnerHash !== runnerHash) fatal = 'live.ts сменился во время прогона; повтори проверку одним неизменным runner';
  if (JSON.stringify(evidence) !== JSON.stringify(gameEvidence('live.ts'))) fatal = 'Сборка или общие входы инструмента изменились во время live';
  const failed = runs.filter(r => r.side === 'after').flatMap(r => r.checks).filter(c => !c.passed).length;
  const report = {
    generatedAt: new Date().toISOString(), complete: chosen.length === profiles.length && !fatal,
    status: fatal ? 'interrupted' : 'finished', fatal, snapshots: snapshot, evidence, hashes, finalHashes, runnerHash, finalRunnerHash, browser: browser?.version(), profiles: chosen, runs, failed,
    controlledInput: { scope: 'Только синхронный wallet.playSlots в controlled-win-fullhd', seed: '0000000b000000000000000000000000', now: 1700000000000, nonce: 1, payout: 30, restore: 'crypto/Date восстановлены до первого кадра анимации; playSlots не заменяет результат' },
    limitations: ['Chromium; реальные устройства и Safari не проверены', 'Оболочка iframe не является хабом и не проверяет авторизацию/bridge', 'Вся основная матрица использует живые RNG/Date/rAF/CSS; редкий выигрыш имеет отдельную управляемую входную пробу', 'Проверки онлайн-экономики и серверных подписей входят в следующий шаг', 'Исходные ошибки before информационные; exit code зависит только от after и прерывания'],
  };
  writeFileSync(join(LIVE, 'live-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, 'live-report.json'), JSON.stringify(report, null, 2));
  console.log(`Live UI ${report.complete ? 'полный' : 'ЧАСТИЧНЫЙ'}: ${failed || fatal ? 'НЕ ПРОШЛО' : 'ПРОШЛО'}; after ошибок ${failed}; ${join(LIVE, 'live-report.json')}`);
  return failed || fatal ? 1 : 0;
}
