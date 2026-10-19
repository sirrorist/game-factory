'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { cn } from '@/lib/utils.ts';

type Phase = 'closed' | 'opening' | 'open' | 'closing';
let scrollLocks = 0;
let restoreScroll: (() => void) | undefined;

function lockScroll() {
  if (scrollLocks++ === 0) {
    const style = document.body.style;
    const overflow = style.overflow, padding = style.paddingRight;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + gutter}px`;
    style.overflow = 'hidden';
    restoreScroll = () => { style.overflow = overflow; style.paddingRight = padding; };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--scrollLocks === 0) { restoreScroll?.(); restoreScroll = undefined; }
  };
}

/** Выход всегда завершается до close/unmount. Отменённое движение не завершает новый переход. */
function usePresence(open: boolean, ref: RefObject<HTMLElement | null>, modal = false) {
  const [phase, setPhase] = useState<Phase>(open ? 'opening' : 'closed');
  const release = useRef<(() => void) | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const lastChildren = useRef<ReactNode>(null);

  useLayoutEffect(() => { setPhase(p => open ? (p === 'open' ? p : 'opening') : p === 'closed' ? p : 'closing'); }, [open]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const dialog = modal ? node as HTMLDialogElement : null;
    if (phase === 'closed') {
      if (dialog?.open) dialog.close();
      release.current?.(); release.current = null;
      if (origin.current?.isConnected) origin.current.focus({ preventScroll: true });
      origin.current = null;
      return;
    }
    if (dialog && !dialog.open) {
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      release.current ??= lockScroll();
    }
    if (phase === 'open') return;
    // Чтение стиля создаёт CSS animations до getAnimations, включая reduced motion.
    void getComputedStyle(node).animationName;
    const animations = node.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity);
    let cancelled = false;
    void Promise.allSettled(animations.map(a => a.finished)).then(() => {
      if (!cancelled) setPhase(phase === 'opening' ? 'open' : 'closed');
    });
    return () => { cancelled = true; };
  }, [phase, modal, ref]);
  useEffect(() => () => {
    const node = ref.current;
    if (modal && node instanceof HTMLDialogElement && node.open) node.close();
    release.current?.(); release.current = null;
    if (origin.current?.isConnected) origin.current.focus({ preventScroll: true });
  }, [modal, ref]);
  return { phase, lastChildren };
}

export function Popup({ open, onClose, titleId, id, variant = 'dialog', className, children }: {
  open: boolean; onClose: () => void; titleId: string; id?: string;
  variant?: 'dialog' | 'drawer'; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { phase, lastChildren } = usePresence(open, ref, true);
  useLayoutEffect(() => { if (open) lastChildren.current = children; }, [open, children, lastChildren]);
  return <dialog ref={ref} id={id} aria-labelledby={titleId} tabIndex={-1}
    data-state={phase} className={cn('gf-popup', `gf-popup--${variant}`, className)}
    onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => {
      if (e.target !== e.currentTarget) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
    }}
    onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex="0"]')]
        .filter(n => n.checkVisibility() && !n.closest('[inert]'));
      const first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); ref.current?.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }}>
    {phase === 'closed' ? null : open ? children : lastChildren.current}
  </dialog>;
}

/** Немодальное уведомление использует тот же жизненный цикл, без затемнения и ловушки фокуса. */
export function PopupNotice({ open, onClose, children, className }: {
  open: boolean; onClose: () => void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { phase, lastChildren } = usePresence(open, ref);
  useLayoutEffect(() => { if (open) lastChildren.current = children; }, [open, children, lastChildren]);
  return <div ref={ref} role="alert" data-state={phase} className={cn('gf-popup-notice', className)}>
    {phase === 'closed' ? null : <>{open ? children : lastChildren.current}
      <button type="button" className="gf-popup-close" aria-label="Закрыть сообщение" onClick={onClose}>×</button></>}
  </div>;
}
