'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** Центрируем короткую страницу под шапкой; длинное содержимое растёт без обрезания. */
export function FirstScreen({ children, anchor = false }: { children: ReactNode; anchor?: boolean }) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = root.current;
    const main = section?.closest('main');
    if (!section || !main) return;
    function measure() {
      if (!section || !main) return;
      const top = section.getBoundingClientRect().top + window.scrollY;
      const bottom = parseFloat(getComputedStyle(main).paddingBottom);
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const available = Math.max(0, viewport - top - bottom);
      section.style.setProperty('--first-screen-space', `${available}px`);
      if (anchor) {
        // Дополнительные сообщения и раскрывающиеся блоки растут вниз,
        // не меняя исходное положение основных элементов страницы.
        const blocks = [...section.querySelectorAll<HTMLElement>('[data-first-screen-anchor]')]
          .map(block => block.getBoundingClientRect());
        if (blocks.length) {
          const height = Math.max(...blocks.map(block => block.bottom)) - Math.min(...blocks.map(block => block.top));
          section.style.setProperty('--first-screen-offset', `${Math.max(0, (available - height) / 2)}px`);
        }
      }
    }
    const observer = new ResizeObserver(measure);
    const header = document.querySelector('.gf-header');
    if (header) observer.observe(header);
    if (anchor) section.querySelectorAll('[data-first-screen-anchor]').forEach(block => observer.observe(block));
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    let active = true;
    void document.fonts.ready.then(() => { if (active) measure(); });
    measure();
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [anchor]);

  return <section ref={root} className={anchor ? 'gf-first-screen gf-first-screen--anchored' : 'gf-first-screen'}>{children}</section>;
}
