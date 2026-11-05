/**
 * Модуль сценарных энкаунтеров: Стелс-проверки, QTE-взлом мимика и диалог Эфирного Разлома.
 */
import { CODEX, type CodexEntry } from '../core/codex.ts';
import type { ChapterObjective } from '../core/objective.ts';
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

export interface MenuProgress {
  highScore:number;totalRuns:number;victories:number;highestFloor:number;codex:readonly CodexEntry[];
  floor:number;objective:ChapterObjective;
}
export interface EncountersUI {
  showBusy: (text:string) => void;
  hideBusy: () => void;
  showStartMenu: (continuing: boolean, onPlay: () => void, onRestart: () => void, onSound: () => boolean, muted: boolean, progress: MenuProgress) => void;
  showStealthModal: (title: string, choices: StealthChoice[], fate?: {threads:number;change:(enabled:boolean)=>void}) => void;
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
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !overlay.querySelector('.title-card')) return;
    const controls = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

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
    hideBusy: () => {if(overlay.querySelector('.busy-card'))overlay.classList.add('hidden');},
    showBusy: (text:string) => {
      overlay.replaceChildren();const card=document.createElement('div');card.className='encounter-card busy-card';card.setAttribute('role','status');card.setAttribute('aria-live','polite');
      const title=document.createElement('div');title.className='enc-header';title.textContent=text;
      const detail=document.createElement('p');detail.className='enc-desc';detail.textContent='Записываем пройденный путь. Время в криптах остановлено.';card.append(title,detail);overlay.append(card);overlay.classList.remove('hidden');
    },
    showStartMenu: (continuing, onPlay, onRestart, onSound, muted, progress) => {
      overlay.innerHTML = `
        <section class="title-card" role="dialog" aria-modal="true" aria-label="Rogue Destiny">
          <div class="title-eyebrow">ЗАТОПЛЕННЫЕ КРИПТЫ · ГЛАВА I</div>
          <h1 class="game-title">ROGUE<span>DESTINY</span></h1>
          <p class="title-story">Ваши магические каналы сожжены. Чужие реликвии - последняя надежда пройти крипты и добраться до Стража Семени.</p>
          <div class="title-rule"><b>Огонь даёт силу.</b> Посох охлаждает перегрев. Щит ловит момент. Ранец решает исход.</div>
          <div class="title-actions">
            <button id="title-play" class="action-btn btn-gold" type="button">${continuing ? 'Продолжить путь' : 'Войти в крипты'}</button>
            ${continuing ? '<button id="title-restart" class="action-btn btn-secondary" type="button">Начать новый забег</button>' : ''}
            <button id="title-sound" class="action-btn btn-secondary" type="button">Звук: ${muted ? 'выключен' : 'включён'}</button>
            <button id="title-fullscreen" class="action-btn btn-secondary" type="button">На весь экран</button>
          </div>
          <div class="title-progress" aria-label="Память прошлых путей">
            <div class="title-section-label">ПАМЯТЬ СТРАННИКА</div>
            <div id="title-records" class="title-records"></div>
            <div id="title-knowledge" class="title-knowledge"></div>
            <p id="title-objective" class="title-objective"></p>
          </div>
          <div class="title-controls">
            <div><b>ПК</b><span>WASD - движение · мышь - обзор<br>ЛКМ - посох · ПКМ - парирование / блок<br>Space - скачок · Q - магия · V - сброс жара<br>X - срыв Ядра за Нить · 1-4 - пояс<br>E - действие · Tab - ранец · Esc - пауза</span></div>
            <div><b>ТЕЛЕФОН</b><span>Слева - движение, справа - камера.<br>Касание справа - атака посохом.<br>Скачок, щит, магия и ранец - кнопками.<br>Три этажа. Одна судьба.</span></div>
          </div>
          <p class="title-footnote">Ранец не останавливает время. Бинты, вода и пайки действуют за 3 с. Свитки расходуются. Разлом восстанавливает силы и стартовый камень.</p>
        </section>`;
      overlay.classList.remove('hidden');
      const records=overlay.querySelector('#title-records')!;
      for(const [label,value] of [['РЕКОРД',progress.highScore],['ПОПЫТКИ ЗАВЕРШЕНЫ',progress.totalRuns],['ПОБЕДЫ',progress.victories],['ГЛУБИНА',`${Math.min(3,progress.highestFloor)} / 3`]]) {
        const entry=document.createElement('div'),caption=document.createElement('span'),number=document.createElement('b');
        caption.textContent=String(label);number.textContent=String(value);entry.append(caption,number);records.append(entry);
      }
      const knowledge=overlay.querySelector('#title-knowledge')!;
      if(!progress.codex.length) knowledge.textContent='Пока нет записей Кодекса. Знания, найденные в криптах, переживут новый забег.';
      for(const key of progress.codex) {const chip=document.createElement('span');chip.textContent=CODEX[key].title;chip.title=CODEX[key].description;knowledge.append(chip);}
      overlay.querySelector('#title-objective')!.textContent=`Этаж ${progress.floor}/3 · ${progress.objective.title}. ${progress.objective.detail}`;
      const play = overlay.querySelector<HTMLButtonElement>('#title-play')!;
      play.addEventListener('click', () => { overlay.classList.add('hidden'); onPlay(); });
      overlay.querySelector('#title-restart')?.addEventListener('click', () => { overlay.classList.add('hidden'); onRestart(); });
      overlay.querySelector('#title-fullscreen')!.addEventListener('click', () => {
        if (document.fullscreenElement) { notify('Полный экран уже включён.'); return; }
        const enter = document.documentElement.requestFullscreen;
        if (enter) void enter.call(document.documentElement).catch(() => notify('Полный экран недоступен в этом браузере.'));
        else notify('Полный экран недоступен в этом браузере.');
      });
      const sound = overlay.querySelector('#title-sound')!;
      sound.addEventListener('click', () => { sound.textContent = onSound() ? 'Звук: выключен' : 'Звук: включён'; });
      play.focus();
    },

    showStealthModal: (title, choices, fate) => {
      overlay.innerHTML = `
        <div class="encounter-card stealth-card">
          <div class="enc-header">🗡️ СЦЕНАРИЙ СКРЫТНОГО ДЕЙСТВИЯ</div>
          <div class="enc-title">${title}</div>
          ${fate?`<label class="fate-reroll"><input id="stealth-fate-retry" type="checkbox" ${fate.threads>0?'':'disabled'}><span>Разрешить один переброс при провале · -1 активная Нить только после неудачи. Сейчас: ${fate.threads}.</span></label>`:''}
          <div class="enc-choices">
            ${choices
              .map(
                (c, idx) => `
              <button class="choice-btn risk-${c.risk}" data-idx="${idx}">
                <div class="btn-text">${c.text}</div>
                <div class="btn-meta">Риск: ${{low:'НИЗКИЙ',medium:'СРЕДНИЙ',high:'ВЫСОКИЙ'}[c.risk]} | Награда: ${c.reward}</div>
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

      overlay.querySelector<HTMLInputElement>('#stealth-fate-retry')?.addEventListener('change',event=>fate?.change((event.currentTarget as HTMLInputElement).checked));
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
          <div class="enc-header gold-text">${breakdown.floor >= 3 ? '🌱 КРИПТЫ ОСВОБОЖДЕНЫ' : 'ДРЕВНИЙ ПОРТАЛ ОТКРЫТ'}</div>
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
            <button id="victory-next" class="action-btn btn-gold">${breakdown.floor >= 3 ? '✨ Новый забег' : `🌀 Спуститься на этаж ${breakdown.floor + 1}`}</button>
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
