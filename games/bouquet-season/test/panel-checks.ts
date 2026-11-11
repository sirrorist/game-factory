import assert from 'node:assert/strict';
import type { Page } from 'playwright';

// При увеличенном тексте допустима прокрутка. Проверяем достижимость начала и конца
// каждого абзаца, а также реальные области кнопок, а не только ненулевой scrollHeight.
export async function checkPanelReading(page: Page): Promise<unknown> {
  // Clock теста подменяет RAF, но не нативный ResizeObserver drawer.
  // Читаем геометрию после настоящего layout-цикла, включая смену размера текста.
  await page.evaluate(()=>new Promise<void>(resolve=>{const observer=new ResizeObserver(()=>{observer.disconnect();resolve();});observer.observe(document.getElementById('panel-body')!);}));
  const result = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panel = document.getElementById('panel')!;
    const body = document.getElementById('panel-body')!;
    const content = panel.querySelector<HTMLElement>('.panel-content')!;
    const errors: string[] = [];
    const font = parseFloat(getComputedStyle(document.documentElement).fontSize);
    function inside(element: HTMLElement, bounds: DOMRect): boolean {
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), r = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
      }
      // Допуск - на сдвиг кнопки под курсором (translate -0.0625rem): указатель мог остаться над ней.
      const tolerance = 1 + font * 0.0625;
      return bounds.left >= left - tolerance && bounds.right <= right + tolerance && bounds.top >= top - tolerance && bounds.bottom <= bottom + tolerance;
    }
    const paragraphs = Array.from(panel.querySelectorAll<HTMLElement>('#panel-body p, #panel-body label')).filter(p => p.getClientRects().length);
    for (const element of paragraphs) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.trim()) texts.push(node as Text);
      for (const end of [false, true]) {
        const text = end ? texts.at(-1) : texts[0];
        if (!text) continue;
        element.scrollIntoView({ block: end ? 'end' : 'start', inline: 'nearest' });
        const range = document.createRange(), offset = end ? text.length - 1 : 0;
        range.setStart(text, offset); range.setEnd(text, offset + 1);
        if (!inside(element, range.getBoundingClientRect())) errors.push(`Текст ${end ? 'конец' : 'начало'}: ${element.textContent}`);
      }
    }
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).filter(b => b.getClientRects().length);
    for (const b of buttons) {
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = b.getBoundingClientRect();
      if (!inside(b, r) || !b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))) { const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); errors.push(`Кнопка недостижима: ${b.textContent} · в точке ${hit?.tagName}#${hit?.id}.${hit?.className}, rect=${[r.x, r.y, r.width, r.height].map(Math.round)}, внутри=${inside(b, r)}, scroll=${body.scrollTop}/${body.scrollHeight}/${body.clientHeight}, body=${Math.round(body.getBoundingClientRect().top)}..${Math.round(body.getBoundingClientRect().bottom)}, overflow=${body.dataset.overflow}`); }
      if (r.width < 3 * font - 1 || r.height < 3 * font - 1 || b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1) errors.push(`Размер кнопки: ${b.textContent}`);
    }
    // Новые модульные карточки должны переносить подписи между словами, а не буквами.
    const moduleLabels=panel.querySelectorAll(panel.dataset.screen==='object-modules'?'.order-card h3, .order-card button':'.object-module-summary h3, .object-module-summary button');
    let moduleWordsChecked=0;
    for(const element of moduleLabels){
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
      for(let node=walker.nextNode();node;node=walker.nextNode())for(const word of node.textContent!.matchAll(/[\p{L}\p{N}]+/gu)){
        const range=document.createRange();range.setStart(node,word.index!);range.setEnd(node,word.index!+word[0].length);
        if(new Set(Array.from(range.getClientRects(),r=>Math.round(r.top*10))).size>1)errors.push(`Слово разорвано: ${word[0]}`);
        moduleWordsChecked++;
      }
    }
    if (!body.clientHeight || !content.clientHeight) errors.push('Прокручиваемая область имеет нулевую высоту');
    // Окно прокрутки не обрывает содержимое молча: у края с продолжением есть data-overflow и маска.
    const scroller = body.dataset.scroll === 'all' ? body : content;
    const scrollMax = scroller.scrollHeight - scroller.clientHeight;
    const scrollTo = (value: number) => new Promise<void>(done => {
      if (Math.abs(scroller.scrollTop - value) < 1) { done(); return; }
      scroller.addEventListener('scroll', () => done(), { once: true }); scroller.scrollTop = value;
    });
    const masked = () => { const s = getComputedStyle(scroller); return (s.maskImage || s.webkitMaskImage || 'none') !== 'none'; };
    if (scrollMax > 2) {
      await scrollTo(0);
      if (!/bottom|both/.test(scroller.dataset.overflow ?? '') || !masked()) errors.push(`Нижний край без затухания: overflow=${scroller.dataset.overflow}, маска=${masked()}`);
      await scrollTo(scrollMax);
      if (!/top|both/.test(scroller.dataset.overflow ?? '') || !masked()) errors.push(`Верхний край без затухания: overflow=${scroller.dataset.overflow}, маска=${masked()}`);
    } else if (/top|bottom|both/.test(scroller.dataset.overflow ?? '')) errors.push(`Лишнее затухание без прокрутки: ${scroller.dataset.overflow}`);
    for (const e of [body, content, panel]) { e.scrollTop = 0; e.scrollLeft = 0; }
    return { errors, scrollMax, overflow: scroller.dataset.overflow, font, mode: body.dataset.scroll, paragraphs: paragraphs.length, buttons: buttons.length, moduleWordsChecked, bodyHeight: body.clientHeight, contentHeight: content.clientHeight };
  });
  assert.deepEqual(result.errors, [], JSON.stringify(result));
  return result;
}
