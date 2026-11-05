import {isItemContaminated,removeItem} from './inventory.ts';
import type {InventoryGrid,InventoryItem,PlayerState} from './types.ts';
/** Излишек не исчезает: вызывающий помещает предмет в ранец или оставляет на земле. */
export function awardFate(player:PlayerState,source:string):InventoryItem|null {
  if(player.threadsOfFate<player.maxThreads){player.threadsOfFate++;return null;}
  return {id:`fate_${source}`,name:'Нить Судьбы в запасе',category:'relic',rarity:'holy',element:'aether',relicEffect:'thread',
    shape:[{x:0,y:0}],weight:0.1,rotation:0};
}
export function fateReserves(grid:InventoryGrid):InventoryItem[] {
  return Array.from(grid.items.values()).filter(item=>item.category==='relic'&&item.relicEffect==='thread'&&!item.isSpoiled&&!isItemContaminated(grid,item));
}
export function weaveFate(player:PlayerState,grid:InventoryGrid,id:string):boolean {
  if(player.isDead||player.threadsOfFate>=player.maxThreads||!fateReserves(grid).some(item=>item.id===id))return false;
  if(!removeItem(grid,id))return false;
  player.threadsOfFate++;return true;
}

export function fateScoutTargets(floor:import('./types.ts').DungeonFloor):import('./types.ts').DungeonRoom[] {
  const neighbors=new Set(floor.connections.flatMap(([a,b])=>a===floor.activeRoomId?[b]:b===floor.activeRoomId?[a]:[]));
  return floor.rooms.filter(room=>neighbors.has(room.id)&&!room.isRevealed);
}
export function scoutWithFate(player:PlayerState,floor:import('./types.ts').DungeonFloor):{spent:boolean;revealed:string[];opened:string[]} {
  const result={spent:false,revealed:[] as string[],opened:[] as string[]};
  if(player.isDead||player.threadsOfFate<=0)return result;
  const targets=fateScoutTargets(floor);if(!targets.length)return result;
  player.threadsOfFate--;result.spent=true;
  for(const room of targets){room.isRevealed=true;result.revealed.push(room.id);if(room.secret&&room.lockType==='illusionary'&&!room.unlocked){room.unlocked=true;result.opened.push(room.id);}}
  return result;
}
/** Нить тратится только после первого провала, повтор выполняется не более одного раза. */
export function attemptWithFate(player:PlayerState,chance:number,reroll:boolean,random:()=>number=Math.random):{success:boolean;spent:boolean;attempts:number} {
  if(player.isDead||!Number.isFinite(chance)||chance<0||chance>1)return {success:false,spent:false,attempts:0};
  const first=random();if(!Number.isFinite(first)||first<0||first>=1)return {success:false,spent:false,attempts:1};
  if(first<chance)return {success:true,spent:false,attempts:1};
  if(!reroll||player.threadsOfFate<=0)return {success:false,spent:false,attempts:1};
  player.threadsOfFate--;return {success:random()<chance,spent:true,attempts:2};
}
