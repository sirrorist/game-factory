// Проверка компоновки реальных компонентов с примерами данных, не тест авторизации.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { captureHubPage } from './capture.ts';
import { trackCheck } from '../../core/report.ts';
import { OUT, startHubComparison, hubEvidence } from './preview.ts';
import { PROFILES } from '../../core/profiles.ts';
import { HUB_SCENES } from './config.ts';
import { treeHash } from '../../core/evidence.ts';

const servers = await startHubComparison();
const SHOTS = join(OUT, 'shots');
mkdirSync(SHOTS, { recursive: true });
const snapshots = hubEvidence('check.ts').snapshots;
const runnerHash = createHash('sha256').update(readFileSync(new URL('./check.ts', import.meta.url))).digest('hex');
const toolHash = () => hubEvidence('check.ts').toolHash;
const initialToolHash = toolHash();
const artifacts = () => ({ before: treeHash(join(OUT, 'before')), after: treeHash(join(OUT, 'after')) });
const initialArtifacts = artifacts();
const runs: { side: string; profile: string; theme: string; scene: string; errors: string[]; screenshot: string; geometry: unknown }[] = [];
const report = () => ({ complete: true, snapshots, runnerHash, toolHash: initialToolHash, artifacts: initialArtifacts, runs,
  failed: runs.filter(r => r.side === 'after').reduce((n, r) => n + r.errors.length, 0),
  limitations: ['Реальные UI-компоненты с отдельными образцами данных; auth/API этим прогоном не проверяются', 'Chromium и эмуляция, не физический телефон'] });
