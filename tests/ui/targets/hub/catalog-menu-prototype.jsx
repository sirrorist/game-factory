// Только dev-прототип до принятия компоновки. Сессия/API — штатные явные mocks.
import React, { useId, useRef, useState } from 'react';
import { Logo } from '@/components/logo.tsx';
import { SiteNav } from '@/components/site-nav.tsx';
import { UserMenu } from '@/components/user-menu.tsx';
import { currentOwner } from '@/lib/session.ts';

function PrototypeMenu({ children }) {
  const id = useId();
  const dialog = useRef(null);
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  return <>
    <button ref={trigger} type="button" className="gf-btn gf-btn--ghost gf-menu-trigger"
      aria-label="Открыть меню" aria-haspopup="dialog" aria-controls={id} aria-expanded={open}
      onClick={() => { dialog.current.showModal(); setOpen(true); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
    <dialog ref={dialog} id={id} className="gf-menu-dialog" aria-labelledby={`${id}-title`}
      onClose={() => { setOpen(false); trigger.current.focus({ preventScroll: true }); }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        // Нативный dialog может передать Tab браузерной панели после последнего пункта.
        const controls = [...event.currentTarget.querySelectorAll('a[href],button:not([disabled]),[tabindex="0"]')]
          .filter(e => e.checkVisibility() && getComputedStyle(e).visibility === 'visible');
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onClick={e => {
        if (e.target.closest('a')) dialog.current.close();
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.current.close();
      }}>
      <div className="gf-menu-dialog__heading">
        <h2 id={`${id}-title`}>Меню</h2>
        <button autoFocus type="button" className="gf-btn gf-btn--ghost" aria-label="Закрыть меню"
          onClick={() => dialog.current.close()}>Закрыть</button>
      </div>
      {children}
    </dialog>
  </>;
}

export async function CatalogMenuPrototypeLayout({ children }) {
  const owner = (await currentOwner()) !== null;
  return <html lang="ru"><body className="min-h-dvh">
    <header className="gf-header" style={{ padding: 0 }}>
      <div className="gf-menu-header mx-auto w-full max-w-5xl px-4">
        <a href="/" className="gf-logo"><Logo /><span className="gf-logo__word">Game <b>Factory</b></span></a>
        <PrototypeMenu>
          <SiteNav owner={owner} />
          <div className="gf-menu-dialog__account"><UserMenu /></div>
        </PrototypeMenu>
      </div>
    </header>
    <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
  </body></html>;
}
