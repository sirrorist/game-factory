/**
 * Модуль сенсорного управления для мобильных устройств и планшетов.
 * Включает виртуальный джойстик перемещения, кнопки действий и свайп для вращения камеры.
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
}

export function isMobileOrTouch(): boolean {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.innerWidth <= 840 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );
}

export function createTouchControls(callbacks: TouchControlsCallbacks): {
  container: HTMLDivElement;
  destroy: () => void;
} {
  const container = document.createElement('div');
  container.id = 'mobile-touch-overlay';
  container.className = 'mobile-touch-overlay';
  container.innerHTML = `
    <!-- Зона виртуального джойстика (слева снизу) -->
    <div id="touch-joystick-zone" class="touch-joystick-zone">
      <div id="touch-joystick-base" class="touch-joystick-base">
        <div id="touch-joystick-knob" class="touch-joystick-knob"></div>
      </div>
    </div>

    <!-- Кнопки действий (справа снизу) -->
    <div class="touch-action-pad">
      <div class="touch-row">
        <button id="touch-btn-magic" class="touch-btn touch-btn-magic" title="Магия [Q]">⚡</button>
        <button id="touch-btn-interact" class="touch-btn touch-btn-interact" title="Действие [E]">🖐️</button>
      </div>
      <div class="touch-row">
        <button id="touch-btn-heal" class="touch-btn touch-btn-heal" title="Бинт [3]">🩹</button>
        <button id="touch-btn-inv" class="touch-btn touch-btn-inv" title="Ранец [TAB]">🎒</button>
      </div>
      <div class="touch-row-main">
        <button id="touch-btn-parry" class="touch-btn touch-btn-parry" title="Парирование [ПКМ]">🛡️</button>
        <button id="touch-btn-attack" class="touch-btn touch-btn-attack" title="Удар посохом [ЛКМ]">⚔️</button>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  // Обработка виртуального джойстика
  const joystickZone = container.querySelector('#touch-joystick-zone') as HTMLElement;
  const joystickKnob = container.querySelector('#touch-joystick-knob') as HTMLElement;
  const baseRadius = 55;
  let activeTouchId: number | null = null;
  let centerX = 0;
  let centerY = 0;

  function handleTouchStart(e: TouchEvent) {
    if (activeTouchId !== null) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    activeTouchId = touch.identifier;
    const rect = joystickZone.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    updateJoystick(touch.clientX, touch.clientY);
  }

  function handleTouchMove(e: TouchEvent) {
    if (activeTouchId === null) return;
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === activeTouchId) {
        updateJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (activeTouchId === null) return;
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === activeTouchId) {
        activeTouchId = null;
        joystickKnob.style.transform = 'translate(-50%, -50%)';
        callbacks.onMove(0, 0, false);
        break;
      }
    }
  }

  function updateJoystick(clientX: number, clientY: number) {
    const rawDx = clientX - centerX;
    const rawDy = clientY - centerY;
    const dist = Math.hypot(rawDx, rawDy);
    const angle = Math.atan2(rawDy, rawDx);

    const clampedDist = Math.min(dist, baseRadius);
    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;

    joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;

    const normX = knobX / baseRadius;
    const normY = knobY / baseRadius;
    const isSprint = clampedDist > baseRadius * 0.85;

    callbacks.onMove(normX, normY, isSprint);
  }

  joystickZone.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });
  window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  // Кнопки действий
  const btnAttack = container.querySelector('#touch-btn-attack') as HTMLElement;
  const btnParry = container.querySelector('#touch-btn-parry') as HTMLElement;
  const btnMagic = container.querySelector('#touch-btn-magic') as HTMLElement;
  const btnInteract = container.querySelector('#touch-btn-interact') as HTMLElement;
  const btnInv = container.querySelector('#touch-btn-inv') as HTMLElement;
  const btnHeal = container.querySelector('#touch-btn-heal') as HTMLElement;

  btnAttack.addEventListener('touchstart', (e) => {
    e.preventDefault();
    callbacks.onAttack();
  });

  let parryHeld = false;
  btnParry.addEventListener('touchstart', (e) => {
    e.preventDefault();
    parryHeld = !parryHeld;
    btnParry.classList.toggle('active', parryHeld);
    callbacks.onParry(parryHeld);
  });

  btnMagic.addEventListener('touchstart', (e) => {
    e.preventDefault();
    callbacks.onMagic();
  });

  btnInteract.addEventListener('touchstart', (e) => {
    e.preventDefault();
    callbacks.onInteract();
  });

  btnInv.addEventListener('touchstart', (e) => {
    e.preventDefault();
    callbacks.onInventory();
  });

  btnHeal.addEventListener('touchstart', (e) => {
    e.preventDefault();
    callbacks.onHeal();
  });

  // Вращение камеры пальцем по свободной области экрана
  let lookTouchId: number | null = null;
  let lastLookX = 0;
  let lastLookY = 0;

  function handleWindowTouchStart(e: TouchEvent) {
    for (const touch of Array.from(e.changedTouches)) {
      // Если касание не на джойстике и не на кнопках
      const target = touch.target as HTMLElement | null;
      if (
        target &&
        (target.closest('.touch-joystick-zone') ||
          target.closest('.touch-action-pad') ||
          target.closest('.inventory-modal') ||
          target.closest('.encounter-overlay'))
      ) {
        continue;
      }
      if (lookTouchId === null) {
        lookTouchId = touch.identifier;
        lastLookX = touch.clientX;
        lastLookY = touch.clientY;
        break;
      }
    }
  }

  function handleWindowTouchMove(e: TouchEvent) {
    if (lookTouchId === null) return;
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === lookTouchId) {
        const dx = touch.clientX - lastLookX;
        const dy = touch.clientY - lastLookY;
        lastLookX = touch.clientX;
        lastLookY = touch.clientY;

        callbacks.onLook(dx * 0.005, dy * 0.005);
        break;
      }
    }
  }

  function handleWindowTouchEnd(e: TouchEvent) {
    if (lookTouchId === null) return;
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === lookTouchId) {
        lookTouchId = null;
        break;
      }
    }
  }

  window.addEventListener('touchstart', handleWindowTouchStart, { passive: true });
  window.addEventListener('touchmove', handleWindowTouchMove, { passive: true });
  window.addEventListener('touchend', handleWindowTouchEnd, { passive: true });
  window.addEventListener('touchcancel', handleWindowTouchEnd, { passive: true });

  return {
    container,
    destroy: () => {
      container.remove();
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('touchstart', handleWindowTouchStart);
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleWindowTouchEnd);
      window.removeEventListener('touchcancel', handleWindowTouchEnd);
    },
  };
}
