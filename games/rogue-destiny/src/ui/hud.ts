/**
 * Модуль интерфейса игрока (HUD, статус-панель, миникарта, быстрые слоты).
 */
import type { DungeonFloor, PlayerState } from '../core/types.ts';
import { getEffectiveMaxHp, calculateScore } from '../core/player.ts';

export interface HudElements {
  container: HTMLDivElement;
  hpBar: HTMLElement;
  greyHpBar: HTMLElement;
  hpText: HTMLElement;
  heatBar: HTMLElement;
  heatText: HTMLElement;
  heatRedlineIndicator: HTMLElement;
  fatigueBar: HTMLElement;
  fatigueText: HTMLElement;
  threadsContainer: HTMLElement;
  lightBar: HTMLElement;
  scoreText: HTMLElement;
  bestText: HTMLElement;
  floorText: HTMLElement;
  cueBanner: HTMLElement;
  cueText: HTMLElement;
  minimapCanvas: HTMLCanvasElement;
  quickSlotElements: HTMLElement[];
  damageFlash: HTMLElement;
  fateFlash: HTMLElement;
}

export function createHud(): HudElements {
  const container = document.createElement('div');
  container.id = 'hud-container';
  container.innerHTML = `
    <!-- Полноэкранные вспышки урона и Нитей Судьбы -->
    <div id="hud-damage-flash" class="damage-flash"></div>
    <div id="hud-fate-flash" class="fate-flash"></div>

    <!-- Верхняя левая панель: Здоровье, Перегрев, Усталость, Нити -->
    <div class="hud-panel-top-left">
      <!-- Здоровье и Серое здоровье -->
      <div class="bar-group">
        <div class="bar-header">
          <span class="bar-label">ПЛОТЬ (HP)</span>
          <span id="hud-hp-text" class="bar-val">100/100</span>
        </div>
        <div class="bar-track hp-track">
          <div id="hud-grey-hp" class="bar-fill grey-fill"></div>
          <div id="hud-hp-fill" class="bar-fill hp-fill"></div>
        </div>
      </div>

      <!-- Эфирный Перегрев с Красной чертой (80-95%) -->
      <div class="bar-group">
        <div class="bar-header">
          <span class="bar-label">ЭФИРНЫЙ ПЕРЕГРЕВ</span>
          <span id="hud-heat-text" class="bar-val">0%</span>
        </div>
        <div class="bar-track heat-track">
          <div class="redline-zone" title="Красная черта (80-95%): +50% урон заклинаний!"></div>
          <div id="hud-heat-fill" class="bar-fill heat-fill"></div>
        </div>
      </div>

      <!-- Усталость тела -->
      <div class="bar-group">
        <div class="bar-header">
          <span class="bar-label">УСТАЛОСТЬ</span>
          <span id="hud-fatigue-text" class="bar-val">0%</span>
        </div>
        <div class="bar-track fatigue-track">
          <div id="hud-fatigue-fill" class="bar-fill fatigue-fill"></div>
        </div>
      </div>

      <!-- Нити Судьбы и Свет -->
      <div class="status-row">
        <div class="threads-box">
          <span class="status-label">НИТИ СУДЬБЫ:</span>
          <span id="hud-threads" class="threads-icons">✦ ✦ ✧</span>
        </div>
        <div class="light-box">
          <span class="status-label">СВЕТ:</span>
          <div class="light-mini-track">
            <div id="hud-light-fill" class="light-mini-fill"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Верхняя правая панель: Миникарта и Очки -->
    <div class="hud-panel-top-right">
      <div class="floor-badge">
        <span id="hud-floor-text">ЭТАЖ 1: КРИПТЫ</span>
        <span id="hud-score-text" class="score-badge" title="Счёт текущего забега">0 ОЧКОВ</span>
        <span id="hud-best-text" class="score-badge score-best" title="Лучший забег за всё время">РЕКОРД: 0</span>
      </div>
      <canvas id="hud-minimap" width="160" height="120"></canvas>
    </div>

    <!-- Баннер подсказки у двери (Eavesdropping) -->
    <div id="hud-cue-banner" class="cue-banner hidden">
      <div class="cue-icon">👂</div>
      <div id="hud-cue-text" class="cue-message">Из-за двери доносятся шорохи...</div>
    </div>

    <!-- Нижняя панель: Быстрые слоты пояса (1..4) -->
    <div class="hud-quick-slots">
      <div class="quick-slot" data-key="1" title="[1] Посох: боевой взмах и охлаждение тепла">
        <span class="slot-num">1</span>
        <span class="slot-icon">🪄</span>
        <span class="slot-name">Посох</span>
      </div>
      <div class="quick-slot" data-key="2" title="[2] Щит: стойка магического парирования">
        <span class="slot-num">2</span>
        <span class="slot-icon">🛡️</span>
        <span class="slot-name">Щит</span>
      </div>
      <div class="quick-slot" data-key="3" title="[3] Бинт: исцеление плоти на ходу">
        <span class="slot-num">3</span>
        <span class="slot-icon">🩹</span>
        <span class="slot-name">Бинт</span>
      </div>
      <div class="quick-slot" data-key="4" title="[4] Свиток: истинное видение залов и свет">
        <span class="slot-num">4</span>
        <span class="slot-icon">📜</span>
        <span class="slot-name">Свиток</span>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  return {
    container,
    hpBar: container.querySelector('#hud-hp-fill')!,
    greyHpBar: container.querySelector('#hud-grey-hp')!,
    hpText: container.querySelector('#hud-hp-text')!,
    heatBar: container.querySelector('#hud-heat-fill')!,
    heatText: container.querySelector('#hud-heat-text')!,
    heatRedlineIndicator: container.querySelector('.redline-zone')!,
    fatigueBar: container.querySelector('#hud-fatigue-fill')!,
    fatigueText: container.querySelector('#hud-fatigue-text')!,
    threadsContainer: container.querySelector('#hud-threads')!,
    lightBar: container.querySelector('#hud-light-fill')!,
    scoreText: container.querySelector('#hud-score-text')!,
    bestText: container.querySelector('#hud-best-text')!,
    floorText: container.querySelector('#hud-floor-text')!,
    cueBanner: container.querySelector('#hud-cue-banner')!,
    cueText: container.querySelector('#hud-cue-text')!,
    minimapCanvas: container.querySelector('#hud-minimap') as HTMLCanvasElement,
    quickSlotElements: Array.from(container.querySelectorAll('.quick-slot')),
    damageFlash: container.querySelector('#hud-damage-flash')!,
    fateFlash: container.querySelector('#hud-fate-flash')!,
  };
}

export function updateHud(hud: HudElements, player: PlayerState, floor: DungeonFloor): void {
  const effectiveMaxHp = getEffectiveMaxHp(player);
  const hpPercent = (player.hp / player.maxHp) * 100;
  const greyPercent = (player.greyHp / player.maxHp) * 100;

  hud.hpBar.style.width = `${Math.max(0, hpPercent)}%`;
  hud.greyHpBar.style.width = `${Math.min(100, greyPercent)}%`;
  hud.hpText.textContent = `${Math.round(player.hp)} / ${effectiveMaxHp}`;

  hud.heatBar.style.width = `${player.aetherHeat}%`;
  hud.heatText.textContent = `${Math.round(player.aetherHeat)}%`;
  if (player.aetherHeat >= 80 && player.aetherHeat <= 95) {
    hud.heatText.classList.add('text-redline');
  } else {
    hud.heatText.classList.remove('text-redline');
  }

  hud.fatigueBar.style.width = `${player.fatigue}%`;
  hud.fatigueText.textContent = `${Math.round(player.fatigue)}%`;

  // Нити Судьбы
  let threadsStr = '';
  for (let i = 0; i < player.maxThreads; i++) {
    threadsStr += i < player.threadsOfFate ? '✦ ' : '✧ ';
  }
  hud.threadsContainer.textContent = threadsStr.trim();

  // Свет
  hud.lightBar.style.width = `${player.lightSupply}%`;

  // Очки и этаж
  const totalScore = calculateScore(player);
  hud.scoreText.textContent = `ЗАБЕГ: ${totalScore}`;
  hud.scoreText.title = `Итоговый расчётный счёт: ${totalScore} (Очки открытий: ${player.score})`;
  hud.floorText.textContent = `ЭТАЖ ${player.currentFloor}: КРИПТЫ`;
}

export function drawMinimap(canvas: HTMLCanvasElement, floor: DungeonFloor): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scale = 2.2;
  const offsetX = 20;
  const offsetY = 60;

  // Отрисовка связей
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  for (const [rAId, rBId] of floor.connections) {
    const rA = floor.rooms.find((r) => r.id === rAId);
    const rB = floor.rooms.find((r) => r.id === rBId);
    if (!rA || !rB || (!rA.isRevealed && !rB.isRevealed)) continue;

    ctx.beginPath();
    ctx.moveTo(rA.x * scale + offsetX, rA.y * scale + offsetY);
    ctx.lineTo(rB.x * scale + offsetX, rB.y * scale + offsetY);
    ctx.stroke();
  }

  // Отрисовка комнат
  for (const room of floor.rooms) {
    const rx = room.x * scale + offsetX - 8;
    const ry = room.y * scale + offsetY - 8;

    if (!room.isRevealed) {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(rx, ry, 16, 16);
      ctx.strokeStyle = '#334155';
      ctx.strokeRect(rx, ry, 16, 16);
      continue;
    }

    if (room.id === floor.activeRoomId) {
      ctx.fillStyle = '#38bdf8'; // Текущая комната игрока
    } else if (room.hasAetherRift) {
      ctx.fillStyle = '#818cf8'; // Разлом
    } else {
      ctx.fillStyle = '#64748b'; // Обычная посещенная
    }

    ctx.fillRect(rx, ry, 16, 16);
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(rx, ry, 16, 16);

    if (room.hasAetherRift) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.fillText('⚡', rx + 3, ry + 12);
    }
  }
}

export function triggerDamageFlash(hud: HudElements): void {
  hud.damageFlash.classList.remove('active');
  void hud.damageFlash.offsetWidth; // Force reflow
  hud.damageFlash.classList.add('active');
}

export function triggerFateFlash(hud: HudElements): void {
  hud.fateFlash.classList.remove('active');
  void hud.fateFlash.offsetWidth;
  hud.fateFlash.classList.add('active');
}

/**
 * Рекорд рядом со счётом забега: это разные числа - текущий забег и лучший за всё время
 * (вопрос владельца на приёмке: "260 над миникартой, а рекорд 795").
 */
export function setHudBest(hud: HudElements, best: number): void {
  hud.bestText.textContent = `РЕКОРД: ${best}`;
}
