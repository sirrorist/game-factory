// Chromium fullPage/captureBeyondViewport меняет media во время touch-съёмки.
// Снимаем настоящий viewport, а длинную touch-страницу собираем из обычных кадров без resize.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { ROOT } from '../../core/paths.ts';

const hubRequire = createRequire(join(ROOT, 'apps/hub/package.json'));
const nextRequire = createRequire(hubRequire.resolve('next/package.json'));
// sharp уже является зависимостью Next; новую зависимость инструмент не добавляет.
const sharp: (input: unknown) => { extract: (region: {left: number; top: number; width: number; height: number}) => { png: () => { toBuffer: () => Promise<Buffer> } }; composite: (tiles: {input: Buffer; top: number; left: number}[]) => { png: () => { toFile: (path: string) => Promise<unknown> } } } = nextRequire('sharp');

export async function captureHubPage(page: Page, path: string) {
  const measure = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), coarse: matchMedia('(any-pointer: coarse)').matches,
    cards: [...document.querySelectorAll('.gf-catalog .gf-card')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height]; }) }));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const before = await measure();
  const first = await page.screenshot({ path: path.replace('.png', '-viewport.png'), scale: 'css', animations: 'disabled' });
  if (!before.coarse || before.documentHeight <= before.height) {
    await page.screenshot({ path, fullPage: !before.coarse, scale: 'css', animations: 'disabled' });
  } else {
    const tiles: { input: Buffer; top: number; left: number }[] = [{ input: first, top: 0, left: 0 }];
    for (let y = before.height; y < before.documentHeight; y += before.height) {
      const actualY = await page.evaluate(top => { window.scrollTo({ top, behavior: 'instant' }); return scrollY; }, y);
      const frame = await page.screenshot({ scale: 'css', animations: 'disabled' });
      const offset = Math.round(y - actualY), height = Math.min(before.height - offset, before.documentHeight - y);
      if (height <= 0) throw new Error('Прокрутка не достигла следующего фрагмента');
      tiles.push({ input: await sharp(frame).extract({ left: 0, top: offset, width: before.width, height }).png().toBuffer(), top: y, left: 0 });
    }
    await sharp({ create: { width: before.width, height: before.documentHeight, channels: 4, background: '#00000000' } }).composite(tiles).png().toFile(path);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const after = await measure();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Съёмка изменила геометрию страницы');
  return { viewport: path.replace('.png', '-viewport.png').split('/').at(-1), method: before.coarse ? 'viewport tiles without resize' : 'viewport + fullPage', ...before };
}
