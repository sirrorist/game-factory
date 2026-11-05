import { enemyBalance } from './balance.ts';
export type SylvanKind='sentinel'|'stalker'|'thorn'|'warden';
export interface EnemyProfile {kind:SylvanKind;name:string;hp:number;claw:number;slam:number;speed:number;windup:number;recover:number;reach:number;knockback:number;resistsWindup:boolean;coreDamage:number}
/** Разновидность выводится из сохранённого id: загрузка не меняет роль противника. */
export function enemyProfile(id:string,level:number,boss=false):EnemyProfile {
  const base=enemyBalance(level,boss),depth=Math.max(0,Math.min(2,Math.floor(level)-1));
  if(boss) return {...base,kind:'warden',name:'Страж Семени',speed:2.2,windup:0.65,recover:0.65,reach:3.2,knockback:1.5,resistsWindup:true,coreDamage:0};
  if(id.includes('relicwatch')||id.includes('oraclewatch')) return {...base,kind:'thorn',name:'Терновый Панцирник',hp:56+depth*10,claw:20+depth*2,speed:1.9,windup:0.85,recover:1,reach:2.8,knockback:2.5,resistsWindup:true,coreDamage:0};
  if(id.endsWith('_2')) return {...base,kind:'stalker',name:'Споровый Ловчий',hp:32+depth*8,claw:12+depth,speed:3.3,windup:0.42,recover:0.55,reach:2.5,knockback:8,resistsWindup:false,coreDamage:6};
  return {...base,kind:'sentinel',name:'Дозорный Корней',speed:2.6,windup:0.55,recover:0.7,reach:2.6,knockback:7,resistsWindup:false,coreDamage:0};
}

/** Выбор одной ближайшей угрозы перед камерой, без скачков между далёкими врагами. */
export function selectCombatTarget<T extends {x:number;z:number;kind:SylvanKind;alive:boolean}>(enemies: readonly T[],x:number,z:number,yaw:number):T|null {
  let target:T|null=null,distance=Infinity;
  for(const enemy of enemies) {
    if(!enemy.alive) continue;
    const dx=enemy.x-x,dz=enemy.z-z,length=Math.hypot(dx,dz);
    if(length>(enemy.kind==='warden'?14:7)||length>=distance) continue;
    if(length>0.1&&(dx*Math.sin(yaw)+dz*Math.cos(yaw))/length<0.15) continue;
    target=enemy;distance=length;
  }
  return target;
}
