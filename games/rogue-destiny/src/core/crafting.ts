import { autoPlaceItem, isItemContaminated, placeItem, removeItem, scrollFusion } from './inventory.ts';
import type { InventoryGrid, InventoryItem } from './types.ts';
/** Слияние либо целиком проходит, либо возвращает оба исходных предмета и пояс. */
export function fuseScrolls(grid: InventoryGrid, firstId: string, secondId: string): InventoryItem | null {
  if (firstId === secondId) return null;
  const a = grid.items.get(firstId), b = grid.items.get(secondId);
  if (!a || !b || isItemContaminated(grid, a) || isItemContaminated(grid, b)) return null;
  const result = scrollFusion(a, b);
  if (!result) return null;
  const ax = a.gridX!, ay = a.gridY!, bx = b.gridX!, by = b.gridY!;
  const belt = [...grid.quickSlots];
  removeItem(grid, a.id); removeItem(grid, b.id);
  if (autoPlaceItem(grid, result)) {
    for (let i = 0; i < belt.length; i++) if (belt[i] === a.id || belt[i] === b.id) grid.quickSlots[i] = result.id;
    return result;
  }
  placeItem(grid, a, ax, ay); placeItem(grid, b, bx, by);
  grid.quickSlots = belt;
  return null;
}
