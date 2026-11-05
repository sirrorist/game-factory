/**
 * Модуль управления инвентарем и расчета резонанса предметов.
 * Чистая логика, независимая от DOM и рендера.
 */
import type {
  GridCoord,
  InventoryGrid,
  InventoryItem,
  InventorySlot,
  InventoryStats,
  WeightClass,
} from './types.ts';

export function createInventory(width = 5, height = 4): InventoryGrid {
  const slots: InventorySlot[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      slots.push({ x, y, itemId: null, isMudded: false });
    }
  }

  return {
    revision: 0,
    width,
    height,
    slots,
    items: new Map<string, InventoryItem>(),
    quickSlots: [null, null, null, null],
  };
}

const ROTATIONS: InventoryItem['rotation'][] = [0, 90, 180, 270];

export function getRotatedCoords(
  shape: readonly GridCoord[],
  rotation: 0 | 90 | 180 | 270,
): GridCoord[] {
  if (rotation === 0) {
    return shape.map((c) => ({ x: c.x, y: c.y }));
  }

  const transformed = shape.map((c) => {
    switch (rotation) {
      case 90:
        return { x: -c.y, y: c.x };
      case 180:
        return { x: -c.x, y: -c.y };
      case 270:
        return { x: c.y, y: -c.x };
      default:
        return { x: c.x, y: c.y };
    }
  });

  const minX = Math.min(...transformed.map((c) => c.x));
  const minY = Math.min(...transformed.map((c) => c.y));

  return transformed.map((c) => ({
    x: c.x - minX,
    y: c.y - minY,
  }));
}

export function getItemOccupiedCells(item: InventoryItem, originX: number, originY: number, rotation = item.rotation): GridCoord[] {
  const rotated = getRotatedCoords(item.shape, rotation);
  return rotated.map((c) => ({
    x: originX + c.x,
    y: originY + c.y,
  }));
}

export function getSlot(grid: InventoryGrid, x: number, y: number): InventorySlot | undefined {
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
    return undefined;
  }
  return grid.slots[y * grid.width + x];
}

export function canPlaceItem(
  grid: InventoryGrid,
  item: InventoryItem,
  gridX: number,
  gridY: number,
  rotation = item.rotation,
): boolean {
  if (!item.shape.length || !Number.isInteger(gridX) || !Number.isInteger(gridY)) return false;
  const existing = grid.items.get(item.id);
  if (existing && existing !== item) return false;
  const cells = getItemOccupiedCells(item, gridX, gridY, rotation);

  for (const cell of cells) {
    const slot = getSlot(grid, cell.x, cell.y);
    if (!slot) return false;
    if (slot.isMudded) return false;
    if (slot.itemId !== null && slot.itemId !== item.id) return false;
  }

  return true;
}

export function placeItem(
  grid: InventoryGrid,
  item: InventoryItem,
  gridX: number,
  gridY: number,
  rotation = item.rotation,
): boolean {
  if (!canPlaceItem(grid, item, gridX, gridY, rotation)) {
    return false;
  }

  if (item.relicEffect === 'chain' && grid.items.has(item.id) && (item.gridX !== gridX || item.gridY !== gridY || item.rotation !== rotation)) item.isSevered = true;

  // Размещение атомарно: до проверки цельного положения предмет остаётся в ранце.
  for (const slot of grid.slots) if (slot.itemId === item.id) slot.itemId = null;

  const cells = getItemOccupiedCells(item, gridX, gridY, rotation);
  for (const cell of cells) {
    const slot = getSlot(grid, cell.x, cell.y)!;
    slot.itemId = item.id;
  }

  item.gridX = gridX;
  item.gridY = gridY;
  item.rotation = rotation;
  grid.items.set(item.id, item);
  grid.revision++;

  return true;
}

/**
 * Положить новый предмет в первое место, где он помещается, перебирая и повороты.
 * Возвращает false, если места нет ни в одном повороте; тогда предмет не меняется.
 */
export function autoPlaceItem(grid: InventoryGrid, item: InventoryItem): boolean {
  const original = item.rotation;
  for (const rotation of [original, ...ROTATIONS.filter((r) => r !== original)]) {
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (canPlaceItem(grid, item, x, y, rotation)) return placeItem(grid, item, x, y, rotation);
      }
    }
  }
  item.rotation = original;
  return false;
}

