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
    width,
    height,
    slots,
    items: new Map<string, InventoryItem>(),
    quickSlots: [null, null, null, null],
  };
}

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

export function getItemOccupiedCells(item: InventoryItem, originX: number, originY: number): GridCoord[] {
  const rotated = getRotatedCoords(item.shape, item.rotation);
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
): boolean {
  const cells = getItemOccupiedCells(item, gridX, gridY);

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
): boolean {
  if (!canPlaceItem(grid, item, gridX, gridY)) {
    return false;
  }

  // Сначала очистим предыдущие слоты, если предмет уже был в сетке
  if (item.gridX !== undefined && item.gridY !== undefined) {
    removeItem(grid, item.id);
  }

  const cells = getItemOccupiedCells(item, gridX, gridY);
  for (const cell of cells) {
    const slot = getSlot(grid, cell.x, cell.y)!;
    slot.itemId = item.id;
  }

  item.gridX = gridX;
  item.gridY = gridY;
  grid.items.set(item.id, item);

  return true;
}

export function removeItem(grid: InventoryGrid, itemId: string): boolean {
  const item = grid.items.get(itemId);
  if (!item) return false;

  for (const slot of grid.slots) {
    if (slot.itemId === itemId) {
      slot.itemId = null;
    }
  }

  item.gridX = undefined;
  item.gridY = undefined;
  grid.items.delete(itemId);

  // Очистка из быстрых слотов
  for (let i = 0; i < grid.quickSlots.length; i++) {
    if (grid.quickSlots[i] === itemId) {
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

export function calculateInventoryStats(grid: InventoryGrid): InventoryStats {
  let totalWeight = 0;
  let totalArmor = 0;
  let bonusFireDamage = 0;
  let bonusPoisonDamage = 0;
  let bonusCritRate = 0;

  for (const item of grid.items.values()) {
    totalWeight += item.weight;
    if (item.defense) {
      totalArmor += item.defense;
    }
  }

  // Расчёт соседства и стихийного резонанса
  for (const item of grid.items.values()) {
    if (item.gridX === undefined || item.gridY === undefined) continue;

    const myCells = getItemOccupiedCells(item, item.gridX, item.gridY);
    const adjacentItemIds = new Set<string>();

    for (const cell of myCells) {
      const neighbors: GridCoord[] = [
        { x: cell.x + 1, y: cell.y },
        { x: cell.x - 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 },
        { x: cell.x, y: cell.y - 1 },
      ];

      for (const n of neighbors) {
        const slot = getSlot(grid, n.x, n.y);
        if (slot && slot.itemId && slot.itemId !== item.id) {
          adjacentItemIds.add(slot.itemId);
        }
      }
    }

    for (const adjId of adjacentItemIds) {
      const neighborItem = grid.items.get(adjId);
      if (!neighborItem) continue;

      // Огонь греет соседнее оружие
      if (item.element === 'fire' && neighborItem.category === 'weapon') {
        bonusFireDamage += 6;
      }

      // Ядовитая железа смазывает оружие, но портит еду/зелья
      if (item.element === 'poison') {
        if (neighborItem.category === 'weapon') {
          bonusPoisonDamage += 5;
        } else if (neighborItem.category === 'potion') {
          neighborItem.isSpoiled = true;
        }
      }

      // Лед дает критический шанс оружию
      if (item.element === 'ice' && neighborItem.category === 'weapon') {
        bonusCritRate += 0.12; // +12% крит
      }
    }
  }

  return {
    totalWeight,
    weightClass: calculateWeightClass(totalWeight),
    totalArmor,
    bonusFireDamage,
    bonusPoisonDamage,
    bonusCritRate,
  };
}

export function scrollFusion(scrollA: InventoryItem, scrollB: InventoryItem): InventoryItem | null {
  if (scrollA.category !== 'scroll' || scrollB.category !== 'scroll') {
    return null;
  }

  const elements = [scrollA.element, scrollB.element].sort();

  if (elements[0] === 'fire' && elements[1] === 'poison') {
    return {
      id: `fusion_${Date.now()}`,
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
      id: `fusion_${Date.now()}`,
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
