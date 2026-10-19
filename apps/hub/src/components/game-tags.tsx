'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Popup } from '@/components/ui/popup.tsx';

export function GameTags({ tags, title }: { tags: string[]; title: string }) {
  const row = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(tags.length);
  const id = useId();

  useEffect(() => {
    const container = row.current;
    const sample = probe.current;
    if (!container || !sample) return;
    function measure() {
      if (!container || !sample) return;
      const chips = Array.from(sample.querySelectorAll<HTMLElement>('.gf-badge'));
      const gap = parseFloat(getComputedStyle(container).columnGap);
      const widths = chips.map(chip => chip.getBoundingClientRect().width);
      const available = container.clientWidth;
      if (widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1) <= available) {
        setVisible(tags.length);
        return;
      }
      const button = sample.querySelector('button')!;
      let used = button.getBoundingClientRect().width;
      let count = 0;
      for (const width of widths) {
        if (used + gap + width > available) break;
        used += gap + width;
        count++;
      }
      setVisible(count);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(sample);
    let active = true;
    void document.fonts.ready.then(() => { if (active) measure(); });
    measure();
    return () => { active = false; observer.disconnect(); };
  }, [tags]);

  return (
    <>
      <div className="gf-game-tags" ref={row}>
        {tags.slice(0, visible).map(tag => <Badge key={tag}>{tag}</Badge>)}
        {visible < tags.length ? (
          <button type="button" className="gf-game-tags__more" aria-label={`Все теги игры «${title}»`}
            aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}>…</button>
        ) : null}
        {/* Измеряем целые плашки отдельно: скрытые теги не оставляют обрезанных фрагментов. */}
        <div ref={probe} className="gf-game-tags__probe" aria-hidden="true" inert>
          {tags.map(tag => <Badge key={tag}>{tag}</Badge>)}
          <button type="button" className="gf-game-tags__more" tabIndex={-1}>…</button>
        </div>
      </div>
      <Popup id={id} open={open} onClose={() => setOpen(false)} className="gf-tags-dialog" titleId={`${id}-title`}>
        <div className="gf-tags-dialog__header">
          <h2 id={`${id}-title`}>Теги игры «{title}»</h2>
          <Button variant="outline" size="sm" autoFocus onClick={() => setOpen(false)}>Закрыть</Button>
        </div>
        <div className="gf-tags-dialog__list">{tags.map(tag => <Badge key={tag}>{tag}</Badge>)}</div>
      </Popup>
    </>
  );
}
