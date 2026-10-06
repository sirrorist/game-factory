// Ввод: клавиатура и мышь (захват указателя) на ПК, виртуальный джойстик и тач-обзор на телефоне.
// Устройство ввода скопировано с games/k8s-at-home/src/input.ts по правилам docs/GAME-TZ.md.

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Элемент #${id} не найден`);
  return el as T;
};

const MOUSE_SENS = 0.0024;
const TOUCH_SENS = 0.0045;
const STICK_R = 50;
const MOUSE_SPIKE = 300;

export interface InputEvents {
  pause(): void;
  lockLost(): void;
  gesture(): void;
  toggleDebug(): void;
}

export class Input {
  yaw = 0;
  pitch = 0.25; // начальный угол обзора сверху вниз
  touchMode = false;
  active = true;

  readonly mouseStats = { events: 0, maxStep: 0, dropped: 0 };
  rawMouse: boolean | null = null;

  private readonly keys = new Set<string>();
  private readonly canvas: HTMLElement;
  private readonly ev: InputEvents;

  private stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
  private look = { id: -1, x: 0, y: 0 };
  private touchJump = false;

  constructor(canvas: HTMLElement, ev: InputEvents) {
    this.canvas = canvas;
    this.ev = ev;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());

    document.addEventListener('pointerlockchange', () => {
      if (!this.active && document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch {
          // Игнорируем
        }
        return;
      }
      if (this.locked || !this.active || this.touchMode) return;
      setTimeout(() => {
        if (!this.locked && this.active) this.ev.lockLost();
      }, 250);
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      this.ev.gesture();
      if (!this.active || this.touchMode) return;
      if (!this.locked) {
        this.lock();
      }
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

    this.bindTouch();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  lock(): void {
    if (this.touchMode || this.locked || !this.active) return;
    const canvas = this.canvas as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      const r = canvas.requestPointerLock({ unadjustedMovement: true });
      if (r instanceof Promise) {
        r.then(() => {
          this.rawMouse = true;
          if (!this.active) {
            this.unlock();
          }
        }).catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'NotSupportedError') {
            this.rawMouse = false;
            const again = canvas.requestPointerLock();
            if (again instanceof Promise) {
              again
                .then(() => {
                  if (!this.active) this.unlock();
                })
                .catch(() => undefined);
            }
          }
        });
      }
    } catch {
      // Игнорируем отказ
    }
  }

  unlock(): void {
    try {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } catch {
      // Игнорируем
    }
  }

  private turn(dx: number, dy: number): void {
    this.yaw -= dx;
    // Ограничиваем угол наклона камеры (не даём уйти под землю или перевернуться через голову)
    this.pitch = Math.max(-0.25, Math.min(0.85, this.pitch + dy));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (down) this.ev.gesture();
    if (e.code === 'F3' && down) {
      this.ev.toggleDebug();
      e.preventDefault();
      return;
    }
    // ERR-10: Перехват системных шорткатов браузера при беге и взаимодействии (Ctrl+W, Ctrl+R и др.)
    if (e.ctrlKey || e.metaKey) {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyT', 'KeyN', 'KeyQ', 'KeyP', 'KeyU', 'Space', 'Tab', 'Escape'].includes(e.code)) {
        e.preventDefault();
      }
      // Клавиши продолжают регистрироваться в игре даже при зажатом Ctrl/Meta
    }

    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);

    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  releaseAll(): void {
    this.keys.clear();
    this.stick.id = -1;
    const stickEl = document.getElementById('stick');
    if (stickEl) stickEl.classList.remove('active');
    this.look.id = -1;
    this.touchJump = false;
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  move(): { forward: number; strafe: number } {
    if (!this.active) return { forward: 0, strafe: 0 };

    let forward = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    let strafe = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);

    if (this.stick.id >= 0) {
      const dx = this.stick.x - this.stick.x0;
      const dy = this.stick.y - this.stick.y0;
      const len = Math.hypot(dx, dy);
      const k = len > STICK_R ? STICK_R / len : 1;
      strafe = (dx * k) / STICK_R;
      // Вверх по экрану - это вперёд (отрицательный Y)
      forward = (-dy * k) / STICK_R;
    }

    return { forward, strafe };
  }

  jump(): boolean {
    return this.active && (this.key('Space') || this.touchJump);
  }

  enableTouch(): void {
    if (this.touchMode) return;
    this.touchMode = true;
    this.unlock();
    const touchEl = document.getElementById('touch');
    if (touchEl) touchEl.hidden = false;
    const helpTouch = document.getElementById('help-touch');
    if (helpTouch) helpTouch.hidden = false;
    const helpDesktop = document.getElementById('help-desktop');
    if (helpDesktop) helpDesktop.hidden = true;
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

      // Левые 42% экрана - джойстик под пальцем (DESIGN.md, раздел 4)
      if (e.clientX < window.innerWidth * 0.42) {
        if (this.stick.id >= 0) return;
        this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
        stickEl.style.left = `${e.clientX}px`;
        stickEl.style.top = `${e.clientY}px`;
        knob.style.transform = '';
        stickEl.classList.add('active');
      } else {
        // Правая часть экрана - поворот камеры пальцем
        if (this.look.id >= 0) return;
        this.look.id = e.pointerId;
        this.look.x = e.clientX;
        this.look.y = e.clientY;
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
        const dx = e.clientX - this.look.x;
        const dy = e.clientY - this.look.y;
        this.turn(dx * TOUCH_SENS, dy * TOUCH_SENS);
        this.look.x = e.clientX;
        this.look.y = e.clientY;
      }
    });

    const end = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;
      if (e.pointerId === this.stick.id) {
        this.stick.id = -1;
        stickEl.classList.remove('active');
      } else if (e.pointerId === this.look.id) {
        this.look.id = -1;
      }
    };
    app.addEventListener('pointerup', end);
    app.addEventListener('pointercancel', end);

    // Кнопка прыжка на тач-экране (круглая, >= 56 px)
    const btnJump = $('btn-jump');
    btnJump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btnJump.setPointerCapture(e.pointerId);
      btnJump.classList.add('on');
      this.touchJump = true;
    });
    const offJump = (): void => {
      btnJump.classList.remove('on');
      this.touchJump = false;
    };
    btnJump.addEventListener('pointerup', offJump);
    btnJump.addEventListener('pointercancel', offJump);
    btnJump.addEventListener('lostpointercapture', offJump);
  }
}
