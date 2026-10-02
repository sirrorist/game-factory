/**
 * Модуль сценарных энкаунтеров: Стелс-проверки, QTE-взлом мимика и диалог Эфирного Разлома.
 */
import { QTE_ZONE, qteHit, qteSpeed, qteStep } from '../core/qte.ts';
import { pruneNotifications, pushNotification, type Notice } from '../core/notifications.ts';
export interface StealthChoice {
  text: string;
  risk: 'low' | 'medium' | 'high';
  reward: string;
  action: () => void;
}

export interface ScoreBreakdown {
  floor: number;
  floorPoints: number;
  elites: number;
  elitesPoints: number;
  threads: number;
  threadsPoints: number;
  injuries: number;
  injuriesPenalty: number;
  discoveryPoints: number;
  totalScore: number;
  isNewRecord?: boolean;
  bestScore?: number;
}

export interface EncountersUI {
  showStealthModal: (title: string, choices: StealthChoice[]) => void;
  showMimicQte: (onSuccess: () => void, onFailure: () => void) => void;
  showAetherRiftModal: (onRest: () => void, onSave: () => void, onLeave: () => void) => void;
  showVictoryModal: (breakdown: ScoreBreakdown, onNextFloor: () => void, onRestart: () => void) => void;
  showDeathModal: (breakdown: ScoreBreakdown, onRestart: () => void) => void;
  showNotification: (text: string) => void;
}

