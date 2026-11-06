interface DrawerOptions {
  reducedMotion: () => boolean;
  dismiss: () => void;
  onBlockingChange: (blocked: boolean) => void;
}

// Только представление: открытие меню не меняет сезон, размеры сцены и положение камеры.
export class Drawer {
  #options: DrawerOptions;
  #layer: HTMLElement;
  #panel: HTMLElement;
  #world: HTMLElement;
  #closeButton: HTMLButtonElement;
  #menuButton: HTMLButtonElement;
  #animations: Animation[] = [];
  #generation = 0;
  #opened = true;
  #restoreFocus: HTMLElement | null = null;
  #layoutObserver = new ResizeObserver(() => this.#fitContent());

  constructor(options: DrawerOptions) {
    this.#options = options;
    this.#layer = document.getElementById('drawer-layer')!;
    this.#panel = document.getElementById('panel')!;
    this.#world = document.getElementById('world')!;
    this.#closeButton = document.getElementById('drawer-close') as HTMLButtonElement;
    this.#menuButton = document.getElementById('menu-button') as HTMLButtonElement;
    this.#world.inert = true;
    this.#world.setAttribute('aria-hidden', 'true');
    this.#closeButton.addEventListener('click', () => options.dismiss());
    // scroll не всплывает: ловим на захвате и у body, и у .panel-content.
    this.#panel.addEventListener('scroll', () => this.#updateOverflow(), true);
    document.getElementById('drawer-shade')!.addEventListener('click', () => options.dismiss());
    document.addEventListener('keydown', event => {
      if (!this.blocking) return;
      if (event.key === 'Escape' && !event.repeat) {
        event.preventDefault();
        options.dismiss();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(this.#panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'))
        .filter(control => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || this.#layer.dataset.state === 'closing') {
        event.preventDefault();
        this.#panel.focus({ preventScroll: true });
      } else if (!this.#panel.contains(document.activeElement) || document.activeElement === this.#panel || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)!.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    });
  }

  get blocking(): boolean { return this.#layer.dataset.state !== 'closed'; }

  refresh(canDismiss: boolean): void {
    this.#closeButton.disabled = !canDismiss;
    this.#layoutObserver.disconnect();
    for (const element of this.#panel.querySelectorAll('#panel-body, .panel-heading, .panel-content, #panel-body > .actions')) this.#layoutObserver.observe(element);
    this.#fitContent();
    if (this.blocking && !this.#panel.contains(document.activeElement)) this.#focusPanel();
  }

  #fitContent(): void {
    const body = this.#panel.querySelector<HTMLElement>('#panel-body')!;
    if (!body.clientHeight) return;
    const heading = body.querySelector<HTMLElement>('.panel-heading');
    const content = body.querySelector<HTMLElement>('.panel-content');
    const actions = body.querySelector<HTMLElement>(':scope > .actions');
    if (!heading || !content) return;
    const spacing = actions ? parseFloat(getComputedStyle(actions).marginTop) + parseFloat(getComputedStyle(actions).marginBottom) : 0;
    const available = body.clientHeight - heading.offsetHeight - (actions?.offsetHeight ?? 0) - spacing;
    const controlHeight = Math.max(0, ...Array.from(content.querySelectorAll('button, label')).map(element => element.getBoundingClientRect().height));
    const readable = Math.min(content.scrollHeight, Math.max(controlHeight, 6 * parseFloat(getComputedStyle(document.documentElement).fontSize)));
    // Если закреплённые действия вытесняют текст, прокручиваем содержимое вместе с ними.
    body.dataset.scroll = available + 1 < readable ? 'all' : 'content';
    this.#updateOverflow();
  }

  // data-overflow у окна прокрутки: за каким краем есть скрытое продолжение (CSS затухает этот край).
  #updateOverflow(): void {
    const body = this.#panel.querySelector<HTMLElement>('#panel-body');
    const content = body?.querySelector<HTMLElement>('.panel-content');
    if (!body || !content) return;
    const all = body.dataset.scroll === 'all', scroller = all ? body : content;
    const max = scroller.scrollHeight - scroller.clientHeight;
    // Порог 2 px - как у проверки чтения: прокрутка на пару пикселей не скрывает содержимое.
    const top = max > 2 && scroller.scrollTop > 1, bottom = max > 2 && scroller.scrollTop < max - 1;
    const value = top && bottom ? 'both' : top ? 'top' : bottom ? 'bottom' : 'none';
    scroller.dataset.overflow = value;
    (all ? content : body).dataset.overflow = 'none';
  }

  setOpen(open: boolean, animate = true): void {
    if (open === this.#opened) return;
    this.#opened = open;
    const generation = ++this.#generation;
    const shade = document.getElementById('drawer-shade')!;
    if (open) {
      if (!this.blocking) this.#restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.#layer.hidden = false;
      this.#world.inert = true;
      this.#world.setAttribute('aria-hidden', 'true');
    }
    const fromPanel = getComputedStyle(this.#panel);
    const transform = fromPanel.transform;
    const opacity = fromPanel.opacity;
    const shadeOpacity = getComputedStyle(shade).opacity;
    for (const animation of this.#animations) animation.cancel();
    this.#animations = [];
    this.#layer.dataset.state = open ? 'opening' : 'closing';
    this.#menuButton.setAttribute('aria-expanded', String(open));
    this.#options.onBlockingChange(true);
    const duration = animate && !this.#options.reducedMotion() ? 240 : 0;
    if (duration) {
      const timing = { duration, easing: 'cubic-bezier(.22,.8,.25,1)' };
      this.#animations = [
        this.#panel.animate([{ transform, opacity }, { transform: open ? 'translateX(0)' : 'translateX(-100%)', opacity: open ? 1 : 0 }], timing),
        shade.animate([{ opacity: shadeOpacity }, { opacity: open ? 1 : 0 }], timing),
      ];
    }
    if (open) this.#focusPanel();
    const finish = (): void => {
      if (this.#generation !== generation) return;
      this.#layer.dataset.state = open ? 'open' : 'closed';
      this.#layer.hidden = !open;
      this.#world.inert = open;
      if (!open) this.#world.removeAttribute('aria-hidden');
      this.#options.onBlockingChange(open);
      if (!open) {
        // При переходе без анимации render ещё завершает действие и включает кнопку меню.
        queueMicrotask(() => {
          if (this.#generation !== generation || this.blocking) return;
          const target = this.#restoreFocus?.isConnected && this.#restoreFocus.getClientRects().length
            && !this.#restoreFocus.closest('[inert]') && !this.#restoreFocus.matches(':disabled') ? this.#restoreFocus : this.#menuButton;
          target.focus({ preventScroll: true });
        });
      }
    };
    if (duration) void Promise.allSettled(this.#animations.map(animation => animation.finished)).then(finish);
    else finish();
  }

  #focusPanel(): void {
    (this.#closeButton.disabled ? this.#panel : this.#closeButton).focus({ preventScroll: true });
  }
}
