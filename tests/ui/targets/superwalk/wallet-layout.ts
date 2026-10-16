// Самодостаточная DOM-проверка: Playwright передаёт функцию в браузер целиком.
export function inspectWalletLayout() {
  const panel = document.querySelector<HTMLElement>('.gf-wallet-panel')!;
  const errors: string[] = [];
  const rect = (e: Pick<Element, 'getBoundingClientRect'>) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const visible = (e: HTMLElement) => e.checkVisibility() && e.getBoundingClientRect().width > 0;
  const inside = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
  const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
  const name = (e: HTMLElement) => e.id || e.className;
  const panelRect = rect(panel);
  if (Math.abs(panel.scrollTop) > 1 || Math.abs(panel.scrollLeft) > 1) errors.push('Панель кошелька неожиданно прокручена');
  const selectors = ['.gf-wallet-header', '.gf-wallet-sidebar', '.gf-wallet-balance-card', '.gf-wallet-tab-content', '.gf-withdraw-form', '.gf-withdraw-calc', '.gf-withdraw-message-slot', '.gf-receipt-card', '.gf-receipt-details'];
  const containers = selectors.flatMap(selector => [...panel.querySelectorAll<HTMLElement>(selector)]).filter(visible).map(e => {
    const r = rect(e), css = getComputedStyle(e);
    if (!inside(r, panelRect)) errors.push(`${name(e)} выходит за панель`);
    if (/hidden|clip/.test(css.overflowY) && e.scrollHeight > e.clientHeight + 2) errors.push(`${name(e)} скрывает вертикальное переполнение`);
    if (/hidden|clip/.test(css.overflowX) && e.scrollWidth > e.clientWidth + 2) errors.push(`${name(e)} скрывает горизонтальное переполнение`);
    return { name: name(e), rect: r, client: [e.clientWidth, e.clientHeight], scroll: [e.scrollWidth, e.scrollHeight], offset: [e.scrollLeft, e.scrollTop] };
  });
  if (panel.scrollHeight > panel.clientHeight + 2 || panel.scrollWidth > panel.clientWidth + 2) errors.push('Содержимое больше панели кошелька');
  const blocks: { name: string; rect: ReturnType<typeof rect> }[] = [];
  for (const selector of ['.gf-withdraw-form', '.gf-receipt-card']) {
    const scope = panel.querySelector<HTMLElement>(selector);
    if (!scope || !visible(scope)) continue;
    const children = [...scope.children].filter((e): e is HTMLElement => e instanceof HTMLElement && visible(e));
    for (const child of children) {
      const r = rect(child); blocks.push({ name: name(child), rect: r });
      if (!inside(r, rect(scope))) errors.push(`${name(child)} выходит за ${name(scope)}`);
      // Расчёт и сообщения могут рисовать текст за собственной нулевой строкой.
      for (const text of child.querySelectorAll<HTMLElement>('.gf-calc-row,.gf-calc-row span,.gf-calc-row b,.gf-receipt-row,.gf-receipt-row span,.gf-receipt-row b,p')) {
        if (visible(text) && !inside(rect(text), r)) errors.push(`${name(text)} выходит за ${name(child)}`);
      }
    }
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
      const a = children[i]!, b = children[j]!;
      if (overlaps(rect(a), rect(b))) errors.push(`${name(a)} перекрывает ${name(b)}`);
    }
  }
  const calc = panel.querySelector<HTMLElement>('.gf-withdraw-calc');
  if (calc && visible(calc)) for (const row of calc.children) {
    if (row instanceof HTMLElement && visible(row) && !inside(rect(row), rect(calc))) errors.push('Строка расчёта выходит за область расчёта');
  }
  const close = document.getElementById('btn-wallet-close')!;
  const c = rect(close), hit = document.elementFromPoint((c.left + c.right) / 2, (c.top + c.bottom) / 2);
  if (!inside(c, panelRect) || c.top < 0 || c.bottom > innerHeight || !hit || !(close === hit || close.contains(hit))) errors.push('Крестик кошелька недоступен без программной прокрутки');
  const number = document.getElementById('wallet-balance-num')!, currency = panel.querySelector('.gf-wallet-cur-badge')!;
  const range = document.createRange(); range.selectNodeContents(number);
  const glyphs = rect(range), unit = rect(currency);
  if (overlaps(glyphs, unit)) errors.push('Число баланса перекрывает единицу валюты');
  const card = panel.querySelector('.gf-wallet-balance-card')!;
  if (!inside(glyphs, rect(card)) || !inside(unit, rect(card))) errors.push('Баланс выходит за карточку');
  for (const text of card.querySelectorAll<HTMLElement>('.gf-wallet-sublabel,.gf-wallet-fiat-row > span')) {
    if (!visible(text)) continue;
    const textRange = document.createRange(); textRange.selectNodeContents(text);
    if (!inside(rect(textRange), rect(card))) errors.push('Подпись баланса выходит за карточку');
  }
  return { errors: [...new Set(errors)], panel: { rect: panelRect, scrollTop: panel.scrollTop, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight }, close: c, containers, blocks, balance: { text: number.textContent, glyphs, unit } };
}
