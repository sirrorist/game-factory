import {hasLineOfSight} from './movement.ts';
import type {DungeonFloor} from './types.ts';
export interface EnemySenses {active:boolean;see:boolean;hear:boolean}
/** Печать удерживает обитателя. Вне печати зрение требует прямого пути, шум слышен со спины. */
export function enemySenses(floor:DungeonFloor,enemy:{x:number;z:number;yaw:number},hero:{x:number;z:number},visionRange:number,noisy:boolean):EnemySenses {
  if(floor.rooms.some(room=>room.lockType&&!room.unlocked&&Math.abs(enemy.x-room.x)<=room.width/2&&Math.abs(enemy.z-room.y)<=room.height/2))return {active:false,see:false,hear:false};
  const dx=hero.x-enemy.x,dz=hero.z-enemy.z,distance=Math.hypot(dx,dz);
  const front=distance<1||distance>0&&(dx*Math.sin(enemy.yaw)+dz*Math.cos(enemy.yaw))/distance>0.05;
  return {active:true,see:distance<=visionRange&&front&&hasLineOfSight(floor,enemy.x,enemy.z,hero.x,hero.z),hear:noisy&&distance<=14};
}
