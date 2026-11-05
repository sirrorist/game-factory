import type { DungeonRoom, DungeonFloor } from './types.ts';

/** Комнаты и позиции у их краёв укладываются с запасом; неизвестный секрет не меняет масштаб. */
export function minimapLayout(rooms: readonly DungeonRoom[], width: number, height: number): { scale: number; offsetX: number; offsetY: number } {
  const visible = rooms.filter(room => !room.secret || room.isRevealed);
  if (!visible.length) return { scale: 1, offsetX: width / 2, offsetY: height / 2 };
  const minX = Math.min(...visible.map(room => room.x-room.width/2)), maxX = Math.max(...visible.map(room => room.x+room.width/2));
  const minY = Math.min(...visible.map(room => room.y-room.height/2)), maxY = Math.max(...visible.map(room => room.y+room.height/2));
  const scale = Math.max(0, Math.min((width - 24) / Math.max(1, maxX - minX), (height - 24) / Math.max(1, maxY - minY), 2.2));
  return { scale, offsetX: width / 2 - (minX + maxX) / 2 * scale, offsetY: height / 2 - (minY + maxY) / 2 * scale };
}


/** Метки не раскрывают неисследованные комнаты и тайники. */
export function mapMarkerVisible(floor: DungeonFloor,x:number,z:number): boolean {
  return floor.rooms.some(room=>room.isRevealed&&Math.abs(x-room.x)<=room.width/2&&Math.abs(z-room.y)<=room.height/2);
}
