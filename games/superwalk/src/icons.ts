// Иконки дизайн-системы Game Factory (SVG в DOM кодом, без внешних файлов)
type Shape = string | { cx: number; cy: number; r: number };

const ICONS = {
  'play': { shapes: ['M7 5.5v13l11-6.5z'], px: [17, 3] },
  'fullscreen': { shapes: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'], px: [10.5, 10.5] },
  'exit-fullscreen': { shapes: ['M9 4v5H4', 'M20 9h-5V4', 'M15 20v-5h5', 'M4 15h5v5'], px: [10.5, 10.5] },
  'menu': { shapes: ['M4 7h16', 'M4 12h16', 'M4 17h10'], px: [17, 15.5] },
  'close': { shapes: ['M6 6l12 12', 'M18 6 6 18'], px: [10.5, 1] },
  'trophy': { shapes: ['M8 6h8v4a4 4 0 0 1-8 0z', 'M8 7.5H5.5a2.5 2.5 0 0 0 2.5 4', 'M16 7.5h2.5a2.5 2.5 0 0 1-2.5 4', 'M12 14v3.5', 'M10 17.5h4', 'M8.5 20.5h7'], px: [10.5, 1] },
} satisfies Record<string, { shapes: Shape[]; px: [number, number] }>;

export type IconName = keyof typeof ICONS;

const SVG = 'http://www.w3.org/2000/svg';

function isIcon(name: string): name is IconName {
  return Object.hasOwn(ICONS, name);
}

/** SVG иконки набора; размер задаёт CSS (класс gf-icon и правила кнопок). */
export function icon(name: IconName): SVGSVGElement {
  const { shapes, px } = ICONS[name];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', name === 'trophy' ? 'gf-icon gf-icon--coin' : 'gf-icon');
  for (const s of shapes) {
    const el = document.createElementNS(SVG, typeof s === 'string' ? 'path' : 'circle');
    if (typeof s === 'string') el.setAttribute('d', s);
    else for (const [k, v] of Object.entries(s)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  const dot = document.createElementNS(SVG, 'rect');
  for (const [k, v] of [['class', 'px'], ['x', px[0]], ['y', px[1]], ['width', 3], ['height', 3], ['rx', 0.5]] as const) {
    dot.setAttribute(k, String(v));
  }
  svg.append(dot);
  return svg;
}

/** Поставить иконку в элемент: заменяет прежнюю (первый svg), подпись рядом не трогает. */
export function setIcon(el: Element, name: IconName): void {
  const old = el.querySelector(':scope > svg');
  if (old) old.replaceWith(icon(name));
  else el.prepend(icon(name));
}

/** Разметка помечает места под иконки атрибутом data-icon - заполняем их при старте. */
export function fillIcons(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = el.dataset.icon ?? '';
    if (isIcon(name)) setIcon(el, name);
  }
}