/**
 * Вернуть предмет на прежнее место после неудачного перетаскивания. Если игрок повернул
 * его на лету и в повороте он туда не лезет - на место в прежнем повороте, иначе в любое
 * свободное: раньше такой предмет пропадал из ранца.
 */
export function restoreItem(
  grid: InventoryGrid,
  item: InventoryItem,
  originX: number,
  originY: number,
  originRotation: InventoryItem['rotation'],
): boolean {
  if (placeItem(grid, item, originX, originY)) return true;
  item.rotation = originRotation;
  if (placeItem(grid, item, originX, originY)) return true;
  return autoPlaceItem(grid, item);
}

/** Пересекаются ли предметы в сетке - проверка целостности для тестов и отладки. */
export function findOverlaps(grid: InventoryGrid): string[] {
  const owner = new Map<string, string>();
  const clashes: string[] = [];
  for (const item of grid.items.values()) {
    if (item.gridX === undefined || item.gridY === undefined) continue;
    for (const c of getItemOccupiedCells(item, item.gridX, item.gridY)) {
      const key = `${c.x},${c.y}`;
      const prev = owner.get(key);
      if (prev && prev !== item.id) clashes.push(`${key}: ${prev} / ${item.id}`);
      owner.set(key, item.id);
    }
  }
  return clashes;
}

export function removeItem(grid: InventoryGrid, itemId: string, preserveBelt = false): boolean {
  const item = grid.items.get(itemId);
  if (!item) return false;

  for (const slot of grid.slots) {
    if (slot.itemId === itemId) {
      slot.itemId = null;
    }
  }

  if (item.relicEffect === 'chain') item.isSevered = true;
  item.gridX = undefined;
  item.gridY = undefined;
  grid.items.delete(itemId);
  grid.revision++;

  // Очистка из быстрых слотов
  for (let i = 0; i < grid.quickSlots.length; i++) {
    if (!preserveBelt && grid.quickSlots[i] === itemId) {
      grid.quickSlots[i] = null;
    }
  }

  return true;
}

export function calculateWeightClass(totalWeight: number): WeightClass {
  if (totalWeight < 6.0) return 'light';
  if (totalWeight <= 15.0) return 'medium';
  return 'heavy';
}

/** Усиление относится только к свитку, касающемуся целой линзы. */
export function getScrollMultiplier(grid: InventoryGrid, scrollId: string): number {
  const scroll = grid.items.get(scrollId);
  if (!scroll || scroll.category !== 'scroll' || scroll.gridX === undefined || scroll.gridY === undefined) return 1;
  const lenses = new Set<string>();
  for (const cell of getItemOccupiedCells(scroll, scroll.gridX, scroll.gridY)) {
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const id = getSlot(grid, cell.x + dx!, cell.y + dy!)?.itemId;
      const item = id ? grid.items.get(id) : undefined;
      if (item?.category === 'relic' && item.relicEffect !== 'chain' && item.element === 'aether' && (item.durability ?? 0) > 0) lenses.add(item.id);
    }
  }
  return Math.min(1.75, 1 + lenses.size * 0.25);
}

/** Уникальные соседи по сторонам всех клеток, включая повёрнутые формы. */
export function getAdjacentItems(grid: InventoryGrid, item: InventoryItem): InventoryItem[] {
  if (item.gridX === undefined || item.gridY === undefined) return [];
  const ids = new Set<string>();
  for (const cell of getItemOccupiedCells(item,item.gridX,item.gridY)) {
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const id=getSlot(grid,cell.x+dx!,cell.y+dy!)?.itemId;
      if(id && id!==item.id) ids.add(id);
    }
  }
  return Array.from(ids).map(id=>grid.items.get(id)).filter((neighbor): neighbor is InventoryItem => !!neighbor);
}

