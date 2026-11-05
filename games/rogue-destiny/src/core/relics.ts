import type { InventoryGrid, InventoryItem } from './types.ts';
/** Награды за исследование: сильный безопасный посох или рискованный быстрый путь. */
export function shrineRelic(floor: number): InventoryItem {
  const infernal = floor % 2 === 0;
  return {
    id: `shrine_relic_${floor}`, name: infernal ? 'Адский жезл Пепельного долга' : 'Святой посох Тихой воды',
    category: 'weapon', rarity: infernal ? 'infernal' : 'holy', element: infernal ? 'fire' : 'ice',
    shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    weight: infernal ? 3.2 : 2.8, rotation: 0, damage: infernal ? 36 : 24,
  };
}
export function weaponPrice(item: InventoryItem): { health: number; fatigue: number } {
  return item.rarity === 'infernal' ? { health: 4, fatigue: 3 } : { health: 0, fatigue: 0 };
}

export function libraryRelic(floor: number): InventoryItem {
  if (floor % 2 === 0) return { id: `library_chain_${floor}`, name: 'Эфирная цепь неподвижного якоря', category: 'relic', rarity: 'rare', element: 'aether', relicEffect: 'chain', isSevered: false, shape: [{x:0,y:0},{x:0,y:1},{x:0,y:2}], weight: 1.4, rotation: 0 };
  return { id: `library_lens_${floor}`, name: 'Линза затопленного архивариуса', category: 'relic', rarity: 'rare', element: 'aether', relicEffect: 'lens',
    shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }], weight: 0.8, rotation: 0, durability: 20, maxDurability: 20 };
}

/** Удары трескают линзы; нулевой урон и парирование их не повреждают. */
export function damageFragileRelics(grid: InventoryGrid, actualDamage: number): boolean {
  if (!Number.isFinite(actualDamage) || actualDamage <= 0) return false;
  let changed = false;
  for (const item of grid.items.values()) {
    if (item.category !== 'relic' || item.relicEffect === 'chain' || item.element !== 'aether' || !(item.durability! > 0)) continue;
    item.durability = Math.max(0, item.durability! - 4);
    changed = true;
  }
  if (changed) grid.revision++;
  return changed;
}

/** Награда бокового маршрута даёт инструмент для следующих этажей. */
export function vaultRelic(floor: number): InventoryItem {
  const breathing = floor % 2 === 1;
  return { id: `vault_tool_${floor}`, name: breathing ? 'Амулет жабродыхания' : 'Крюк корневого следопыта',
    category: 'tool', rarity: 'holy', element: 'physical', utility: breathing ? 'breathing' : 'grapple',
    shape: breathing ? [{x:0,y:0}] : [{x:0,y:0},{x:0,y:1}], weight: breathing ? 0.4 : 0.9, rotation: 0 };
}


/** Разные фокусы поощряют выбор между физическим ответом и запасом магии. */
export function oracleFocus(floor: number): InventoryItem {
  const parryType=floor>=3?'both':floor===2?'reflect':'siphon';
  return {id:`oracle_focus_${floor}`,name:parryType==='both'?'Зеркало сплетённых Нитей':parryType==='reflect'?'Зеркальный баклер Оракула':'Фокус перехвата эссенции',
    category:'shield',rarity:parryType==='both'?'holy':'rare',element:'aether',parryType,
    shape:[{x:0,y:0},{x:0,y:1}],weight:parryType==='siphon'?0.6:1.1,rotation:0,defense:parryType==='siphon'?1:4};
}
