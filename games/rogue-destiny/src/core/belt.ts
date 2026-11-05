import { isItemContaminated } from './inventory.ts';
import type { InventoryGrid, InventoryItem } from './types.ts';
const categories = ['weapon', 'shield', 'potion', 'scroll'] as const;
export function fitsBelt(item: InventoryItem, index: number): boolean {
  return item.category === categories[index] && !item.isSpoiled && item.durability !== 0;
}
/** После расходования следующий подходящий предмет занимает освободившийся слот. */
export function beltItem(grid: InventoryGrid, index: number): InventoryItem | null {
  if (index < 0 || index > 3) return null;
  const id = grid.quickSlots[index];
  const selected = id ? grid.items.get(id) : undefined;
  // При перетаскивании ссылка остаётся, но предмет временно снят с сетки.
  if (id && !selected) return null;
  if (selected && fitsBelt(selected, index) && !isItemContaminated(grid, selected)) return selected;
  const next = Array.from(grid.items.values()).find((item) => fitsBelt(item, index) && !isItemContaminated(grid, item));
  grid.quickSlots[index] = next?.id ?? null;
  return next ?? null;
}
