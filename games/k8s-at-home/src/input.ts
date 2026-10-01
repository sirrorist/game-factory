// Ввод: клавиатура и мышь с захватом указателя на ПК, джойстик и жесты на телефоне.
// Наружу - состояние (куда идём, куда смотрим) и события (сломать, поставить, выбрать).

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const MOUSE_SENS = 0.0024;
const TOUCH_SENS = 0.0055;
const HOLD_MS = 320; // удержание дольше - ломаем, короче - ставим
const TAP_SLOP = 12; // пикселей: сдвиг больше - это поворот камеры, а не касание
const STICK_R = 50;
// Скачок указателя больше этого за одно событие - сбой браузера при захвате, а не движение руки.
const MOUSE_SPIKE = 300;

export interface InputEvents {
  breakStart(): void;
  breakEnd(): void;
  place(): void;
  pick(): void;
  slot(n: number): void;
  scroll(dir: number): void;
  toggleFly(): void;
  togglePicker(): void;
  toggleDebug(): void;
  pause(): void;
  /** Захват мыши потерян не через меню (Esc, смена окна). main.ts решает: меню или нет. */
  lockLost(): void;
  /** Первый жест игрока - можно включать звук. */
  gesture(): void;
}

export class Input {
  yaw = 0;
  pitch = 0;
  touchMode = false;
  /** Счётчики для F3: событий мыши, самый большой шаг, отсеянные скачки. Сбрасывает main.ts. */
  readonly mouseStats = { events: 0, maxStep: 0, dropped: 0 };
  /** Сырой ввод мыши: null - ещё не захватывали, false - браузер не умеет. */
  rawMouse: boolean | null = null;
  /** Игра идёт: меню закрыто. Пока false, ввод в мир не идёт. */
  active = false;
  placeHeld = false;

  private readonly keys = new Set<string>();
  private readonly canvas: HTMLElement;
  private readonly ev: InputEvents;
  private stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
  private look = { id: -1, x: 0, y: 0, sx: 0, sy: 0, t: 0, moved: false, breaking: false, timer: 0 };
  private touchJump = false;
  private touchDown = false;
  private lastSpace = 0;
  private lastJumpTap = 0;
  private lastForward = 0;
  private sprintW = false;