const statsCache = new WeakMap<InventoryGrid, { revision: number; stats: InventoryStats }>();
export function calculateInventoryStats(grid: InventoryGrid): InventoryStats {
  const cached = statsCache.get(grid);
  if (cached?.revision === grid.revision) return cached.stats;
  let totalWeight = 0;
  let totalArmor = 0;
  let chainArmor = 0;
  let bonusFireDamage = 0;
  let bonusPoisonDamage = 0;
  let bonusCritRate = 0;
  let healingMultiplier = 1;
  let scrollMultiplier = 1;

  for (const item of grid.items.values()) {
    totalWeight += item.weight;
    if (item.relicEffect === 'chain' && !item.isSevered && !isItemContaminated(grid,item)) chainArmor = 6;
    if (item.category === 'scroll') scrollMultiplier = Math.max(scrollMultiplier, getScrollMultiplier(grid, item.id));
    if (item.defense) {
      totalArmor += item.defense;
    }
  }

  // Расчёт соседства и стихийного резонанса
  for (const item of grid.items.values()) {
    if (item.gridX === undefined || item.gridY === undefined || item.durability === 0) continue;

    for (const neighborItem of getAdjacentItems(grid,item)) {
      // Огонь греет соседнее оружие
      if (item.element === 'fire' && neighborItem.category === 'weapon') {
        bonusFireDamage += 6;
      }

      // Ядовитая железа смазывает оружие, но портит еду/зелья
      if (item.element === 'poison') {
        if (neighborItem.category === 'weapon') {
          bonusPoisonDamage += 5;
        }
      }

      // Лёд усиливает критические удары, но замораживает соседние лечебные припасы.
      if (item.element === 'ice' && neighborItem.category === 'weapon') bonusCritRate += 0.12;
      if (item.rarity !== 'holy' && item.element === 'ice' && neighborItem.category === 'potion') healingMultiplier = 0.5;
    }
  }

  const stats: InventoryStats = {
    totalWeight,
    weightClass: calculateWeightClass(totalWeight),
    totalArmor: totalArmor + chainArmor,
    bonusFireDamage,
    bonusPoisonDamage,
    bonusCritRate,
    healingMultiplier,
    scrollMultiplier,
  };
  statsCache.set(grid, { revision: grid.revision, stats });
  return stats;
}

let fusionCounter = 0;
export function scrollFusion(scrollA: InventoryItem, scrollB: InventoryItem): InventoryItem | null {
  if (scrollA.category !== 'scroll' || scrollB.category !== 'scroll') {
    return null;
  }

  const elements = [scrollA.element, scrollB.element].sort();

  if (elements[0] === 'fire' && elements[1] === 'poison') {
    return {
      id: `fusion_${Date.now()}_${fusionCounter++}`,
      name: 'Свиток Чумного Пламени',
      category: 'scroll',
      rarity: 'rare',
      element: 'fire',
      shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
      weight: 1.2,
      rotation: 0,
      damage: 35,
      heatCost: 30,
    };
  }

  if (elements[0] === 'aether' && elements[1] === 'ice') {
    return {
      id: `fusion_${Date.now()}_${fusionCounter++}`,
      name: 'Свиток Абсолютного Окоченения',
      category: 'scroll',
      rarity: 'rare',
      element: 'ice',
      shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      weight: 0.8,
      rotation: 0,
      damage: 22,
      heatCost: 20,
    };
  }

  return null;
}

/** Споры в соседней ячейке мешают использовать предмет до очистки ранца. */
export function isItemContaminated(grid: InventoryGrid, item: InventoryItem): boolean {
  if (item.gridX === undefined || item.gridY === undefined) return false;
  for (const cell of getItemOccupiedCells(item, item.gridX, item.gridY)) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (getSlot(grid, cell.x + dx!, cell.y + dy!)?.isMudded) return true;
    }
  }
  return false;
}
export function infectInventory(grid: InventoryGrid): boolean {
  const cell = grid.slots.find((slot) => !slot.isMudded && slot.itemId === null);
  if (!cell) return false;
  cell.isMudded = true; grid.revision++; return true;
}
export function cleanseInventory(grid: InventoryGrid): void {
  for (const slot of grid.slots) slot.isMudded = false;
  for (const item of grid.items.values()) { item.isSpoiled = false; item.burnTime = 0; item.poisonTime = 0; }
  grid.revision++;
}
