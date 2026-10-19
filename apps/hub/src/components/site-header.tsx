'use client';

import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo.tsx';
import { Icon } from '@/components/icons.tsx';
import { SiteNav } from '@/components/site-nav.tsx';
import { Popup } from '@/components/ui/popup.tsx';

export function SiteHeader({ owner, children }: { owner: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId(), path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    const desktop = matchMedia('(min-width: 1100px)');
    const close = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', close);
    return () => desktop.removeEventListener('change', close);
  }, []);
  return <header className="gf-header">
    <div className="gf-header__inner">
      <Link href="/" className="gf-logo"><Logo /><span className="gf-logo__word">Game <b>Factory</b></span></Link>
      <div className="gf-header__desktop-nav"><SiteNav owner={owner} /></div>
      <div className="gf-header__end">{children}</div>
      <button className="gf-menu-trigger gf-btn gf-btn--ghost" type="button" aria-label="Открыть меню"
        aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}><Icon name="menu" /></button>
    </div>
    <Popup id={id} open={open} onClose={() => setOpen(false)} titleId={`${id}-title`} variant="drawer">
      <div className="gf-popup-heading"><h2 id={`${id}-title`}>Меню</h2>
        <button className="gf-popup-close" autoFocus aria-label="Закрыть меню" type="button" onClick={() => setOpen(false)}><Icon name="close" /></button></div>
      <div onClick={e => { if ((e.target as Element).closest('a')) setOpen(false); }}><SiteNav owner={owner} /></div>
      <div className="gf-menu-account">{children}</div>
    </Popup>
  </header>;
}
