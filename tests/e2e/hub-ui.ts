// Короткий CI smoke на настоящем Next. Образцы UI не подменяют этот проход.
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';

/** Исполняется внутри браузера; проверяет отрисованные границы, а не только overflow страницы. */
export function catalogGeometry() {
  const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height, right: r.right, bottom: r.bottom + scrollY }; };
  const overlap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => Math.min(a.right, b.right) > Math.max(a.x, b.x) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y) + 1;
  const inside = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
  const issues: string[] = [];
  const cards = [...document.querySelectorAll<HTMLElement>('.gf-catalog .gf-card')];
  for (const card of cards) {
    const box = rect(card), cover = card.querySelector<HTMLElement>('.gf-card__cover')!, image = cover.querySelector('img'), frame = rect(cover);
    if (Math.abs(frame.width / frame.height - 16 / 9) > .01) issues.push('Рамка не 16:9');
    if (!inside(frame, box)) issues.push('Обложка вне карточки');
    if (image) {
      const r = rect(image), style = getComputedStyle(image);
      if (style.objectFit !== 'contain') issues.push('Обложка обрезается/искажается');
      if (Math.abs(r.x - frame.x) > 1 || Math.abs(r.y - frame.y) > 1 || Math.abs(r.width - frame.width) > 1 || Math.abs(r.height - frame.height) > 1 || style.transform !== 'none' || style.objectPosition !== '50% 50%') issues.push('Изображение не совпадает с полной рамкой');
      // Проверяем область, в которой contain рисует исходник с любыми пропорциями.
      if (image.complete && image.naturalWidth && image.naturalHeight) {
        const scale = Math.min(r.width / image.naturalWidth, r.height / image.naturalHeight);
        const w = scale * image.naturalWidth, h = scale * image.naturalHeight;
        const painted = { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, right: r.x + (r.width + w) / 2, bottom: r.y + (r.height + h) / 2, width: w, height: h };
        for (let ancestor = image.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
          const css = getComputedStyle(ancestor), bounds = rect(ancestor);
          if (/(hidden|clip|auto|scroll)/.test(css.overflowX) && (painted.x < bounds.x - 1 || painted.right > bounds.right + 1)) issues.push('Исходник обрезан предком по X');
          if (/(hidden|clip|auto|scroll)/.test(css.overflowY) && (painted.y < bounds.y - 1 || painted.bottom > bounds.bottom + 1)) issues.push('Исходник обрезан предком по Y');
        }
      }
    }
    const actions = card.querySelector('.gf-card__actions')!, tags = card.querySelector('.gf-game-tags');
    if (tags) {
      const row = rect(tags);
      if (!inside(row, box) || overlap(row, rect(actions))) issues.push('Строка тегов вне карточки/пересекает действия');
      for (const chip of [...tags.children].filter(c => !c.matches('.gf-game-tags__probe'))) {
        const r = rect(chip);
        if (!inside(r, row) || !inside(r, box) || overlap(r, rect(actions))) issues.push('Тег обрезан или выпирает');
      }
    }
    const buttons = [...actions.querySelectorAll<HTMLElement>('a,button')];
    for (const button of buttons) {
      const r = rect(button);
      if (!inside(r, box)) issues.push('Кнопка вне карточки');
      if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) issues.push('Текст кнопки не помещается');
      for (const child of button.children) if (!inside(rect(child), r)) issues.push('Содержимое кнопки выходит за её границы');
      for (const node of button.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(node);
        for (const text of range.getClientRects()) if (text.left < r.x - 1 || text.right > r.right + 1 || text.top + scrollY < r.y - 1 || text.bottom + scrollY > r.bottom + 1) issues.push('Текст вне кнопки');
      }
    }
    for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) if (overlap(rect(buttons[i]!), rect(buttons[j]!))) issues.push('Hit areas пересекаются');
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('Горизонтальная прокрутка');
  return { issues, width: innerWidth, font: parseFloat(getComputedStyle(document.documentElement).fontSize), header: rect(document.querySelector('.gf-header')!), cards: cards.map(rect), columns: getComputedStyle(document.querySelector('.gf-catalog__grid')!).gridTemplateColumns.split(' ').length, coarse: matchMedia('(any-pointer: coarse)').matches };
}

export async function hubUiSmoke(browser: Browser, origin: string) {
  for (const [width, height] of [[314,844],[440,956],[844,390],[1920,920],[1920,1080],[2560,1280],[2560,1440],[3840,2160]] as const) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1100, isMobile: width < 1100, colorScheme: 'dark' });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(origin); await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(80);
      const geometry = await page.evaluate(catalogGeometry);
      assert.deepEqual(geometry.issues, []); assert.ok(geometry.cards.length >= 4);
      assert.deepEqual(await page.locator('.gf-catalog .gf-card__desc').evaluateAll(nodes => nodes.map(e => getComputedStyle(e).webkitLineClamp)), Array(geometry.cards.length).fill('3'));
      // В низких окнах длинное описание увеличивает естественную высоту ряда.
      // Плотность двух рядов сохраняем на опорных 1080p/1440p/2160p при штатном rem.
      if (width >= 1920 && height / geometry.font >= 67.5) assert.ok(Math.abs(geometry.cards.at(-1)!.bottom - (height - 2 * geometry.font)) < 1, 'Ряды каталога не помещаются');
      const before = JSON.stringify(geometry.cards);
      await page.evaluate(() => { Object.defineProperty(visualViewport!, 'height', { configurable: true, get: () => 500 }); visualViewport!.dispatchEvent(new Event('resize')); window.scrollTo(0, 80); });
      await page.waitForTimeout(60);
      const after = await page.evaluate(catalogGeometry);
      assert.deepEqual(after.issues, []);
      assert.equal(JSON.stringify(after.cards), before, 'Скачок от visualViewport');
      await page.evaluate(() => window.scrollTo(0, 0));
      if (width <= 440) {
        const trigger = page.getByRole('button', { name: 'Открыть меню' }); await trigger.click();
        await page.waitForFunction(() => document.querySelector('.gf-popup--drawer')?.getAttribute('data-state') === 'open');
        const drawer = page.locator('.gf-popup--drawer[open]');
        assert.equal(await drawer.evaluate(e => e.getBoundingClientRect().x), 70);
        assert.equal(await drawer.evaluate(e => getComputedStyle(e).borderRightWidth), '0px');
        await page.keyboard.press('Escape'); await page.waitForTimeout(70);
        assert.equal(await drawer.getAttribute('data-state'), 'closing', 'Нет выходной анимации');
        await page.waitForFunction(() => !document.querySelector('.gf-popup--drawer[open]'));
        assert.equal(await trigger.evaluate(e => document.activeElement === e), true);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
}
