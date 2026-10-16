'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** Высота карточки зависит от места после реальной шапки, включая переносы навигации. */
export function CatalogLayout({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = root.current;
    const grid = section?.querySelector<HTMLElement>('[data-testid="catalog"]');
    const heading = section?.querySelector<HTMLElement>('.gf-catalog__heading');
    const card = grid?.querySelector<HTMLElement>('.gf-card');
    const title = card?.querySelector<HTMLElement>('.gf-card__title');
    const actions = card?.querySelector<HTMLElement>('.gf-card__actions');
    if (!section || !grid || !heading) return;

    function measure() {
      if (!section || !grid || !heading) return;
      const style = getComputedStyle(section);
      const gap = parseFloat(getComputedStyle(grid).rowGap);
      const rows = parseFloat(style.getPropertyValue('--catalog-visible-rows'));
      const shortLandscape = style.getPropertyValue('--catalog-short-landscape').trim() === '1';
      const titlePeek = style.getPropertyValue('--catalog-title-peek').trim() === '1';
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const start = heading.getBoundingClientRect().bottom + window.scrollY
        + parseFloat(style.rowGap);
      // В низком ландшафте карточка помещается после прокрутки шапки.
      // У дробного ряда край viewport проходит по самой карточке;
      // после целых рядов оставляем обычный нижний отступ страницы.
      const bottom = Number.isInteger(rows) ? rem : 0;
      let height = shortLandscape ? viewport - 2 * rem
        : (viewport - start - bottom - gap * Math.ceil(rows - 1)) / rows;
      if (!shortLandscape && titlePeek && card && title) {
        // В портрете граница экрана проходит перед описанием второй карточки.
        // Учитываем реальную высоту кнопок: у касаний она больше, чем у мыши.
        const belowTitle = card.getBoundingClientRect().bottom - title.getBoundingClientRect().bottom;
        const descriptionGap = parseFloat(getComputedStyle(title.parentElement!).rowGap);
        height = Math.ceil((viewport - start - gap + belowTitle - descriptionGap) / 2);
      }
      section.style.setProperty('--catalog-card-height', `${Math.floor(height)}px`);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    if (title) observer.observe(title);
    if (actions) observer.observe(actions);
    const header = document.querySelector('.gf-header');
    if (header) observer.observe(header);
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
  }, []);

  return <section ref={root} className="gf-catalog">{children}</section>;
}
