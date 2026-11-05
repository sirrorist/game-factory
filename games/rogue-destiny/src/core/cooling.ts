import { isItemContaminated } from './inventory.ts';
import { applyDamage } from './player.ts';
import type { InventoryGrid, InventoryItem, PlayerState } from './types.ts';
export interface SteamState { remaining: number; damageBuffer: number; x: number; z: number }
export const createSteamState = (): SteamState => ({remaining:0,damageBuffer:0,x:0,z:0});
export function canAbsorbHeat(item: InventoryItem): boolean {
  return !item.isSpoiled && (item.category==='weapon' && (item.damage??0)>4 || (item.category==='rune'||item.category==='relic') && item.relicEffect!=='chain' && (item.durability??0)>0);
}
export function coolIntoItem(player: PlayerState,grid: InventoryGrid,id: string): {heat:number;reason:string} {
  const item=grid.items.get(id);
  if(player.isDead||player.aetherHeat<=15) return {heat:0,reason:'Для отвода нужно больше 15% жара.'};
  if(!item||!canAbsorbHeat(item)||isItemContaminated(grid,item)) return {heat:0,reason:'Этот предмет не может принять жар.'};
  let heat: number;
  if(item.category==='weapon') {
    heat=Math.min(25,player.aetherHeat);item.damage=Math.max(4,(item.damage??0)-Math.ceil(heat/12.5));
  } else {
    heat=Math.min(40,player.aetherHeat,item.durability!*5);item.durability=Math.max(0,item.durability!-Math.ceil(heat/5));
  }
  player.aetherHeat-=heat;grid.revision++;
  return {heat,reason:item.category==='weapon'?`${item.name}: отведено ${heat}% жара, оружие затупилось.`:`${item.name}: отведено ${heat}% жара, потрачена прочность.`};
}
export function coolIntoWater(player: PlayerState,steam: SteamState,x:number,z:number): {heat:number;reason:string} {
  if(player.isDead||player.aetherHeat<=15) return {heat:0,reason:'Для отвода нужно больше 15% жара.'};
  if(steam.remaining>0) return {heat:0,reason:'Дождитесь рассеивания ядовитого пара.'};
  const heat=Math.min(35,player.aetherHeat);player.aetherHeat-=heat;
  steam.remaining=4;steam.damageBuffer=0;steam.x=x;steam.z=z;
  return {heat,reason:`Вода забрала ${heat}% жара. Пар скрывает вас 4 секунды, но яд нанесёт 4 урона.`};
}
export function tickSteamPoison(player: PlayerState,steam: SteamState,dt:number): {damage:number;fate:boolean} {
  const result={damage:0,fate:false};
  if(!Number.isFinite(dt)||dt<=0||steam.remaining<=0||player.isDead) return result;
  const elapsed=Math.min(dt,steam.remaining);steam.remaining=Math.max(0,steam.remaining-elapsed);steam.damageBuffer+=elapsed;
  if(steam.remaining<1e-8) steam.remaining=0;
  const damage=Math.floor(steam.damageBuffer+1e-8);
  if(damage>0) {
    steam.damageBuffer=Math.max(0,steam.damageBuffer-damage);
    // По одному урону: лёгкий яд не превращается в тяжёлую травму при редком кадре.
    for(let i=0;i<damage&&!player.isDead;i++) {const hit=applyDamage(player,1);result.damage+=hit.actualDamage;result.fate ||= hit.survivedByFate;}
  }
  return result;
}

/** Разлом заново зажигает стартовый катализатор: его истощение не запирает основной путь. */
export function rekindleStarterCatalyst(grid: InventoryGrid): boolean {
  const catalyst=grid.items.get('fire_stone_starter');
  if(!catalyst||catalyst.category!=='rune'||catalyst.element!=='fire') return false;
  if(catalyst.durability===12&&catalyst.maxDurability===12) return false;
  catalyst.durability=12;catalyst.maxDurability=12;grid.revision++;return true;
}
