/**
 * Сенсорное управление - по образцу k8s-at-home (games/k8s-at-home/src/input.ts):
 * левая часть экрана - плавающий джойстик там, где коснулись (дальше края - бег),
 * правая - вести пальцем = камера, коснуться без сдвига = удар посохом.
 * Кнопки - только то, чему нет жеста: парирование (держать), магия, действие, бинт,
 * свиток, сброс перегрева, ранец.
 */

export interface TouchControlsCallbacks {
  onMove: (dx: number, dy: number, isSprint: boolean) => void;
  onLook: (deltaYaw: number, deltaPitch: number) => void;
  onAttack: () => void;
  onParry: (active: boolean) => void;
  onMagic: () => void;
  onInteract: () => void;
  onInventory: () => void;
  onHeal: () => void;
  onScroll: () => void;
  onVent: () => void;
  /** Ввод в мир разрешён: закрыты ранец и окна сцен. */
  isActive: () => boolean;
}

const STICK_R = 50;
const LOOK_SENS = 0.0055;
const TAP_SLOP = 12; // пикселей: сдвиг больше - это поворот камеры, а не удар
const TAP_MS = 320;
const STICK_ZONE = 0.42; // доля ширины экрана слева под джойстик

/**
 * Телефон или планшет: основной указатель - палец. Ширина окна и строка браузера
 * не годятся: узкое окно на ПК и ноутбук с сенсорным экраном получали тач-раскладку.
 */
export function prefersTouch(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export interface TouchControls {
  container: HTMLDivElement;
  /** Включить раскладку (первое касание пальцем на любом устройстве тоже включает). */
  enable: () => void;
  readonly enabled: boolean;
  /** Отпустить всё: окно сцены открылось посреди жеста. */
  release: () => void;
}

export function createTouchControls(canvas: HTMLCanvasElement, cb: TouchControlsCallbacks): TouchControls {
  const container = document.createElement('div');
  container.id = 'mobile-touch-overlay';
  container.className = 'mobile-touch-overlay';
  container.hidden = true;
  container.innerHTML = `
    <div id="touch-stick" class="touch-stick"><div id="touch-knob" class="touch-knob"></div></div>
    <button id="touch-btn-inv" class="touch-btn touch-btn-inv" type="button" aria-label="Ранец">🎒</button>
    <div class="touch-action-pad">
      <button id="touch-btn-scroll" class="touch-btn" type="button" aria-label="Свиток света">📜</button>
      <button id="touch-btn-heal" class="touch-btn" type="button" aria-label="Бинт">🩹</button>
      <button id="touch-btn-vent" class="touch-btn" type="button" aria-label="Сброс перегрева">🔥</button>
      <button id="touch-btn-interact" class="touch-btn" type="button" aria-label="Действие">🖐️</button>
      <button id="touch-btn-magic" class="touch-btn touch-btn-magic" type="button" aria-label="Магия">⚡</button>
      <button id="touch-btn-parry" class="touch-btn touch-btn-parry" type="button" aria-label="Парирование">🛡️</button>
    </div>
  `;
  document.body.appendChild(container);

  const stickEl = container.querySelector('#touch-stick') as HTMLElement;
  const knob = container.querySelector('#touch-knob') as HTMLElement;

  let enabled = false;
  const stick = { id: -1, x0: 0, y0: 0 };
  const look = { id: -1, x: 0, y: 0, sx: 0, sy: 0, t: 0, moved: false };

  function enable(): void {
    if (enabled) return;
    enabled = true;
    container.hidden = false;
    document.body.classList.add('touch-enabled');
  }

  function stopStick(): void {
    if (stick.id < 0) return;
    stick.id = -1;
    stickEl.classList.remove('active');
    knob.style.transform = '';
    cb.onMove(0, 0, false);
  }

  function release(): void {
    stopStick();
    look.id = -1;
  }

  // Жесты - на холсте: кнопки и окна лежат поверх и до холста касание не пропускают.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    enable();
    if (!cb.isActive()) return;
    if (e.clientX < window.innerWidth * STICK_ZONE) {
      if (stick.id >= 0) return;
      stick.id = e.pointerId;
      stick.x0 = e.clientX;
      stick.y0 = e.clientY;
      stickEl.style.left = `${e.clientX}px`;
      stickEl.style.top = `${e.clientY}px`;
      knob.style.transform = '';
      stickEl.classList.add('active');
    } else {
      if (look.id >= 0) return;
      look.id = e.pointerId;
      look.x = look.sx = e.clientX;
      look.y = look.sy = e.clientY;
      look.t = performance.now();
      look.moved = false;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === stick.id) {
      const dx = e.clientX - stick.x0;
      const dy = e.clientY - stick.y0;
      const len = Math.hypot(dx, dy);
      const k = len > STICK_R ? STICK_R / len : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      cb.onMove((dx * k) / STICK_R, (dy * k) / STICK_R, len > STICK_R * 1.15);
    } else if (e.pointerId === look.id) {
      cb.onLook((e.clientX - look.x) * LOOK_SENS, (e.clientY - look.y) * LOOK_SENS);
      look.x = e.clientX;
      look.y = e.clientY;
      if (Math.hypot(look.x - look.sx, look.y - look.sy) > TAP_SLOP) look.moved = true;
    }
  });

  const end = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === stick.id) {
      stopStick();
    } else if (e.pointerId === look.id) {
      const tap = !look.moved && performance.now() - look.t < TAP_MS;
      look.id = -1;
      if (tap && e.type === 'pointerup' && cb.isActive()) cb.onAttack();
    }
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  // Кнопки: срабатывают на касание, а не на отпускание - в бою отпускание запаздывает.
  function press(id: string, fn: () => void): void {
    const el = container.querySelector(`#${id}`) as HTMLElement;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      enable();
      fn();
    });
  }
  press('touch-btn-inv', () => cb.onInventory());
  press('touch-btn-scroll', () => cb.isActive() && cb.onScroll());
  press('touch-btn-heal', () => cb.isActive() && cb.onHeal());
  press('touch-btn-vent', () => cb.isActive() && cb.onVent());
  press('touch-btn-interact', () => cb.isActive() && cb.onInteract());
  press('touch-btn-magic', () => cb.isActive() && cb.onMagic());

  // Парирование - пока палец на кнопке, как ПКМ на ПК
  const parryBtn = container.querySelector('#touch-btn-parry') as HTMLElement;
  parryBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!cb.isActive()) return;
    parryBtn.setPointerCapture(e.pointerId);
    parryBtn.classList.add('active');
    cb.onParry(true);
  });
  const parryOff = (): void => {
    if (!parryBtn.classList.contains('active')) return;
    parryBtn.classList.remove('active');
    cb.onParry(false);
  };
  parryBtn.addEventListener('pointerup', parryOff);
  parryBtn.addEventListener('pointercancel', parryOff);
  parryBtn.addEventListener('lostpointercapture', parryOff);

  if (prefersTouch()) enable();

  return {
    container,
    enable,
    get enabled() {
      return enabled;
    },
    release,
  };
}
