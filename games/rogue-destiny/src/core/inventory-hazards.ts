import { getAdjacentItems, isItemContaminated, removeItem } from './inventory.ts';
import type { InventoryGrid, InventoryItem } from './types.ts';

export const PAPER_BURN_SECONDS = 8;
export const POTION_POISON_SECONDS = 6;
function dangerousNeighbors(grid: InventoryGrid,item: InventoryItem): InventoryItem[] {
  return getAdjacentItems(grid,item).filter(source=>source.rarity!=='holy' && !source.isSpoiled && source.durability!==0 && !isItemContaminated(grid,source));
}
export interface HazardWarning { itemId: string; name: string; kind: 'fire' | 'poison'; remaining: number }
export function inventoryWarnings(grid: InventoryGrid): HazardWarning[] {
  const warnings: HazardWarning[]=[];
  for(const item of grid.items.values()) {
    const neighbors=dangerousNeighbors(grid,item);
    if(item.category==='scroll' && neighbors.some(source=>source.element==='fire')) warnings.push({itemId:item.id,name:item.name,kind:'fire',remaining:Math.max(0,PAPER_BURN_SECONDS-(item.burnTime??0))});
    if(item.category==='potion' && !item.isSpoiled && neighbors.some(source=>source.element==='poison')) warnings.push({itemId:item.id,name:item.name,kind:'poison',remaining:Math.max(0,POTION_POISON_SECONDS-(item.poisonTime??0))});
  }
  return warnings;
}
/** Игровое время: пауза не портит припасы, перестановка даёт им остыть/выветриться. */
export function tickInventoryHazards(grid: InventoryGrid,dt: number): { burned: string[]; spoiled: string[] } {
  const result={burned:[] as string[],spoiled:[] as string[]};
  if(!Number.isFinite(dt)||dt<=0) return result;
  const warnings=new Map(inventoryWarnings(grid).map(warning=>[warning.itemId,warning]));
  for(const item of Array.from(grid.items.values())) {
    const warning=warnings.get(item.id);
    if(item.category==='scroll') item.burnTime=Math.max(0,Math.min(PAPER_BURN_SECONDS,(item.burnTime??0)+dt*(warning?.kind==='fire'?1:-2)));
    if(item.category==='potion') item.poisonTime=Math.max(0,Math.min(POTION_POISON_SECONDS,(item.poisonTime??0)+dt*(warning?.kind==='poison'?1:-2)));
    if((item.burnTime??0)>=PAPER_BURN_SECONDS-1e-8) {
      result.burned.push(item.name);removeItem(grid,item.id);
    } else if((item.poisonTime??0)>=POTION_POISON_SECONDS-1e-8 && !item.isSpoiled) {
      item.isSpoiled=true;grid.revision++;result.spoiled.push(item.name);
    }
  }
  return result;
}