const progress = trackCheck(join(OUT, 'report.json'), report);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  for (const profile of PROFILES) for (const theme of ['dark', 'light'] as const) for (const side of ['before', 'after']) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height },
      hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: 1, colorScheme: theme });
    const page = await context.newPage();
    let runtime: string[] = [];
    page.on('pageerror', e => runtime.push(e.message));
    page.on('console', e => { if (e.type() === 'error') runtime.push(e.text()); });
    try {
      for (const scene of HUB_SCENES) {
        runtime = [];
        await page.goto(`${servers[side as 'before' | 'after']}/?scene=${scene.id}`);
        await page.locator(`html[data-hub-ui-ready="${scene.id}"]`).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(180);
        const errors = [...runtime];
        const geometry = await page.evaluate(() => {
          const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
          const h = document.querySelector('.gf-header')!;
          const controls = [...h.querySelectorAll<HTMLElement>('a,button')].filter(e => e.checkVisibility()).map(e => ({ name: e.getAttribute('aria-label') || e.textContent, ...rect(e) }));
          const overlaps: unknown[] = [];
          for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
            const a = controls[i]!, b = controls[j]!;
            if (Math.min(a.right, b.right) > Math.max(a.x, b.x) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y) + 1) overlaps.push({ a, b });
          }
          return { width: innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
            font: parseFloat(getComputedStyle(document.documentElement).fontSize), header: rect(h), controls, overlaps,
            thumb: getComputedStyle(document.documentElement, '::-webkit-scrollbar-thumb').backgroundColor,
            track: getComputedStyle(document.documentElement, '::-webkit-scrollbar-track').backgroundColor,
            tokenThumb: getComputedStyle(document.documentElement).getPropertyValue('--line-strong').trim() };
        });
        if (geometry.scrollWidth > geometry.width + 1) errors.push('Горизонтальная прокрутка страницы');
        if (geometry.overlaps.length) errors.push('Пересечение кнопок шапки');
        if (geometry.controls.some(c => c.x < -1 || c.right > geometry.width + 1 || c.y < -1 || c.bottom > geometry.header.bottom + 1)) errors.push('Кнопки вне шапки/экрана');
        if (side === 'after') {
          const expected = 16 * Math.max(1, profile.width / 1920);
          if (Math.abs(geometry.font - expected) > .02) errors.push('Неверный масштаб rem');
          if (geometry.thumb === 'rgba(0, 0, 0, 0)' || geometry.track === 'rgba(0, 0, 0, 0)') errors.push('Нет стиля скроллбара');
          if (profile.touch && geometry.controls.some(c => c.width < 47.5 || c.height < 47.5)) errors.push('Цель касания шапки меньше 48 px');
        }
        // Нативный скролл и клавиатурный фокус должны достигать нижнего содержимого.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        for (const control of await page.locator('button,a,input').all()) {
          if (!await control.isVisible() || !await control.isEnabled()) continue;
          await control.scrollIntoViewIfNeeded();
          const valid = await control.evaluate(e => {
            const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return !!hit && (hit === e || e.contains(hit));
          });
          if (!valid) errors.push('Недостижимый элемент: ' + (await control.getAttribute('aria-label') || (await control.textContent())?.trim().slice(0, 50)));
          if (side === 'after' && profile.touch && !await control.evaluate(e => !!e.closest('.gf-catalog .gf-card__actions') || e.matches('.gf-game-tags__more'))) {
            const size = await control.boundingBox();
            if (size && (size.width < 47.5 || size.height < 47.5)) errors.push('Цель касания меньше 48 px: ' + (await control.getAttribute('aria-label') || (await control.textContent())?.trim().slice(0, 50)));
          }
        }
        await page.evaluate(() => {
          for (const e of document.querySelectorAll<HTMLElement>('*')) { e.scrollLeft = 0; e.scrollTop = 0; }
          window.scrollTo(0, 0);
        });
        const screenshot = `${side}-${profile.id}-${theme}-${scene.id}.png`;
        const capture = await captureHubPage(page, join(SHOTS, screenshot));
        if (side === 'after' && scene.id === 'login') {
          await page.locator('input[name="email"]').fill('player@example.test');
          await page.locator('input[name="password"]').fill('ui-example-password');
          await page.locator('button[type="submit"]').click();
          await page.getByTestId('login-error').waitFor();
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) errors.push('Ошибка входа расширяет страницу');
        }
        if (side === 'after' && scene.id === 'account') {
          // Проба длинных текстов не подменяет авторизацию или данные настоящего аккаунта.
          await page.evaluate(() => {
            document.querySelector('h1')!.textContent = 'Игрок' + 'ОченьДлинноеИмя'.repeat(8);
            const email = document.querySelector('h1')!.nextElementSibling;
            if (email) email.textContent = 'long'.repeat(24) + '@example.test';
          });
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) errors.push('Длинное имя/почта расширяют страницу');
        }
        if (side === 'after' && ['login', 'account'].includes(scene.id)) await page.screenshot({ path: join(SHOTS, screenshot.replace('.png', '-probe.png')), fullPage: true, animations: 'disabled' });
        if (side === 'after' && scene.id === 'game') {
          const button = page.getByRole('button', { name: 'На весь экран', exact: true });
          if (await button.isVisible()) {
            await button.click();
            await page.waitForFunction(() => document.fullscreenElement !== null);
            await page.getByTestId('exit-fullscreen').waitFor();
            const fullscreen = await page.locator('#game').evaluate(e => {
              const r = e.getBoundingClientRect();
              return r.width >= innerWidth - 1 && r.height >= innerHeight - 1;
            });
            if (!fullscreen) errors.push('Игра не занимает полноэкранную оболочку');
            await page.getByTestId('exit-fullscreen').click();
            await page.waitForFunction(() => document.fullscreenElement === null);
          }
          const next = profile.touch ? { width: profile.height, height: profile.width } : { width: 2560, height: 1440 };
          await page.setViewportSize(next);
          await page.waitForTimeout(100);
          const resized = await page.evaluate(() => ({ font: parseFloat(getComputedStyle(document.documentElement).fontSize), width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth }));
          if (resized.scroll > resized.width + 1 || Math.abs(resized.font - 16 * Math.max(1, next.width / 1920)) > .02) errors.push('Resize без reload ломает размеры');
          await page.setViewportSize({ width: profile.width, height: profile.height });
        }
        errors.push(...runtime.filter(e => !errors.includes(e)));
        runs.push({ side, profile: profile.id, theme, scene: scene.id, errors, screenshot, geometry: { ...geometry, capture } });
        progress.checkpoint();
      }
    } finally { await context.close(); }
    console.log(`hub ${side}/${profile.id}/${theme}: ${runs.filter(r => r.side === side && r.profile === profile.id && r.theme === theme).flatMap(r => r.errors).length} нарушений`);
    progress.checkpoint();
  }
  const current = JSON.parse(readFileSync(join(OUT, 'after', 'snapshot.json'), 'utf8'));
  if (current.hash !== snapshots.after!.hash) throw new Error('Сборка сменилась во время прогона');
  if (toolHash() !== initialToolHash || JSON.stringify(artifacts()) !== JSON.stringify(initialArtifacts)) throw new Error('Инструмент или файлы сборки сменились во время прогона');
  progress.finish();
} catch (error) {
  progress.fail(error); throw error;
} finally {
  progress.close();
  try { await browser?.close(); } finally { await servers.close(); }
}
console.log(`Хаб: ${runs.length} состояний, ошибок after ${report().failed}`);
process.exitCode = report().failed ? 1 : 0;
