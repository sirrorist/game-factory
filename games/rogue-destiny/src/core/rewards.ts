import {awardFate} from './fate.ts';
import type { PlayerState,InventoryItem } from './types.ts';
/** Один путь начисления для удара, яда, парирования и срыва Ядра. */
export function claimDefeat(player:PlayerState,claimed:Set<string>,enemy:{id:string;isAlive:boolean},onReserve:(item:InventoryItem)=>void):boolean {
  if(enemy.isAlive||claimed.has(enemy.id))return false;
  claimed.add(enemy.id);player.elitesDefeated++;
  if(enemy.id.startsWith('warden_')){const reserve=awardFate(player,enemy.id);if(reserve)onReserve(reserve);}
  return true;
}
