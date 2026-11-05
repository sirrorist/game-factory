// После жеста на canvas браузер может не создать click следующего касания.
// Кнопки активируются на отпускании пальца; совместимый click отсекается.
export function bindTouchButtons(root: HTMLElement): () => void {
  const events = new AbortController(), signal = events.signal;
  const fingers = new Set<number>(), handled = new Set<number>();
  const started = new Map<number, HTMLButtonElement>();
  let tap: { id: number; button: HTMLButtonElement; x: number; y: number } | null = null;
  let last: { x: number; y: number; until: number } | null = null;
  const buttonAt = (target: EventTarget | null): HTMLButtonElement | null => {
    const button = target instanceof Element ? target.closest('button') : null;
    return button instanceof HTMLButtonElement && root.contains(button) ? button : null;
  };
  document.addEventListener('pointerdown', event => {
    handled.delete(event.pointerId); // ID может повториться у нового жеста, в том числе на checkbox.
    if (event.pointerType !== 'touch') { last = null; return; }
    fingers.add(event.pointerId);
    const button = buttonAt(event.target);
    if (button) started.set(event.pointerId, button);
    tap = fingers.size === 1 && button && !button.disabled
      ? { id: event.pointerId, button, x: event.clientX, y: event.clientY } : null;
  }, { signal, capture: true });
  document.addEventListener('pointermove', event => {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) tap = null;
  }, { signal, capture: true });
  document.addEventListener('pointercancel', event => {
    fingers.delete(event.pointerId); started.delete(event.pointerId); tap = null;
  }, { signal, capture: true });
  document.addEventListener('pointerup', event => {
    fingers.delete(event.pointerId);
    // Отменённое движение тоже не должно активироваться поздним native click.
    if (started.delete(event.pointerId)) {
      handled.add(event.pointerId);
      if (handled.size > 32) handled.delete(handled.values().next().value!);
      last = { x: event.clientX, y: event.clientY, until: performance.now() + 800 };
    }
    if (tap?.id !== event.pointerId) return;
    const current = tap; tap = null;
    if (!current.button.isConnected || current.button.disabled
      || buttonAt(document.elementFromPoint(event.clientX, event.clientY)) !== current.button
      || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) return;
    event.preventDefault();
    current.button.focus({ preventScroll: true });
    current.button.click();
  }, { signal, capture: true });
  document.addEventListener('click', event => {
    if (event.detail === 0) return; // Клавиатура и программная активация сохраняются.
    const pointer = event as PointerEvent;
    const duplicate = pointer.pointerType === 'touch' && handled.has(pointer.pointerId);
    // Совместимость с браузерами, отправляющими MouseEvent вместо PointerEvent.
    const legacyEvent = !((event as MouseEvent) instanceof PointerEvent);
    const legacy = legacyEvent && last && performance.now() <= last.until
      && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 8;
    if (duplicate || legacy) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { signal, capture: true });
  window.addEventListener('blur', () => { fingers.clear(); started.clear(); handled.clear(); tap = null; last = null; }, { signal });
  return () => events.abort();
}
