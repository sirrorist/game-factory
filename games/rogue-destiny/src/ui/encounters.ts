/**
 * Модуль сценарных энкаунтеров: Стелс-проверки, QTE-взлом мимика и диалог Эфирного Разлома.
 */
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

  function notify(text: string) {
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.textContent = text;

    // Ограничение: максимум 3 уведомления одновременно
    while (notifStack.children.length >= 3) {
      notifStack.firstElementChild?.remove();
    }

    notifStack.appendChild(toast);

    // Увеличенное время показа: 4.2 секунды
    setTimeout(() => {
      toast.classList.add('fading');
      setTimeout(() => {
        toast.remove();
      }, 350);
    }, 4200);
  }

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
          <div class="enc-header">📦 СПОРОВЫЙ МИМИК — ОСТОРОЖНЫЙ ВЗЛОМ</div>
          <div class="enc-desc">Нажмите ПРОБЕЛ или кликните ЛКМ точно в зелёной зоне, чтобы срезать усики!</div>
          <div id="qte-track-el" class="qte-track">
            <div id="qte-zone" class="qte-zone"></div>
            <div id="qte-cursor" class="qte-cursor"></div>
          </div>
          <div id="qte-stage" class="qte-stage">Усик: 1 / 3</div>
          <div class="qte-hint">Клавиша [ПРОБЕЛ] или [ЛКМ] в любом месте экрана</div>
        </div>
      `;
      overlay.classList.remove('hidden');
      document.exitPointerLock();
      setTimeout(() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }, 20);

      const cursor = overlay.querySelector('#qte-cursor') as HTMLElement;
      const stageText = overlay.querySelector('#qte-stage') as HTMLElement;
      const trackEl = overlay.querySelector('#qte-track-el') as HTMLElement;
      let pos = 10;
      let speed = 1.15; // Комфортная скорость ползунка
      let animId: number;
      let cutCooldown = false;
      let isCompleted = false;

      function loop() {
        pos += speed;
        if (pos >= 98) {
          pos = 98;
          speed = -Math.abs(speed);
        } else if (pos <= 2) {
          pos = 2;
          speed = Math.abs(speed);
        }
        cursor.style.left = `${pos}%`;
        if (!isCompleted) {
          animId = requestAnimationFrame(loop);
        }
      }
      animId = requestAnimationFrame(loop);

      function attemptCut() {
        if (cutCooldown || isCompleted) return;

        // Зеленая зона среза: 36%..68%
        if (pos >= 36 && pos <= 68) {
          stage += 1;
          cutCooldown = true;
          trackEl.classList.add('qte-flash-hit');
          setTimeout(() => trackEl.classList.remove('qte-flash-hit'), 220);

          if (stage >= 3) {
            isCompleted = true;
            cleanup();
            notify('✨ Реликварий вскрыт без шума! Получена ценная добыча.');
            onSuccess();
          } else {
            stageText.textContent = `Усик: ${stage + 1} / 3`;
            notify(`✓ Усик ${stage}/3 аккуратно срезан!`);
            // Небольшое ускорение на следующем усике
            speed = (Math.abs(speed) + 0.25) * Math.sign(speed);
            setTimeout(() => {
              cutCooldown = false;
            }, 300);
          }
        } else {
          isCompleted = true;
          trackEl.classList.add('qte-flash-miss');
          cleanup();
          notify('💥 ОШИБКА: Мимик проснулся с яростным ревом!');
          onFailure();
        }
      }

      function handleKey(e: KeyboardEvent) {
        if (e.repeat) return; // Защита от автоповтора при зажатии пробела
        if (e.code === 'Space') {
          e.preventDefault();
          attemptCut();
        }
      }

      function handlePointer(e: PointerEvent | MouseEvent) {
        if (e.button === 0) {
          e.preventDefault();
          attemptCut();
        }
      }

      function cleanup() {
        cancelAnimationFrame(animId);
        window.removeEventListener('keydown', handleKey);
        window.removeEventListener('pointerdown', handlePointer);
        overlay.classList.add('hidden');
      }

      window.addEventListener('keydown', handleKey);
      window.addEventListener('pointerdown', handlePointer);
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
