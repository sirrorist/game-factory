/**
 * Модуль отображения и взаимодействия с рюкзаком (Tarkov-инвентарь).
 * Перетаскивание - pointer-событиями, а не HTML5 drag-and-drop: тот на телефоне не работает.
 * Поворот - R, ПКМ или касание предмета без сдвига.
 */
import {fateReserves} from '../core/fate.ts';
import { canAbsorbHeat } from '../core/cooling.ts';
import { inventoryWarnings, PAPER_BURN_SECONDS, POTION_POISON_SECONDS } from '../core/inventory-hazards.ts';
import { CODEX, type CodexEntry } from '../core/codex.ts';
import { fuseScrolls } from '../core/crafting.ts';
import { beltItem, fitsBelt } from '../core/belt.ts';
import type { InventoryGrid, InventoryItem } from '../core/types.ts';
import {
  calculateInventoryStats,
  canPlaceItem,
  placeItem,
  getRotatedCoords,
} from '../core/inventory.ts';

export interface InventoryView {
  container: HTMLDivElement;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  render: () => void;
  refreshHazards: () => void;
  /** Кнопка ✕ в ранце (на телефоне нет TAB): main.ts закрывает ранец своим путём. */
  onClose: (fn: () => void) => void;
}

export function createInventoryView(grid: InventoryGrid, onMove?: (dx: number, dz: number, sprint: boolean) => void, getCodex?: () => readonly CodexEntry[], onDrop?: (itemId: string) => void, onCool?: (method: 'item' | 'water', itemId?: string) => void, fate?: {state:()=>{active:number;max:number;scoutable:boolean};weave:()=>void;scout:()=>void}): InventoryView {
  const container = document.createElement('div');
  container.id = 'inventory-modal';
  container.className = 'inventory-modal hidden';
  container.innerHTML = `
    <div class="inv-move-dock" aria-label="Движение с открытым ранцем">
      <span>ДВИЖЕНИЕ</span>
      <button type="button" data-move="0,-1" aria-label="Идти вперёд">↑</button>
      <button type="button" data-move="-1,0" aria-label="Идти влево">←</button>
      <button type="button" data-move="0,1" aria-label="Идти назад">↓</button>
      <button type="button" data-move="1,0" aria-label="Идти вправо">→</button>
      <button type="button" data-move="0,0" aria-label="Бежать">БЕГ</button>
    </div>
    <div class="inventory-window">
      <div class="inv-header">
        <div class="inv-title">🎒 ПОХОДНЫЙ РАНЕЦ МАГА (ТАРКОВ-СЕТКА)</div>
        <div class="inv-hint inv-hint-desktop">TAB - закрыть | R или ПКМ - повернуть | перетаскивание - ЛКМ</div>
        <div class="inv-hint inv-hint-touch">Перетащите пальцем | касание - повернуть</div>
        <button id="inv-close" class="inv-close" type="button" aria-label="Закрыть ранец">✕</button>
      </div>

      <div class="inv-body">
        <!-- Сетка ячеек -->
        <div class="grid-section">
          <div id="inv-grid-board" class="inv-grid-board" style="--cols: ${grid.width}; --rows: ${grid.height};"></div>
        </div>

        <!-- Боковая панель характеристик, управления и веса -->
        <div class="inv-sidebar">
          <div class="stat-card" id="inv-fate-card">
            <div class="stat-title">НИТИ СУДЬБЫ</div>
            <p id="inv-fate-count" class="craft-feedback"></p>
            <button type="button" id="inv-fate-weave" class="action-btn btn-secondary">Вплести Нить из ранца</button>
            <button type="button" id="inv-fate-scout" class="action-btn btn-secondary">Разведать соседние залы · -1 Нить</button>
          </div>
          <div class="stat-card">
            <div class="stat-title">ПОЯС: ПРЕДМЕТЫ 1-4</div>
            <div id="inv-belt"></div>
          </div>
          <div class="stat-card">
            <div class="stat-title">СЛИЯНИЕ СВИТКОВ</div>
            <div id="inv-crafting"></div>
          </div>
          <div class="stat-card" id="inv-cooling-card">
            <div class="stat-title">ОТВОД ТЕПЛА</div>
            <div id="inv-cooling"></div>
          </div>
          <div class="stat-card" id="inv-drop-card">
            <div class="stat-title">РАЗГРУЗИТЬ РАНЕЦ</div>
            <div id="inv-drop"></div>
          </div>
          <div class="stat-card">
            <div class="stat-title">КОДЕКС</div>
            <div id="inv-codex"></div>
          </div>
          <div class="stat-card">
            <div class="stat-title">ВЕС И НАГРУЗКА</div>
            <div id="inv-weight-val" class="stat-big">0.0 кг</div>
            <div id="inv-weight-class" class="weight-badge light">ЛЕГКИЙ ШАГ (БЕСШУМНОСТЬ)</div>
          </div>

          <div class="stat-card">
            <div class="stat-title">РЕЗОНАНС И БРОНЯ</div>
            <p id="inv-hazards" class="inventory-hazards"></p>
            <div class="res-row"><span>Броня:</span> <strong id="inv-armor-val">0</strong></div>
            <div class="res-row"><span>Огонь к атакам:</span> <strong id="inv-fire-val">+0</strong></div>
            <div class="res-row"><span>Яд на лезвиях:</span> <strong id="inv-poison-val">+0</strong></div>
            <div class="res-row"><span>Свитки (макс.):</span> <strong id="inv-scroll-val">×1.00</strong></div>
            <div class="res-row"><span>Крит. шанс:</span> <strong id="inv-crit-val">+0%</strong></div>
          </div>

          <!-- Памятка управления: на ПК - клавиши, на телефоне - жесты (body.touch-enabled) -->
          <div class="stat-card controls-card controls-desktop">
            <div class="stat-title">УПРАВЛЕНИЕ МАГОМ</div>
            <div class="control-row"><span class="key-badge">WASD</span><span>Перемещение</span></div>
            <div class="control-row"><span class="key-badge">Space</span><span>Эфирный скачок</span></div>
            <div class="control-row"><span class="key-badge">Shift</span><span>Рывок / Спринт</span></div>
            <div class="control-row"><span class="key-badge">Мышь</span><span>Обзор камеры</span></div>
            <div class="control-row"><span class="key-badge">ЛКМ / [1]</span><span>Удар посохом (охлаждение)</span></div>
            <div class="control-row"><span class="key-badge">ПКМ</span><span>Короткое нажатие - парирование, удержание - блок</span></div>
            <div class="control-row"><span class="key-badge">[2]</span><span>Стойка парирования вкл / выкл</span></div>
            <div class="control-row"><span class="key-badge">[3] / [4]</span><span>Бинт / Свиток света</span></div>
            <div class="control-row"><span class="key-badge">[Q]</span><span>Боевая магия</span></div>
            <div class="control-row"><span class="key-badge">[V]</span><span>Сброс перегрева</span></div>
            <div class="control-row"><span class="key-badge">[X]</span><span>Срыв при 95% жара: -1 Нить, 1 HP, разрушение зала</span></div>
            <div class="control-row"><span class="key-badge">[E]</span><span>Взаимодействие</span></div>
            <div class="control-row"><span class="key-badge">[R]</span><span>Поворот предмета</span></div>
            <div class="control-row"><span class="key-badge">TAB / I</span><span>Ранец</span></div>
          </div>
          <div class="stat-card controls-card controls-touch">
            <div class="stat-title">УПРАВЛЕНИЕ НА ТЕЛЕФОНЕ</div>
            <div class="control-row"><span class="key-badge">слева</span><span>Джойстик; дальше края - бег</span></div>
            <div class="control-row"><span class="key-badge">справа</span><span>Вести - камера, коснуться - удар</span></div>
            <div class="control-row"><span class="key-badge">🛡️</span><span>Короткое нажатие - парирование, удержание - блок</span></div>
            <div class="control-row"><span class="key-badge">⚡ 🔥</span><span>Магия / Сброс перегрева</span></div>
            <div class="control-row"><span class="key-badge">🖐️</span><span>Взаимодействие</span></div>
            <div class="control-row"><span class="key-badge">🩹 📜</span><span>Бинт / Свиток света</span></div>
            <div class="control-row"><span class="key-badge">💨</span><span>Эфирный скачок</span></div>
            <div class="control-row"><span class="key-badge">🎒</span><span>Ранец</span></div>
          </div>

          <div class="stat-card info-card">
            <div class="stat-title">СИЛЬВАНСКИЙ БАЛАНС</div>
            <p class="stat-desc">Огонь греет сталь, но сжигает свитки. Яд травит ножи, но портит бинты. На каждый бафф есть дебафф!</p>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  const heldMoves = new Map<number, { dx: number; dz: number; sprint: boolean }>();
  const updateMovement = (): void => {
    let dx = 0, dz = 0, sprint = false;
    for (const move of heldMoves.values()) { dx += move.dx; dz += move.dz; sprint ||= move.sprint; }
    onMove?.(dx, dz, sprint);
  };
  for (const button of container.querySelectorAll<HTMLButtonElement>('[data-move]')) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault(); event.stopPropagation();
      const [dx, dz] = button.dataset.move!.split(',').map(Number);
      heldMoves.set(event.pointerId, { dx: dx!, dz: dz!, sprint: dx === 0 && dz === 0 });
      button.setPointerCapture(event.pointerId); button.classList.add('active'); updateMovement();
    });
    const release = (event: PointerEvent): void => { heldMoves.delete(event.pointerId); button.classList.remove('active'); updateMovement(); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  }
  const board = container.querySelector('#inv-grid-board') as HTMLElement;
  let isOpen = false;
  let hoveredItem: InventoryItem | null = null;
  let onCloseRequest: (() => void) | null = null;

  // Перетаскивание: плашка движется, предмет и его исходные клетки остаются зарезервированы.
  interface Drag {
    item: InventoryItem;
    el: HTMLElement;
    pointerId: number;
    rotation: InventoryItem['rotation'];
    /** Клетка предмета, за которую взяли: целевая клетка = под указателем минус она. */
    grabX: number;
    grabY: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    target: { x: number; y: number } | null;
  }
  let drag: Drag | null = null;

  /** Размер клетки - из вёрстки (на телефоне клетки меньше), а не зашитые 64 px. */
  function cellSize(): number {
    return board.clientWidth / grid.width || 64;
  }

  function rotateInPlace(item: InventoryItem): void {
    if (grid.items.get(item.id) !== item) return;
    const rotation = ((item.rotation + 90) % 360) as InventoryItem['rotation'];
    placeItem(grid, item, item.gridX ?? 0, item.gridY ?? 0, rotation);
    renderGrid();
  }

  function cellUnder(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = board.getBoundingClientRect();
    const size = cellSize();
    const x = Math.floor((clientX - r.left) / size);
    const y = Math.floor((clientY - r.top) / size);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
    return { x, y };
  }

  function paintItemTiles(itemEl: HTMLElement, item: InventoryItem, rotation: InventoryItem['rotation'], size: number): void {
    itemEl.replaceChildren();
    const rotated = getRotatedCoords(item.shape, rotation);
    const widthInCells = Math.max(...rotated.map((cell) => cell.x)) + 1;
    const heightInCells = Math.max(...rotated.map((cell) => cell.y)) + 1;
    const isRectangular = rotated.length === widthInCells * heightInCells;
    itemEl.style.width = `${widthInCells * size}px`;
    itemEl.style.height = `${heightInCells * size}px`;
    const tiles = isRectangular ? [{ x: 0, y: 0, w: widthInCells, h: heightInCells }] : rotated.map((pt) => ({ x: pt.x, y: pt.y, w: 1, h: 1 }));
    tiles.forEach((t, i) => {
      const tile = document.createElement('div');
      tile.className = `grid-item item-${item.element} item-cat-${item.category}`;
      tile.classList.toggle('item-spoiled', item.isSpoiled === true);
      tile.style.left = `${t.x * size + 3}px`;
      tile.style.top = `${t.y * size + 3}px`;
      tile.style.width = `${t.w * size - 6}px`;
      tile.style.height = `${t.h * size - 6}px`;
      if (i === 0) {
        const name = document.createElement('div'); name.className = 'item-name'; name.textContent = item.name;
        const weight = document.createElement('div'); weight.className = 'item-info'; weight.textContent = `${item.weight} кг`;
        tile.append(name, weight);
      }
      itemEl.appendChild(tile);
    });

  }
  function markTarget(target: { x: number; y: number } | null, valid: boolean): void {
    for (const c of Array.from(board.querySelectorAll('.grid-cell'))) {
      c.classList.remove('drop-valid', 'drop-invalid');
    }
    if (!target || !drag) return;
    const rotated = getRotatedCoords(drag.item.shape, drag.rotation);
    for (const pt of rotated) {
      const cell = board.querySelector(`.grid-cell[data-x="${target.x + pt.x}"][data-y="${target.y + pt.y}"]`);
      cell?.classList.add(valid ? 'drop-valid' : 'drop-invalid');
    }
  }

  function updateDrag(clientX: number, clientY: number): void {
    if (!drag) return;
    drag.lastX = clientX; drag.lastY = clientY;
    const size = cellSize();
    drag.el.style.left = `${clientX - board.getBoundingClientRect().left - (drag.grabX + 0.5) * size}px`;
    drag.el.style.top = `${clientY - board.getBoundingClientRect().top - (drag.grabY + 0.5) * size}px`;
    const under = cellUnder(clientX, clientY);
    drag.target = under ? { x: under.x - drag.grabX, y: under.y - drag.grabY } : null;
    markTarget(drag.target, drag.target ? canPlaceItem(grid, drag.item, drag.target.x, drag.target.y, drag.rotation) : false);
  }

  function endDrag(clientX: number, clientY: number, cancelled: boolean): void {
    if (!drag) return;
    // Последняя позиция указателя важна: pointerup может прийти без последнего move.
    updateDrag(clientX, clientY);
    const d = drag;
    drag = null;
    if (!d.moved) {
      if (!cancelled && d.el.dataset.pointerType === 'touch') rotateInPlace(d.item);
      return;
    }
    const target = d.target;
    if (!cancelled && target && grid.items.get(d.item.id) === d.item) {
      placeItem(grid, d.item, target.x, target.y, d.rotation);
    }
    // При отказе нечего возвращать: оригинал никуда не исчезал и не менял поворот.
    renderGrid();
  }

  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.moved = true;
      drag.el.classList.add('dragging');
    }
    updateDrag(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag(e.clientX, e.clientY, false);
  });
  window.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag(e.clientX, e.clientY, true);
  });

  function refreshHazards(): void {
    if (!isOpen) return;
    const fateCard=container.querySelector<HTMLElement>('#inv-fate-card')!;fateCard.hidden=!fate;
    if(fate) {
      const state=fate.state(),reserves=fateReserves(grid);
      container.querySelector('#inv-fate-count')!.textContent=`Активно: ${state.active}/${state.max} · Готово в ранце: ${reserves.length}`;
      container.querySelector<HTMLButtonElement>('#inv-fate-weave')!.disabled=state.active>=state.max||!reserves.length;
      container.querySelector<HTMLButtonElement>('#inv-fate-scout')!.disabled=state.active<=0||!state.scoutable;
    }
    const warnings = inventoryWarnings(grid);
    const summary = container.querySelector('#inv-hazards')!;
    summary.textContent = warnings.length ? warnings.map(warning=>`${warning.kind==='fire'?'Горит':'Яд'}: ${warning.name} · ${warning.remaining.toFixed(1)} с`).join(' · ') : 'Переставляйте опасные предметы: огонь сжигает свитки, яд портит бинты. Святые источники безопасны.';
    for (const item of grid.items.values()) {
      const element = board.querySelector<HTMLElement>(`[data-item-id="${item.id}"]`);
      if (!element) continue;
      let badge=element.querySelector<HTMLElement>('.item-hazard');
      const exposure = (item.burnTime??0)>0 ? `ЖАР ${Math.round(item.burnTime!/PAPER_BURN_SECONDS*100)}%` : (item.poisonTime??0)>0&&!item.isSpoiled ? `ЯД ${Math.round(item.poisonTime!/POTION_POISON_SECONDS*100)}%` : item.isSpoiled ? 'ИСПОРЧЕНО' : item.durability===0 ? 'СЛОМАНО' : '';
      if (!badge && exposure) { badge=document.createElement('span'); badge.className='item-hazard'; element.append(badge); }
      if(badge) { badge.textContent=exposure; badge.hidden=!exposure; }
    }
  }
  function renderGrid() {
    // Награда/расход/перерисовка отменяют только визуальный жест, сохраняя данные.
    drag = null;
    hoveredItem = null;
    board.innerHTML = '';
    const belt = container.querySelector('#inv-belt')!;
    belt.replaceChildren();
    for (let index = 0; index < 4; index++) {
      const chosen = beltItem(grid, index);
      const label = document.createElement('label');
      label.className = 'belt-field';
      label.textContent = `${index + 1}. ${['Оружие', 'Щит', 'Лечение', 'Свиток'][index]}`;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Предмет пояса ${index + 1}`);
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Нет предмета'; select.appendChild(empty);
      for (const item of grid.items.values()) {
        if (!fitsBelt(item, index)) continue;
        const option = document.createElement('option'); option.value = item.id; option.textContent = item.name;
        select.appendChild(option);
      }
      select.value = chosen?.id ?? '';
      select.addEventListener('change', () => { grid.quickSlots[index] = select.value || null; });
      label.appendChild(select); belt.appendChild(label);
    }
    const size = cellSize();

    const crafting = container.querySelector('#inv-crafting')!;
    crafting.replaceChildren();
    const scrolls = Array.from(grid.items.values()).filter((item) => item.category === 'scroll');
    const choices: HTMLSelectElement[] = [];
    for (let i = 0; i < 2; i++) {
      const field = document.createElement('label'); field.className = 'belt-field'; field.textContent = `Свиток ${i + 1}`;
      const select = document.createElement('select'); select.setAttribute('aria-label', `Свиток для слияния ${i + 1}`);
      for (const item of scrolls) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; select.appendChild(option); }
      if (scrolls[i]) select.value = scrolls[i]!.id;
      choices.push(select); field.appendChild(select); crafting.appendChild(field);
    }
    const fuse = document.createElement('button'); fuse.type = 'button'; fuse.className = 'action-btn btn-secondary'; fuse.textContent = 'Объединить'; fuse.disabled = scrolls.length < 2;
    crafting.appendChild(fuse);
    const feedback = document.createElement('p'); feedback.className = 'craft-feedback';
    feedback.textContent = 'Огонь + яд / эфир + лёд. Нужно место в ранце.'; crafting.appendChild(feedback);
    fuse.addEventListener('click', () => {
      const item = fuseScrolls(grid, choices[0]!.value, choices[1]!.value);
      if (!item) { feedback.textContent = 'Нет подходящего рецепта или места. Предметы сохранены.'; return; }
      renderGrid();
      const note = container.querySelector('.craft-feedback'); if (note) note.textContent = `Создан: ${item.name}`;
    });

    const coolingCard=container.querySelector<HTMLElement>('#inv-cooling-card')!;coolingCard.hidden=!onCool;
    const cooling=container.querySelector('#inv-cooling')!;cooling.replaceChildren();
    if(onCool) {
      const label=document.createElement('label');label.className='belt-field';label.textContent='Жар в предмет';
      const select=document.createElement('select');select.setAttribute('aria-label','Предмет для отвода тепла');
      for(const item of grid.items.values()) {
        if(!canAbsorbHeat(item)) continue;
        const option=document.createElement('option');option.value=item.id;option.textContent=item.category==='weapon'?`${item.name} · -2 урона / до 25% жара`:`${item.name} · ${item.durability} прочности / до 40% жара`;select.append(option);
      }
      const button=document.createElement('button');button.type='button';button.className='action-btn btn-secondary';button.textContent='Отвести в предмет';button.disabled=!select.options.length;
      button.addEventListener('click',()=>onCool('item',select.value));label.append(select);
      const water=document.createElement('button');water.type='button';water.className='action-btn btn-secondary';water.textContent='В воду · -35% жара / 4 урона ядом';water.addEventListener('click',()=>onCool('water'));
      const hint=document.createElement('p');hint.className='craft-feedback';hint.textContent='Кристалл теряет 1 прочность за 5% жара, оружие тупится. V - аварийный сброс с серой травмой.';
      cooling.append(label,button,water,hint);
    }
    const dropCard = container.querySelector<HTMLElement>('#inv-drop-card')!;
    dropCard.hidden = !onDrop;
    const dropArea = container.querySelector('#inv-drop')!; dropArea.replaceChildren();
    if (onDrop) {
      const label = document.createElement('label'); label.className = 'belt-field'; label.textContent = 'Оставить рядом с героем';
      const select = document.createElement('select'); select.setAttribute('aria-label','Предмет для выкладывания');
      for (const item of grid.items.values()) {
        const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.name} · ${item.weight} кг`; select.append(option);
      }
      label.append(select);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'action-btn btn-secondary'; button.textContent = 'Выложить на землю'; button.disabled = grid.items.size === 0;
      button.addEventListener('click', () => { if (grid.items.has(select.value)) onDrop(select.value); });
      const hint = document.createElement('p'); hint.className = 'craft-feedback'; hint.textContent = 'Трофей можно подобрать клавишей E. Время продолжает идти.';
      dropArea.append(label,button,hint);
    }
    const journal = container.querySelector('#inv-codex')!;
    journal.replaceChildren();
    const entries = getCodex?.() ?? [];
    if (!entries.length) journal.textContent = 'Знания остаются с вами после гибели. Исследуйте святилища и особые встречи.';
    for (const key of entries) {
      const record = document.createElement('p'); record.className = 'codex-record';
      const title = document.createElement('strong'); title.textContent = CODEX[key].title;
      const description = document.createElement('span'); description.textContent = CODEX[key].description;
      record.append(title, description); journal.appendChild(record);
    }
    const stats = calculateInventoryStats(grid);

    // Обновляем статистику
    const weightVal = container.querySelector('#inv-weight-val')!;
    const weightClass = container.querySelector('#inv-weight-class')!;
    const armorVal = container.querySelector('#inv-armor-val')!;
    const fireVal = container.querySelector('#inv-fire-val')!;
    const poisonVal = container.querySelector('#inv-poison-val')!;
    const critVal = container.querySelector('#inv-crit-val')!;

    weightVal.textContent = `${stats.totalWeight.toFixed(1)} кг`;
    armorVal.textContent = String(stats.totalArmor);
    fireVal.textContent = `+${stats.bonusFireDamage}`;
    poisonVal.textContent = `+${stats.bonusPoisonDamage}`;
    container.querySelector('#inv-scroll-val')!.textContent = `×${stats.scrollMultiplier.toFixed(2)}`;
    critVal.textContent = `+${Math.round(stats.bonusCritRate * 100)}%`;
    critVal.setAttribute('title', stats.healingMultiplier < 1 ? 'Лёд рядом с бинтами: лечение уменьшено вдвое. Переставьте предметы.' : 'Лёд рядом с оружием усиливает критические удары.');

    weightClass.className = `weight-badge ${stats.weightClass}`;
    if (stats.weightClass === 'light') {
      weightClass.textContent = 'ЛЕГКИЙ ШАГ (БЕСШУМНОСТЬ)';
    } else if (stats.weightClass === 'medium') {
      weightClass.textContent = 'СРЕДНИЙ ВЕС (БАЛАНС)';
    } else {
      weightClass.textContent = 'ТЯЖЕЛЫЙ ВЕС (ШУМ И БРОНЯ)';
    }

    // Ячейки
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        if (grid.slots[y * grid.width + x]?.isMudded) cell.classList.add('mudded');
        board.appendChild(cell);
      }
    }

    // Предметы поверх сетки. Плашка - строго по своим клеткам, а надпись обрезается по
    // плашке: длинное название ("Свиток Чумного Пламени") раньше вылезало на соседний
    // предмет и выглядело как наложение (приёмка, пункт 12).
    for (const item of grid.items.values()) {
      if (item.gridX === undefined || item.gridY === undefined) continue;

      const rotated = getRotatedCoords(item.shape, item.rotation);
      const widthInCells = Math.max(...rotated.map((c) => c.x)) + 1;
      const heightInCells = Math.max(...rotated.map((c) => c.y)) + 1;
      const isRectangular = rotated.length === widthInCells * heightInCells;

      const itemEl = document.createElement('div');
      itemEl.id = `inv-item-${item.id}`;
      itemEl.dataset.itemId = item.id;
      itemEl.className = 'grid-item-composite';
      itemEl.style.left = `${item.gridX * size}px`;
      itemEl.style.top = `${item.gridY * size}px`;
      itemEl.style.width = `${widthInCells * size}px`;
      itemEl.style.height = `${heightInCells * size}px`;
      itemEl.title = `${item.name} [${item.rarity.toUpperCase()}]\nКатегория: ${item.category}\nСтихия: ${item.element}\nВес: ${item.weight} кг${item.damage ? `\nУрон: ${item.damage}` : ''}${item.defense ? `\nЗащита: ${item.defense}` : ''}${item.healAmount ? `\nИсцеление: ${item.healAmount} HP` : ''}${item.rarity === 'holy' ? '\nСвятой источник не портит соседние припасы.' : ''}${item.category === 'shield' ? `\nПарирование: ${{reflect:'отражение урона',siphon:'перехват эссенции',both:'отражение и перехват'}[item.parryType??'both']}` : ''}${item.fatigueRestore ? `\nСнять усталость: ${item.fatigueRestore}% за 3 с` : ''}${item.utility ? `\nНазначение: ${{breathing:'дыхание под водой',grapple:'переход через разлом',cipher:'рунический шифр',light:'свет во тьме'}[item.utility]}` : ''}${item.durability !== undefined ? `\nПрочность: ${item.durability}/${item.maxDurability ?? item.durability}${item.durability === 0 ? ' (сломано)' : ''}` : ''}${item.relicEffect === 'thread' ? '\nВплетите Нить через панель ранца, когда активный запас меньше трёх.' : ''}${item.relicEffect === 'chain' ? `\n${item.isSevered ? 'Цепь разорвана навсегда: бонус утрачен.' : 'Якорь: +6 брони. Перемещение, поворот или выкладывание рвёт цепь навсегда.'}` : ''}${item.category === 'relic' && item.relicEffect !== 'chain' && item.relicEffect !== 'thread' && item.element === 'aether' ? '\nРядом со свитками: +25% урона. Удар: -4 прочности.' : ''}${item.rarity === 'infernal' ? '\nЦена удара: 4 HP и повышенная усталость' : ''}\n\n[ПКМ / R] - повернуть\n[ЛКМ] - перетащить`;

      paintItemTiles(itemEl, item, item.rotation, size);
      if (item.relicEffect === 'chain') {
        const status=document.createElement('span'); status.className='chain-state'; status.textContent=item.isSevered?'ЦЕПЬ РАЗОРВАНА':'+6 БРОНИ · ЯКОРЬ'; itemEl.append(status);
      }

      itemEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || drag) return;
        e.preventDefault();
        const r = itemEl.getBoundingClientRect();
        itemEl.dataset.pointerType = e.pointerType;
        drag = {
          item,
          el: itemEl,
          pointerId: e.pointerId,
          rotation: item.rotation,
          grabX: Math.min(widthInCells - 1, Math.max(0, Math.floor((e.clientX - r.left) / size))),
          grabY: Math.min(heightInCells - 1, Math.max(0, Math.floor((e.clientY - r.top) / size))),
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          target: null,
        };
      });

      itemEl.addEventListener('mouseenter', () => {
        hoveredItem = item;
      });
      itemEl.addEventListener('mouseleave', () => {
        if (hoveredItem === item) hoveredItem = null;
      });

      // Поворот правой кнопкой мыши
      itemEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!drag) rotateInPlace(item);
      });

      board.appendChild(itemEl);
    }
    refreshHazards();
  }

  // R (и "К" в русской раскладке): поворот предмета под курсором или того, что тащим
  window.addEventListener('keydown', (e) => {
    if (!isOpen || e.code !== 'KeyR' || e.repeat) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
    e.preventDefault();
    if (drag?.moved) {
      drag.rotation = ((drag.rotation + 90) % 360) as InventoryItem['rotation'];
      drag.grabX = 0;
      drag.grabY = 0;
      paintItemTiles(drag.el, drag.item, drag.rotation, cellSize());
      updateDrag(drag.lastX, drag.lastY);
    } else if (hoveredItem) {
      rotateInPlace(hoveredItem);
    }
  });

  let pendingResize = false;
  window.addEventListener('resize', () => {
    if (!isOpen || pendingResize) return;
    pendingResize = true;
    requestAnimationFrame(() => { pendingResize = false; if (isOpen) renderGrid(); });
  });

  container.querySelector('#inv-fate-scout')!.addEventListener('click',()=>fate?.scout());
  container.querySelector('#inv-fate-weave')!.addEventListener('click',()=>fate?.weave());
  container.querySelector('#inv-close')!.addEventListener('click', () => onCloseRequest?.());

  function cancelDrag(): void {
    heldMoves.clear(); updateMovement();
    for (const button of container.querySelectorAll('[data-move]')) button.classList.remove('active');
    if (drag) endDrag(drag.startX, drag.startY, true);
  }

  return {
    container,
    get isOpen() {
      return isOpen;
    },
    open: () => {
      isOpen = true;
      container.classList.remove('hidden');
      renderGrid();
    },
    close: () => {
      cancelDrag();
      isOpen = false;
      container.classList.add('hidden');
    },
    toggle: () => {
      if (isOpen) {
        cancelDrag();
        isOpen = false;
        container.classList.add('hidden');
      } else {
        isOpen = true;
        container.classList.remove('hidden');
        renderGrid();
      }
    },
    render: renderGrid,
    refreshHazards,
    onClose: (fn: () => void) => {
      onCloseRequest = fn;
    },
  };
}
