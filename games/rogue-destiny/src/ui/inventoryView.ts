/**
 * Модуль отображения и взаимодействия с рюкзаком (Tarkov-инвентарь).
 * Поддерживает drag-and-drop, поворот клавишей R, подсчет веса и резонанса.
 */
import type { InventoryGrid, InventoryItem } from '../core/types.ts';
import {
  calculateInventoryStats,
  canPlaceItem,
  placeItem,
  removeItem,
  getRotatedCoords,
} from '../core/inventory.ts';

export interface InventoryView {
  container: HTMLDivElement;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  render: () => void;
}

export function createInventoryView(grid: InventoryGrid): InventoryView {
  const container = document.createElement('div');
  container.id = 'inventory-modal';
  container.className = 'inventory-modal hidden';
  container.innerHTML = `
    <div class="inventory-window">
      <div class="inv-header">
        <div class="inv-title">🎒 ПОХОДНЫЙ РАНЕЦ МАГА (ТАРКОВ-СЕТКА)</div>
        <div class="inv-hint">TAB — закрыть | R — повернуть предмет | Перетаскивание — ЛКМ</div>
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

          <!-- Памятка управления в игре -->
          <div class="stat-card controls-card">
            <div class="stat-title">УПРАВЛЕНИЕ МАГОМ</div>
            <div class="control-row"><span class="key-badge">WASD</span><span>Перемещение</span></div>
            <div class="control-row"><span class="key-badge">Shift</span><span>Рывок / Спринт</span></div>
            <div class="control-row"><span class="key-badge">Мышь</span><span>Обзор камеры (OTS)</span></div>
            <div class="control-row"><span class="key-badge">ЛКМ / [1]</span><span>Удар посохом (Охлаждение)</span></div>
            <div class="control-row"><span class="key-badge">ПКМ / [2]</span><span>Парирование щитом</span></div>
            <div class="control-row"><span class="key-badge">[3] / [4]</span><span>Бинт / Свиток света</span></div>
            <div class="control-row"><span class="key-badge">[Q]</span><span>Боевая магия</span></div>
            <div class="control-row"><span class="key-badge">[V]</span><span>Сброс перегрева</span></div>
            <div class="control-row"><span class="key-badge">[E]</span><span>Взаимодействие</span></div>
            <div class="control-row"><span class="key-badge">[R]</span><span>Поворот предмета</span></div>
            <div class="control-row"><span class="key-badge">TAB</span><span>Закрыть ранец</span></div>
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

  let isOpen = false;
  let draggedItem: InventoryItem | null = null;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let isDroppedSuccessfully = false;

  function renderGrid() {
    const board = container.querySelector('#inv-grid-board') as HTMLElement;
    board.innerHTML = '';

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

    // Создаем ячейки
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);

        const slot = grid.slots[y * grid.width + x];
        if (slot?.isMudded) {
          cell.classList.add('mudded');
        }

        cell.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (!draggedItem) return;
          const canDrop = canPlaceItem(grid, draggedItem, x, y);
          cell.classList.toggle('drop-valid', canDrop);
          cell.classList.toggle('drop-invalid', !canDrop);
        });

        cell.addEventListener('dragleave', () => {
          cell.classList.remove('drop-valid', 'drop-invalid');
        });

        cell.addEventListener('drop', (e) => {
          e.preventDefault();
          cell.classList.remove('drop-valid', 'drop-invalid');
          if (!draggedItem) return;

          if (canPlaceItem(grid, draggedItem, x, y)) {
            placeItem(grid, draggedItem, x, y);
            isDroppedSuccessfully = true;
            draggedItem = null;
            renderGrid();
          }
        });

        board.appendChild(cell);
      }
    }

    // Отрисовываем предметы поверх сетки
    for (const item of grid.items.values()) {
      if (item.gridX === undefined || item.gridY === undefined) continue;

      const rotated = getRotatedCoords(item.shape, item.rotation);
      const maxX = Math.max(...rotated.map((c) => c.x));
      const maxY = Math.max(...rotated.map((c) => c.y));
      const widthInCells = maxX + 1;
      const heightInCells = maxY + 1;

      const isRectangular = rotated.length === widthInCells * heightInCells;

      const itemEl = document.createElement('div');
      itemEl.id = `inv-item-${item.id}`;
      itemEl.dataset.itemId = item.id;
      itemEl.draggable = true;

      itemEl.title = `${item.name} [${item.rarity.toUpperCase()}]\nКатегория: ${item.category}\nСтихия: ${item.element}\nВес: ${item.weight} кг${item.damage ? `\nУрон: ${item.damage}` : ''}${item.defense ? `\nЗащита: ${item.defense}` : ''}${item.healAmount ? `\nИсцеление: ${item.healAmount} HP` : ''}\n\n[ПКМ / R] — повернуть\n[ЛКМ] — перетащить`;

      if (isRectangular) {
        itemEl.className = `grid-item item-${item.element} item-cat-${item.category}`;
        itemEl.style.left = `${item.gridX * 64 + 4}px`;
        itemEl.style.top = `${item.gridY * 64 + 4}px`;
        itemEl.style.width = `${widthInCells * 64 - 8}px`;
        itemEl.style.height = `${heightInCells * 64 - 8}px`;
        itemEl.innerHTML = `
          <div class="item-name">${item.name}</div>
          <div class="item-info">${item.weight} кг</div>
        `;
      } else {
        // Для непрямоугольных предметов отрисовываем строго принадлежащие предмету ячейки
        itemEl.className = 'grid-item-composite';
        itemEl.style.position = 'absolute';
        itemEl.style.left = `${item.gridX * 64}px`;
        itemEl.style.top = `${item.gridY * 64}px`;
        itemEl.style.width = `${widthInCells * 64}px`;
        itemEl.style.height = `${heightInCells * 64}px`;
        itemEl.style.zIndex = '5';
        itemEl.style.cursor = 'grab';

        for (const pt of rotated) {
          const tile = document.createElement('div');
          tile.className = `grid-item item-${item.element} item-cat-${item.category}`;
          tile.style.position = 'absolute';
          tile.style.left = `${pt.x * 64 + 4}px`;
          tile.style.top = `${pt.y * 64 + 4}px`;
          tile.style.width = `56px`;
          tile.style.height = `56px`;
          tile.style.margin = '0';
          if (pt.x === 0 && pt.y === 0) {
            tile.innerHTML = `
              <div class="item-name">${item.name}</div>
              <div class="item-info">${item.weight} кг</div>
            `;
          }
          itemEl.appendChild(tile);
        }
      }

      itemEl.addEventListener('dragstart', () => {
        draggedItem = item;
        dragOriginX = item.gridX ?? 0;
        dragOriginY = item.gridY ?? 0;
        isDroppedSuccessfully = false;
        removeItem(grid, item.id);
      });

      itemEl.addEventListener('dragend', () => {
        if (draggedItem && !isDroppedSuccessfully) {
          placeItem(grid, draggedItem, dragOriginX, dragOriginY);
          draggedItem = null;
          renderGrid();
        }
      });

      itemEl.addEventListener('mouseenter', () => {
        hoveredItem = item;
      });

      itemEl.addEventListener('mouseleave', () => {
        if (hoveredItem === item) hoveredItem = null;
      });

      // Поворот по нажатию правой кнопкой мыши
      itemEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const originX = item.gridX ?? 0;
        const originY = item.gridY ?? 0;
        const nextRot = ((item.rotation + 90) % 360) as 0 | 90 | 180 | 270;
        const oldRot = item.rotation;

        removeItem(grid, item.id);
        item.rotation = nextRot;

        if (canPlaceItem(grid, item, originX, originY)) {
          placeItem(grid, item, originX, originY);
        } else {
          item.rotation = oldRot;
          placeItem(grid, item, originX, originY);
        }
        renderGrid();
      });

      board.appendChild(itemEl);
    }
  }

  let hoveredItem: InventoryItem | null = null;

  // Обработка клавиши R при перетаскивании или наведении курсора
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
      if (draggedItem) {
        draggedItem.rotation = ((draggedItem.rotation + 90) % 360) as 0 | 90 | 180 | 270;
      } else if (hoveredItem && isOpen) {
        const item = hoveredItem;
        const originX = item.gridX ?? 0;
        const originY = item.gridY ?? 0;
        const nextRot = ((item.rotation + 90) % 360) as 0 | 90 | 180 | 270;
        const oldRot = item.rotation;

        removeItem(grid, item.id);
        item.rotation = nextRot;

        if (canPlaceItem(grid, item, originX, originY)) {
          placeItem(grid, item, originX, originY);
        } else {
          item.rotation = oldRot;
          placeItem(grid, item, originX, originY);
        }
        renderGrid();
      }
    }
  });

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
      isOpen = false;
      container.classList.add('hidden');
    },
    toggle: () => {
      if (isOpen) {
        isOpen = false;
        container.classList.add('hidden');
      } else {
        isOpen = true;
        container.classList.remove('hidden');
        renderGrid();
      }
    },
    render: renderGrid,
  };
}
