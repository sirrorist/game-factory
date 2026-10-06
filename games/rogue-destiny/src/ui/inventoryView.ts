/**
 * Модуль отображения и взаимодействия с рюкзаком (Tarkov-инвентарь).
 * Перетаскивание - pointer-событиями, а не HTML5 drag-and-drop: тот на телефоне не работает.
 * Поворот - R, ПКМ или касание предмета без сдвига.
 */
import type { InventoryGrid, InventoryItem } from '../core/types.ts';
import {
  calculateInventoryStats,
  canPlaceItem,
  placeItem,
  removeItem,
  restoreItem,
  getRotatedCoords,
} from '../core/inventory.ts';

export interface InventoryView {
  container: HTMLDivElement;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  render: () => void;
  /** Кнопка ✕ в ранце (на телефоне нет TAB): main.ts закрывает ранец своим путём. */
  onClose: (fn: () => void) => void;
}

export function createInventoryView(grid: InventoryGrid): InventoryView {
  const container = document.createElement('div');
  container.id = 'inventory-modal';
  container.className = 'inventory-modal hidden';
  container.innerHTML = `
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
          <div class="stat-card">
            <div class="stat-title">ВЕС И НАГРУЗКА</div>
            <div id="inv-weight-val" class="stat-big">0.0 кг</div>
            <div id="inv-weight-class" class="weight-badge light">ЛЕГКИЙ ШАГ (БЕСШУМНОСТЬ)</div>
          </div>

          <div class="stat-card">
            <div class="stat-title">РЕЗОНАНС И БРОНЯ</div>
            <div class="res-row"><span>Броня:</span> <strong id="inv-armor-val">0</strong></div>
            <div class="res-row"><span>Огонь к атакам:</span> <strong id="inv-fire-val">+0</strong></div>
            <div class="res-row"><span>Яд на лезвиях:</span> <strong id="inv-poison-val">+0</strong></div>
            <div class="res-row"><span>Крит. шанс:</span> <strong id="inv-crit-val">+0%</strong></div>
          </div>

          <!-- Памятка управления: на ПК - клавиши, на телефоне - жесты (body.touch-enabled) -->
          <div class="stat-card controls-card controls-desktop">
            <div class="stat-title">УПРАВЛЕНИЕ МАГОМ</div>
            <div class="control-row"><span class="key-badge">WASD</span><span>Перемещение</span></div>
            <div class="control-row"><span class="key-badge">Shift</span><span>Рывок / Спринт</span></div>
            <div class="control-row"><span class="key-badge">Мышь</span><span>Обзор камеры</span></div>
            <div class="control-row"><span class="key-badge">ЛКМ / [1]</span><span>Удар посохом (охлаждение)</span></div>
            <div class="control-row"><span class="key-badge">ПКМ</span><span>Парирование, пока держите</span></div>
            <div class="control-row"><span class="key-badge">[2]</span><span>Стойка парирования вкл / выкл</span></div>
            <div class="control-row"><span class="key-badge">[3] / [4]</span><span>Бинт / Свиток света</span></div>
            <div class="control-row"><span class="key-badge">[Q]</span><span>Боевая магия</span></div>
            <div class="control-row"><span class="key-badge">[V]</span><span>Сброс перегрева</span></div>
            <div class="control-row"><span class="key-badge">[E]</span><span>Взаимодействие</span></div>
            <div class="control-row"><span class="key-badge">[R]</span><span>Поворот предмета</span></div>
            <div class="control-row"><span class="key-badge">TAB / I</span><span>Ранец</span></div>
          </div>
          <div class="stat-card controls-card controls-touch">
            <div class="stat-title">УПРАВЛЕНИЕ НА ТЕЛЕФОНЕ</div>
            <div class="control-row"><span class="key-badge">слева</span><span>Джойстик; дальше края - бег</span></div>
            <div class="control-row"><span class="key-badge">справа</span><span>Вести - камера, коснуться - удар</span></div>
            <div class="control-row"><span class="key-badge">🛡️</span><span>Парирование, пока держите</span></div>
            <div class="control-row"><span class="key-badge">⚡ 🔥</span><span>Магия / Сброс перегрева</span></div>
            <div class="control-row"><span class="key-badge">🖐️</span><span>Взаимодействие</span></div>
            <div class="control-row"><span class="key-badge">🩹 📜</span><span>Бинт / Свиток света</span></div>
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

  const board = container.querySelector('#inv-grid-board') as HTMLElement;
  let isOpen = false;
  let hoveredItem: InventoryItem | null = null;
  let onCloseRequest: (() => void) | null = null;

  // Перетаскивание: предмет снят с сетки, плашка едет за указателем.
  interface Drag {
    item: InventoryItem;
    el: HTMLElement;
    pointerId: number;
    originX: number;
    originY: number;
    originRotation: InventoryItem['rotation'];
    /** Клетка предмета, за которую взяли: целевая клетка = под указателем минус она. */
    grabX: number;
    grabY: number;
    startX: number;
    startY: number;
    moved: boolean;
    target: { x: number; y: number } | null;
  }
  let drag: Drag | null = null;

  /** Размер клетки - из вёрстки (на телефоне клетки меньше), а не зашитые 64 px. */
  function cellSize(): number {
    return board.clientWidth / grid.width || 64;
  }

  function rotateInPlace(item: InventoryItem): void {
    const originX = item.gridX ?? 0;
    const originY = item.gridY ?? 0;
    const oldRot = item.rotation;
    removeItem(grid, item.id);
    item.rotation = ((item.rotation + 90) % 360) as InventoryItem['rotation'];
    if (!placeItem(grid, item, originX, originY)) restoreItem(grid, item, originX, originY, oldRot);
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

  function markTarget(target: { x: number; y: number } | null, valid: boolean): void {
    for (const c of Array.from(board.querySelectorAll('.grid-cell'))) {
      c.classList.remove('drop-valid', 'drop-invalid');
    }
    if (!target || !drag) return;
    const rotated = getRotatedCoords(drag.item.shape, drag.item.rotation);
    for (const pt of rotated) {
      const cell = board.querySelector(`.grid-cell[data-x="${target.x + pt.x}"][data-y="${target.y + pt.y}"]`);
      cell?.classList.add(valid ? 'drop-valid' : 'drop-invalid');
    }
  }

  function updateDrag(clientX: number, clientY: number): void {
    if (!drag) return;
    const size = cellSize();
    drag.el.style.left = `${clientX - board.getBoundingClientRect().left - (drag.grabX + 0.5) * size}px`;
    drag.el.style.top = `${clientY - board.getBoundingClientRect().top - (drag.grabY + 0.5) * size}px`;
    const under = cellUnder(clientX, clientY);
    drag.target = under ? { x: under.x - drag.grabX, y: under.y - drag.grabY } : null;
    markTarget(drag.target, drag.target ? canPlaceItem(grid, drag.item, drag.target.x, drag.target.y) : false);
  }

  function endDrag(clientX: number, clientY: number, cancelled: boolean): void {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      // Касание без сдвига: на телефоне - поворот (R и ПКМ там нет)
      if (!cancelled && d.el.dataset.pointerType === 'touch') rotateInPlace(d.item);
      return;
    }
    updateDrag(clientX, clientY);
    const t = d.target;
    if (cancelled || !t || !placeItem(grid, d.item, t.x, t.y)) {
      restoreItem(grid, d.item, d.originX, d.originY, d.originRotation);
    }
    renderGrid();
  }

  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.moved = true;
      removeItem(grid, drag.item.id);
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

  function renderGrid() {
    board.innerHTML = '';
    const size = cellSize();

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
    critVal.textContent = `+${Math.round(stats.bonusCritRate * 100)}%`;

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
      itemEl.title = `${item.name} [${item.rarity.toUpperCase()}]\nКатегория: ${item.category}\nСтихия: ${item.element}\nВес: ${item.weight} кг${item.damage ? `\nУрон: ${item.damage}` : ''}${item.defense ? `\nЗащита: ${item.defense}` : ''}${item.healAmount ? `\nИсцеление: ${item.healAmount} HP` : ''}\n\n[ПКМ / R] - повернуть\n[ЛКМ] - перетащить`;

      const tiles = isRectangular ? [{ x: 0, y: 0, w: widthInCells, h: heightInCells }] : rotated.map((pt) => ({ x: pt.x, y: pt.y, w: 1, h: 1 }));
      tiles.forEach((t, i) => {
        const tile = document.createElement('div');
        tile.className = `grid-item item-${item.element} item-cat-${item.category}`;
        tile.style.left = `${t.x * size + 3}px`;
        tile.style.top = `${t.y * size + 3}px`;
        tile.style.width = `${t.w * size - 6}px`;
        tile.style.height = `${t.h * size - 6}px`;
        if (i === 0) {
          tile.innerHTML = `
            <div class="item-name">${item.name}</div>
            <div class="item-info">${item.weight} кг</div>
          `;
        }
        itemEl.appendChild(tile);
      });

      itemEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || drag) return;
        e.preventDefault();
        const r = itemEl.getBoundingClientRect();
        itemEl.dataset.pointerType = e.pointerType;
        drag = {
          item,
          el: itemEl,
          pointerId: e.pointerId,
          originX: item.gridX ?? 0,
          originY: item.gridY ?? 0,
          originRotation: item.rotation,
          grabX: Math.min(widthInCells - 1, Math.max(0, Math.floor((e.clientX - r.left) / size))),
          grabY: Math.min(heightInCells - 1, Math.max(0, Math.floor((e.clientY - r.top) / size))),
          startX: e.clientX,
          startY: e.clientY,
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
  }

  // R (и "К" в русской раскладке): поворот предмета под курсором или того, что тащим
  window.addEventListener('keydown', (e) => {
    if (!isOpen || e.code !== 'KeyR' || e.repeat) return;
    if (drag?.moved) {
      drag.item.rotation = ((drag.item.rotation + 90) % 360) as InventoryItem['rotation'];
      drag.grabX = 0;
      drag.grabY = 0;
      const rotated = getRotatedCoords(drag.item.shape, drag.item.rotation);
      const size = cellSize();
      drag.el.style.width = `${(Math.max(...rotated.map((c) => c.x)) + 1) * size}px`;
      drag.el.style.height = `${(Math.max(...rotated.map((c) => c.y)) + 1) * size}px`;
      markTarget(drag.target, drag.target ? canPlaceItem(grid, drag.item, drag.target.x, drag.target.y) : false);
    } else if (hoveredItem) {
      rotateInPlace(hoveredItem);
    }
  });

  container.querySelector('#inv-close')!.addEventListener('click', () => onCloseRequest?.());

  function cancelDrag(): void {
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
    onClose: (fn: () => void) => {
      onCloseRequest = fn;
    },
  };
}