export function createEncountersUI(): EncountersUI {
  const overlay = document.createElement('div');
  overlay.id = 'encounter-overlay';
  overlay.className = 'encounter-overlay hidden';
  document.body.appendChild(overlay);

  // Стек уведомлений под статами персонажа (максимум 3)
  const notifStack = document.createElement('div');
  notifStack.id = 'encounter-notif-stack';
  notifStack.className = 'notifications-stack';
  document.body.appendChild(notifStack);

  let notices: Notice[] = [];
  let pruneTimer = 0;

  /** Стек - сразу под панелью статистики, какой бы высоты она ни была (ПК, телефон). */
  function placeStack() {
    const panel = document.querySelector('.hud-panel-top-left');
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    notifStack.style.top = `${Math.round(r.bottom + 8)}px`;
    notifStack.style.left = `${Math.round(r.left)}px`;
    notifStack.style.width = `${Math.round(r.width)}px`;
  }

  function renderNotices() {
    const now = performance.now();
    notices = pruneNotifications(notices, now);
    placeStack();
    const keep = new Set(notices.map((n) => String(n.id)));
    for (const el of Array.from(notifStack.children) as HTMLElement[]) {
      if (!keep.has(el.dataset.id ?? '')) el.remove();
    }
    for (const n of notices) {
      let el = notifStack.querySelector<HTMLElement>(`[data-id="${n.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'notification-toast';
        el.dataset.id = String(n.id);
        notifStack.appendChild(el);
      }
      el.textContent = n.count > 1 ? `${n.text} ×${n.count}` : n.text;
      el.classList.toggle('fading', n.expiresAt - now < 400);
    }
    clearTimeout(pruneTimer);
    if (notices.length > 0) {
      const soonest = Math.min(...notices.map((n) => n.expiresAt - 400));
      pruneTimer = window.setTimeout(renderNotices, Math.max(50, soonest - now));
    }
  }

  function notify(text: string) {
    notices = pushNotification(notices, text, performance.now());
    renderNotices();
  }

  window.addEventListener('resize', placeStack);

  return {
    showNotification: notify,

    showStealthModal: (title, choices) => {
      overlay.innerHTML = `
        <div class="encounter-card stealth-card">
          <div class="enc-header">🗡️ СЦЕНАРИЙ СКРЫТНОГО ДЕЙСТВИЯ</div>
          <div class="enc-title">${title}</div>
          <div class="enc-choices">
            ${choices
              .map(
                (c, idx) => `
              <button class="choice-btn risk-${c.risk}" data-idx="${idx}">
                <div class="btn-text">${c.text}</div>
                <div class="btn-meta">Риск: ${c.risk.toUpperCase()} | Награда: ${c.reward}</div>
              </button>
            `,
              )
              .join('')}
          </div>
        </div>
      `;
      overlay.classList.remove('hidden');
      document.exitPointerLock();
      setTimeout(() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }, 20);

      overlay.querySelectorAll('.choice-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const idx = Number((e.currentTarget as HTMLElement).dataset.idx);
          overlay.classList.add('hidden');
          choices[idx]?.action();
        });
      });
    },

    showMimicQte: (onSuccess, onFailure) => {
      let stage = 0;
      overlay.innerHTML = `
        <div class="encounter-card qte-card">
          <div class="enc-header">📦 СПОРОВЫЙ МИМИК - ОСТОРОЖНЫЙ ВЗЛОМ</div>
          <div class="enc-desc">Срежьте усик, когда ползунок в зелёной зоне. Три усика - три среза.</div>
          <div id="qte-track-el" class="qte-track">
            <div id="qte-zone" class="qte-zone" style="left: ${QTE_ZONE.from}%; width: ${QTE_ZONE.to - QTE_ZONE.from}%"></div>
            <div id="qte-cursor" class="qte-cursor"></div>
          </div>
          <div id="qte-stage" class="qte-stage">Усик: 1 / 3</div>
          <div class="qte-hint qte-hint-desktop">[ПРОБЕЛ] или [ЛКМ] - срез</div>
          <div class="qte-hint qte-hint-touch">Коснитесь экрана - срез</div>
        </div>
      `;
      // Захват мыши не снимаем: курсор в QTE не нужен, а после снятия захвата часть систем
      // (Chromium на Wayland) глотает первый клик, пока мышь не сдвинется (приёмка, пункт 8).
      overlay.classList.remove('hidden');

      const cursor = overlay.querySelector('#qte-cursor') as HTMLElement;
      const stageText = overlay.querySelector('#qte-stage') as HTMLElement;
      const trackEl = overlay.querySelector('#qte-track-el') as HTMLElement;
      let pos = 4;
      let dir = 1;
      let lastFrame = performance.now();
      let animId = 0;
      let cutLockedUntil = 0;
      let isCompleted = false;
      // Тот же клик приходит и как pointerdown, и как mousedown - считаем один раз.
      let lastInputAt = -1;

      function loop(now: number) {
        // Скорость - в процентах дорожки за секунду, а не за кадр: на мониторе 144 Гц
        // ползунок раньше бежал в 2.4 раза быстрее, чем на 60 Гц (приёмка, пункт 3).
        const dt = Math.min(0.05, (now - lastFrame) / 1000);
        lastFrame = now;
        const next = qteStep(pos, dir, qteSpeed(stage), dt);
        pos = next.pos;
        dir = next.dir;
        cursor.style.left = `${pos}%`;
        if (!isCompleted) animId = requestAnimationFrame(loop);
      }
      animId = requestAnimationFrame(loop);

      function attemptCut() {
        const now = performance.now();
        if (isCompleted || now < cutLockedUntil) return;

        if (qteHit(pos)) {
          stage += 1;
          trackEl.classList.add('qte-flash-hit');
          setTimeout(() => trackEl.classList.remove('qte-flash-hit'), 220);

          if (stage >= 3) {
            isCompleted = true;
            cleanup();
            onSuccess();
          } else {
            stageText.textContent = `Усик: ${stage + 1} / 3`;
            cutLockedUntil = now + 300;
          }
        } else {
          isCompleted = true;
          trackEl.classList.add('qte-flash-miss');
          cleanup();
          onFailure();
        }
      }

      function onInput(e: Event) {
        if (e.timeStamp - lastInputAt < 50) return;
        lastInputAt = e.timeStamp;
        e.preventDefault();
        e.stopPropagation();
        attemptCut();
      }

      function handleKey(e: KeyboardEvent) {
        if (e.code !== 'Space') return;
        e.preventDefault();
        if (e.repeat) return; // зажатый пробел не режет все усики подряд
        onInput(e);
      }

      function handlePointer(e: PointerEvent | MouseEvent) {
        if (e.button === 0) onInput(e);
      }

      function cleanup() {
        cancelAnimationFrame(animId);
        window.removeEventListener('keydown', handleKey, true);
        window.removeEventListener('pointerdown', handlePointer, true);
        window.removeEventListener('mousedown', handlePointer, true);
        overlay.classList.add('hidden');
      }

      window.addEventListener('keydown', handleKey, true);
      window.addEventListener('pointerdown', handlePointer, true);
      window.addEventListener('mousedown', handlePointer, true);
    },

    showAetherRiftModal: (onRest, onSave, onLeave) => {
      overlay.innerHTML = `
        <div class="encounter-card rift-card">
          <div class="enc-header">⚡ ЭФИРНЫЙ РАЗЛОМ (ЛЕЙ-ЛИНИЯ МАНЫ)</div>
          <div class="enc-desc">Из трещины в камне бьёт чистый лазурный свет. Ваши сожжённые каналы наполняются силой, а тьма отступает.</div>
          <div class="rift-buttons">
            <button id="rift-rest" class="rift-btn">🌿 Вдохнуть эфир (Исцелить серое HP и усталость)</button>
            <button id="rift-save" class="rift-btn">💾 Настроиться на кристалл (Сохранить прогресс забега)</button>
            <button id="rift-leave" class="rift-btn btn-secondary">🚪 Вернуться в крипты</button>
          </div>
        </div>
      `;
      overlay.classList.remove('hidden');
      document.exitPointerLock();
      setTimeout(() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }, 20);

      overlay.querySelector('#rift-rest')!.addEventListener('click', () => {
        overlay.classList.add('hidden');
        onRest();
      });

      overlay.querySelector('#rift-save')!.addEventListener('click', () => {
        overlay.classList.add('hidden');
        onSave();
      });

      overlay.querySelector('#rift-leave')!.addEventListener('click', () => {
        overlay.classList.add('hidden');
        onLeave();
      });
    },

    showVictoryModal: (breakdown, onNextFloor, onRestart) => {
      overlay.innerHTML = `
        <div class="encounter-card victory-card">
          <div class="enc-header gold-text">🏆 ТРИУМФ ВО ТЬМЕ: ДРЕВНИЙ ПОРТАЛ ОТКРЫТ</div>
          <div class="enc-desc">Опальный маг преодолел первородные заросли, одолел стражей и настроил резонанс древнего портала. Врата в глубины распахиваются!</div>
          
          <div class="score-ledger">
            <div class="ledger-row">
              <span class="ledger-label">🏛️ Исследованный этаж:</span>
              <span class="ledger-val">+${breakdown.floorPoints} (${breakdown.floor} × 100)</span>
            </div>
            <div class="ledger-row">
              <span class="ledger-label">🗡️ Поверженные элиты Сильванов:</span>
              <span class="ledger-val">+${breakdown.elitesPoints} (${breakdown.elites} × 25)</span>
            </div>
            <div class="ledger-row">
              <span class="ledger-label">✨ Уцелевшие Нити Судьбы:</span>
              <span class="ledger-val">+${breakdown.threadsPoints} (${breakdown.threads} × 50)</span>
            </div>
            <div class="ledger-row penalty">
              <span class="ledger-label">🩸 Полученные серые травмы плоти:</span>
              <span class="ledger-val">-${breakdown.injuriesPenalty} (${breakdown.injuries} × 5)</span>
            </div>
            <div class="ledger-row">
              <span class="ledger-label">📜 Очки открытий и реликвий:</span>
              <span class="ledger-val">+${breakdown.discoveryPoints}</span>
            </div>
            <div class="ledger-divider"></div>
            <div class="ledger-total">
              <span class="total-title">ИТОГОВЫЙ СЧЁТ ЗАБЕГА:</span>
              <span class="total-score-number gold">${breakdown.totalScore}</span>
            </div>
            ${breakdown.isNewRecord ? `<div class="record-badge gold">🌟 НОВЫЙ ЛИЧНЫЙ РЕКОРД В ХАБЕ! 🌟</div>` : (breakdown.bestScore !== undefined ? `<div class="record-badge muted">Лучший счёт в хабе: ${breakdown.bestScore}</div>` : '')}
          </div>

          <div class="modal-actions">
            <button id="victory-next" class="action-btn btn-gold">🌀 Спуститься на Этаж ${breakdown.floor + 1}</button>
            <button id="victory-restart" class="action-btn btn-secondary">🔄 Начать новый забег (Сброс)</button>
          </div>
        </div>
      `;
      overlay.classList.remove('hidden');
      document.exitPointerLock();
      setTimeout(() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }, 20);

      overlay.querySelector('#victory-next')!.addEventListener('click', () => {
        overlay.classList.add('hidden');
        onNextFloor();
      });

      overlay.querySelector('#victory-restart')!.addEventListener('click', () => {
        overlay.classList.add('hidden');
        onRestart();
      });
    },

    showDeathModal: (breakdown, onRestart) => {
      overlay.innerHTML = `
        <div class="encounter-card death-card">
          <div class="enc-header crimson-text">💀 НИТИ СУДЬБЫ ОБОЛОЧКИ ИСЧЕРПАНЫ</div>
          <div class="enc-desc">Плоть мага разорвана когтями Сильванов, а сожжённые каналы магии развеялись в сырой тьме крипт. Ваша душа ждёт нового перерождения.</div>
          
          <div class="score-ledger">
            <div class="ledger-row">
              <span class="ledger-label">🏛️ Достигнутый этаж:</span>
              <span class="ledger-val">+${breakdown.floorPoints} (${breakdown.floor} × 100)</span>
            </div>
            <div class="ledger-row">
              <span class="ledger-label">🗡️ Поверженные элиты:</span>
              <span class="ledger-val">+${breakdown.elitesPoints} (${breakdown.elites} × 25)</span>
            </div>
            <div class="ledger-row">
              <span class="ledger-label">✨ Оставшиеся Нити:</span>
              <span class="ledger-val">+${breakdown.threadsPoints} (${breakdown.threads} × 50)</span>
            </div>
            <div class="ledger-row penalty">
              <span class="ledger-label">🩸 Травмы плоти (штраф):</span>
              <span class="ledger-val">-${breakdown.injuriesPenalty} (${breakdown.injuries} × 5)</span>
            </div>
            <div class="ledger-row">
              <span class="ledger-label">📜 Очки открытий:</span>
              <span class="ledger-val">+${breakdown.discoveryPoints}</span>
            </div>
            <div class="ledger-divider"></div>
            <div class="ledger-total">
              <span class="total-title">ИТОГОВЫЙ СЧЁТ ЗАБЕГА:</span>
              <span class="total-score-number crimson">${breakdown.totalScore}</span>
            </div>
            ${breakdown.isNewRecord ? `<div class="record-badge gold">🌟 НОВЫЙ ЛИЧНЫЙ РЕКОРД В ХАБЕ! 🌟</div>` : (breakdown.bestScore !== undefined ? `<div class="record-badge muted">Лучший счёт в хабе: ${breakdown.bestScore}</div>` : '')}
          </div>

          <div class="modal-actions">
            <button id="death-restart" class="action-btn btn-crimson">🔄 Новое перерождение мага</button>
          </div>
        </div>
      `;
      overlay.classList.remove('hidden');
      document.exitPointerLock();
      setTimeout(() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }, 20);

      overlay.querySelector('#death-restart')!.addEventListener('click', () => {
        overlay.classList.add('hidden');
        onRestart();
      });
    },
  };
}
