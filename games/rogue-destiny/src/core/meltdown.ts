import type { DungeonFloor, DungeonRoom, PlayerState } from './types.ts';
export function insideRoom(room: DungeonRoom,x:number,z:number): boolean {
  return Math.abs(x-room.x)<=room.width/2 && Math.abs(z-room.y)<=room.height/2;
}
export function meltdownRoom(floor: DungeonFloor,x:number,z:number): DungeonRoom | undefined {
  return floor.rooms.find(room=>insideRoom(room,x,z) && (!room.lockType||room.unlocked));
}
/** Осознанный аварийный выход из перегрузки; повторно разрушенный зал не питает импульс. */
export function meltdown(player: PlayerState,room: DungeonRoom | undefined): {success:boolean;reason:string} {
  if(player.isDead) return {success:false,reason:'Ядро уже погасло.'};
  if(player.aetherHeat<95) return {success:false,reason:'Для срыва Ядра нужен перегрев от 95%.'};
  if(player.threadsOfFate<1) return {success:false,reason:'Для срыва Ядра нужна Нить Судьбы.'};
  if(!room||room.devastated) return {success:false,reason:'Нужен целый зал: в переходе между залами или руинах срыв невозможен.'};
  player.threadsOfFate--;player.hp=1;player.aetherHeat=0;player.aetherCore=0;player.temporaryMana=0;player.fatigue=100;
  room.devastated=true;
  return {success:true,reason:'Срыв Ядра: зал уничтожен. -1 Нить, 1 HP, Ядро погасло. Оставленный в зале лут утрачен.'};
}
