'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** Измеряем только начало сетки. Высоту рядов определяют стабильный svh и содержимое. */
export function CatalogLayout({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = root.current;
    const heading = section?.querySelector<HTMLElement>('.gf-catalog__heading');
    if (!section || !heading) return;
    function measure() {
      if (!section || !heading) return;
      const top = heading.getBoundingClientRect().bottom + window.scrollY + parseFloat(getComputedStyle(section).rowGap);
      section.style.setProperty('--catalog-grid-top', `${top}px`);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    const header = document.querySelector('.gf-header');
    if (header) observer.observe(header);
    window.addEventListener('resize', measure);
    let active = true;
    void document.fonts.ready.then(() => { if (active) measure(); });
    measure();
    return () => { active = false; observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return <section ref={root} className="gf-catalog">{children}</section>;
}