  constructor(canvas: HTMLElement, ev: InputEvents) {
    this.canvas = canvas;
    this.ev = ev;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('pointerlockchange', () => {
      if (this.locked || !this.active || this.touchMode) return;
      // Esc в полноэкранном режиме браузер тратит сразу на два выхода - из захвата и из полного
      // экрана, а события приходят в любом порядке. Ждём второе, потом решаем.
      setTimeout(() => {
        if (!this.locked && this.active) ev.lockLost();
      }, 250);
    });
    document.addEventListener('pointerlockerror', () => {
      // Chrome не даёт снова захватить указатель сразу после Esc - игрок кликнет ещё раз.
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      ev.gesture();
      if (!this.active || this.touchMode) return;
      if (!this.locked) {
        this.lock();
        return;
      }
      if (e.button === 0) ev.breakStart();
      else if (e.button === 2) {
        this.placeHeld = true;
        ev.place();
      } else if (e.button === 1) ev.pick();
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) ev.breakEnd();
      if (e.button === 2) this.placeHeld = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.active) return;
      const step = Math.max(Math.abs(e.movementX), Math.abs(e.movementY));
      this.mouseStats.events++;
      if (step > MOUSE_SPIKE) {
        this.mouseStats.dropped++;
        return;
      }
      if (step > this.mouseStats.maxStep) this.mouseStats.maxStep = step;
      this.turn(e.movementX * MOUSE_SENS, e.movementY * MOUSE_SENS);
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      ev.scroll(Math.sign(e.deltaY));
      e.preventDefault();
    }, { passive: false });

    this.bindTouch();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  lock(): void {
    if (this.touchMode || this.locked) return;
    const canvas = this.canvas as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      // Сырое движение мыши - без ускорения ОС и с меньшей задержкой. Где его нет (часть
      // систем), браузер отвечает NotSupportedError - тогда обычный захват.
      // В новых браузерах - промис: отказ не должен становиться необработанной ошибкой.
      const r = canvas.requestPointerLock({ unadjustedMovement: true });
      if (r instanceof Promise) {
        r.then(() => (this.rawMouse = true)).catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'NotSupportedError') {
            this.rawMouse = false;
            const again = canvas.requestPointerLock();
            if (again instanceof Promise) again.catch(() => undefined);
          }
        });
      }
    } catch {
      // нет захвата - останется меню
    }
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  private turn(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch - dy));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (down) this.ev.gesture();
    if (e.code === 'F3' && down) {
      this.ev.toggleDebug();
      e.preventDefault();
      return;
    }
    if (!this.active) {
      if (e.code === 'KeyE' && down) this.ev.togglePicker();
      return;
    }
    // Сочетания с Ctrl и Cmd в игре - браузерные (Ctrl+D - закладка, Ctrl+S - сохранить):
    // гасим те, что браузер даёт погасить. Ctrl+W и Ctrl+T не гасятся вовсе, поэтому
    // Ctrl в управлении не участвует - бег на Shift или двойном W.
    // Отпускание клавиши обрабатываем всегда - иначе W, отпущенная с зажатым Ctrl, "залипнет".
    if (down && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      return;
    }
    if (down) {
      if (e.code === 'KeyW' && !e.repeat) {
        const now = performance.now();
        this.sprintW = now - this.lastForward < 300;
        this.lastForward = now;
      }
      if (e.code === 'Space' && !e.repeat) {
        const now = performance.now();
        if (now - this.lastSpace < 300) this.ev.toggleFly();
        this.lastSpace = now;
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) this.ev.slot(Number(digit[1]) - 1);
      if (e.code === 'KeyE' && !e.repeat) this.ev.togglePicker();
    }
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  }

  releaseAll(): void {
    this.keys.clear();
    this.stick.id = -1;
    $('stick').classList.remove('active');
    this.endLook();
    this.touchJump = false;
    this.touchDown = false;
    this.placeHeld = false;
    this.ev.breakEnd();
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Направление движения: вперёд и вбок, от -1 до 1. */
  move(): { forward: number; strafe: number; sprint: boolean } {
    if (!this.active) return { forward: 0, strafe: 0, sprint: false };
    let forward = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    let strafe = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    if (!this.key('KeyW', 'ArrowUp')) this.sprintW = false;
    let sprint = this.sprintW;
    if (this.stick.id >= 0) {
      const dx = this.stick.x - this.stick.x0;
      const dy = this.stick.y - this.stick.y0;
      const len = Math.hypot(dx, dy);
      const k = len > STICK_R ? STICK_R / len : 1;
      strafe = (dx * k) / STICK_R;
      forward = (-dy * k) / STICK_R;
      sprint = len > STICK_R * 1.15;
    }
    return { forward, strafe, sprint };
  }

  jump(): boolean {
    return this.active && (this.key('Space') || this.touchJump);
  }

  /** Вниз в полёте; на ПК Shift ещё и бег по земле - main.ts решает по режиму. */
  down(): boolean {
    return this.active && (this.key('ShiftLeft', 'ShiftRight') || this.touchDown);
  }

  shift(): boolean {
    return this.active && this.key('ShiftLeft', 'ShiftRight');
  }

  enableTouch(): void {
    if (this.touchMode) return;
    this.touchMode = true;
    this.unlock();
    $('touch').hidden = false;
    $('help-touch').hidden = false;
    $('help-desktop').hidden = true;
    document.querySelectorAll<HTMLElement>('.slot .key').forEach((k) => (k.hidden = true));
  }

  private bindTouch(): void {
    const app = $('app');
    const stickEl = $('stick');
    const knob = $('knob');

    app.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.enableTouch();
      this.ev.gesture();
      if (!this.active || e.target !== this.canvas) return;
      if (e.clientX < window.innerWidth * 0.42) {
        if (this.stick.id >= 0) return;
        this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
        stickEl.style.left = `${e.clientX}px`;
        stickEl.style.top = `${e.clientY}px`;
        knob.style.transform = '';
        stickEl.classList.add('active');
      } else {
        if (this.look.id >= 0) return;
        const look = this.look;
        look.id = e.pointerId;
        look.x = look.sx = e.clientX;
        look.y = look.sy = e.clientY;
        look.t = performance.now();
        look.moved = false;
        look.breaking = false;
        look.timer = window.setTimeout(() => {
          if (look.id >= 0 && !look.moved) {
            look.breaking = true;
            this.ev.breakStart();
          }
        }, HOLD_MS);
      }
    });

    app.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.pointerId === this.stick.id) {
        this.stick.x = e.clientX;
        this.stick.y = e.clientY;
        const dx = e.clientX - this.stick.x0;
        const dy = e.clientY - this.stick.y0;
        const len = Math.hypot(dx, dy);
        const k = len > STICK_R ? STICK_R / len : 1;
        knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      } else if (e.pointerId === this.look.id) {
        const look = this.look;
        this.turn((e.clientX - look.x) * TOUCH_SENS, (e.clientY - look.y) * TOUCH_SENS);
        look.x = e.clientX;
        look.y = e.clientY;
        if (Math.hypot(look.x - look.sx, look.y - look.sy) > TAP_SLOP) look.moved = true;
      }
    });

    const end = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;
      if (e.pointerId === this.stick.id) {
        this.stick.id = -1;
        stickEl.classList.remove('active');
      } else if (e.pointerId === this.look.id) {
        const look = this.look;
        const tap = !look.moved && !look.breaking && performance.now() - look.t < HOLD_MS;
        this.endLook();
        if (tap && this.active) this.ev.place();
      }
    };
    app.addEventListener('pointerup', end);
    app.addEventListener('pointercancel', end);

    const hold = (id: string, set: (on: boolean) => void, onTap?: () => void): void => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('on');
        set(true);
        onTap?.();
      });
      const off = (): void => {
        el.classList.remove('on');
        set(false);
      };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    };
    hold('btn-jump', (on) => (this.touchJump = on), () => {
      const now = performance.now();
      if (now - this.lastJumpTap < 300) this.ev.toggleFly();
      this.lastJumpTap = now;
    });
    hold('btn-down', (on) => (this.touchDown = on));
  }

  private endLook(): void {
    const look = this.look;
    if (look.id < 0) return;
    clearTimeout(look.timer);
    if (look.breaking) this.ev.breakEnd();
    look.id = -1;
    look.breaking = false;
  }
}
