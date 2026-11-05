import { hasLineOfSight } from './movement.ts';
import type { DungeonFloor } from './types.ts';
/** Магия находит ближайшую цель в секторе камеры, закрытый зал не простреливается. */
export function aimedTarget<T extends {x:number;z:number;alive:boolean}>(floor:DungeonFloor,targets:readonly T[],x:number,z:number,yaw:number,range=7.5):T|null {
  let nearest:T|null=null,best=range;
  for(const target of targets) {
    if(!target.alive)continue;
    const dx=target.x-x,dz=target.z-z,distance=Math.hypot(dx,dz);
    if(distance>best)continue;
    if(distance>0.1&&(dx*Math.sin(yaw)+dz*Math.cos(yaw))/distance<0.35)continue;
    if(!hasLineOfSight(floor,x,z,target.x,target.z))continue;
    nearest=target;best=distance;
  }
  return nearest;
}
