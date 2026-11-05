import type { DungeonFloor, DungeonRoom } from './types.ts';
export function secretDoor(floor: DungeonFloor, room: DungeonRoom): { x: number; z: number; angle: number } {
  const edge = floor.connections.find(([a, b]) => a === room.id || b === room.id);
  const neighbor = edge ? floor.rooms.find((other) => other.id === (edge[0] === room.id ? edge[1] : edge[0])) : undefined;
  if (!neighbor) return { x: room.x, z: room.y, angle: 0 };
  const dx = room.x - neighbor.x, dz = room.y - neighbor.y;
  const t = Math.min(dx ? neighbor.width / 2 / Math.abs(dx) : Infinity, dz ? neighbor.height / 2 / Math.abs(dz) : Infinity);
  return { x: neighbor.x + dx * t, z: neighbor.y + dz * t, angle: Math.atan2(dx, dz) };
}
/** Видение читает ближайшее пространство; удар/резонанс требуют близости к стене. */
export function revealSecrets(floor: DungeonFloor, x: number, z: number, options: { vision: boolean; elemental: boolean; trueSight: boolean; heat: number }): string[] {
  if (!options.vision && !options.elemental && !options.trueSight && !(options.heat >= 80 && options.heat <= 95)) return [];
  const opened: string[] = [];
  for (const room of floor.rooms) {
    if (!room.secret || room.unlocked) continue;
    const door = secretDoor(floor, room);
    if (Math.hypot(x - door.x, z - door.z) > (options.vision ? 25 : 3)) continue;
    room.unlocked = true; room.isRevealed = true; opened.push(room.id);
  }
  return opened;
}
