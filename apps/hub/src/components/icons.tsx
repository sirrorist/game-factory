// Иконки дизайн-системы (assets/Icons в Claude Design): сетка 24, обводка 2px - цвет текста,
// квадратный "пиксель" 3×3 - brand (у трофея и пьедестала - coin). Встроенный SVG, а не <img>:
// цвет берётся из currentColor и темы. Форма - данные этого файла: строка - путь, объект - круг.

import type { SVGProps } from 'react';
import { cn } from '@/lib/utils.ts';

type Shape = string | { cx: number; cy: number; r: number };

const ICONS = {
  'play': { shapes: ['M7 5.5v13l11-6.5z'], px: [17, 3] },
  'download': { shapes: ['M12 7.5v8', 'M8 11.5 12 15.5l4-4', 'M5 19.5h14'], px: [10.5, 2.5] },
  'fullscreen': { shapes: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'], px: [10.5, 10.5] },
  'exit-fullscreen': { shapes: ['M9 4v5H4', 'M20 9h-5V4', 'M15 20v-5h5', 'M4 15h5v5'], px: [10.5, 10.5] },
  'menu': { shapes: ['M4 7h16', 'M4 12h16', 'M4 17h10'], px: [17, 15.5] },
  'close': { shapes: ['M6 6l12 12', 'M18 6 6 18'], px: [10.5, 1] },
  'sound-on': { shapes: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.5a7.5 7.5 0 0 1 0 11'], px: [19, 1.5] },
  'sound-off': { shapes: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M16 9.5l5 5', 'M21 9.5l-5 5'], px: [19, 1.5] },
  'trophy': { shapes: ['M8 6h8v4a4 4 0 0 1-8 0z', 'M8 7.5H5.5a2.5 2.5 0 0 0 2.5 4', 'M16 7.5h2.5a2.5 2.5 0 0 1-2.5 4', 'M12 14v3.5', 'M10 17.5h4', 'M8.5 20.5h7'], px: [10.5, 1] },
  'podium': { shapes: ['M3 20.5v-6h6V9.5h6v7h6v4z', 'M9 14.5v6', 'M15 16.5v4'], px: [10.5, 4] },
  'blocks': { shapes: ['M12 2.5 20.5 7v10L12 21.5 3.5 17V7z', 'M3.5 7 12 11.5 20.5 7', 'M12 11.5v10'], px: [10.5, 5.25] },
  'gamepad': { shapes: ['M7.5 6.5h9a5 5 0 0 1 5 5.6l-.6 4.3a2.7 2.7 0 0 1-4.7 1.3L14.4 15.5H9.6l-1.8 2.2a2.7 2.7 0 0 1-4.7-1.3l-.6-4.3a5 5 0 0 1 5-5.6z', 'M8 9.8v4', 'M6 11.8h4'], px: [14.75, 9.75] },
  'back': { shapes: ['M19 12H5', 'M10 7l-5 5 5 5'], px: [17, 4] },
  'save': { shapes: ['M4.5 4h12l3 3v13h-15z', 'M8 4v4.5h8V4', 'M8 13.5h8V20H8z'], px: [10.5, 15.25] },
  'sliders': { shapes: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', { cx: 15, cy: 7, r: 2 }, { cx: 9, cy: 17, r: 2 }], px: [19, 10.5] },
  'user': { shapes: [{ cx: 12, cy: 8.5, r: 3.5 }, 'M5 20a7 7 0 0 1 14 0'], px: [18.5, 2.5] },
} satisfies Record<string, { shapes: Shape[]; px: [number, number] }>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const COIN: ReadonlySet<IconName> = new Set<IconName>(['trophy', 'podium']);

/** Иконка набора. Размер - классом (size-5) или width/height; по умолчанию 24 (класс gf-icon). */
export function Icon({ name, className, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const { shapes, px } = ICONS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn('gf-icon', COIN.has(name) && 'gf-icon--coin', className)}
      {...props}
    >
      {shapes.map((s, i) => (typeof s === 'string' ? <path key={i} d={s} /> : <circle key={i} {...s} />))}
      <rect className="px" x={px[0]} y={px[1]} width="3" height="3" rx="0.5" />
    </svg>
  );
}
