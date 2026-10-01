// Сыпучие блоки: песок и гравий падают, если под ними воздух или вода. Как и вода (water.ts),
// падает только то, что разбудила правка игрока: песок над пещерой из генерации висит, пока
// его не тронут, иначе на старте осыпались бы все пляжи над пещерами.

import { B } from './blocks.ts';
import type { WaterWorld } from './water.ts';

export const LOOSE = new Set<number>([B.SAND, B.GRAVEL]);

interface Cell {
  x: number;
  y: number;
  z: number;
}

export class FallingBlocks {
  private queue: Cell[] = [];

  get pending(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }

  /** Блок (x, y, z) изменился: проверить его самого (поставленный песок) и столб над ним. */
  wake(world: WaterWorld, x: number, y: number, z: number): void {
    if (LOOSE.has(world.get(x, y, z))) this.queue.push({ x, y, z });
    if (LOOSE.has(world.get(x, y + 1, z))) this.queue.push({ x, y: y + 1, z });
  }

  /**
   * Сдвинуть до `budget` блоков на одну клетку вниз. Падающий блок за шаг опускается на одну
   * клетку - так видно, как песок сыплется. Возвращает, сколько блоков сдвинулось.
   */
  step(world: WaterWorld, budget: number): number {
    let moved = 0;
    const next: Cell[] = [];
    for (let n = 0; n < budget && this.queue.length; n++) {
      const c = this.queue.shift()!;
      const id = world.get(c.x, c.y, c.z);
      if (!LOOSE.has(id) || c.y <= 0) continue;
      const below = world.get(c.x, c.y - 1, c.z);
      if (below !== B.AIR && below !== B.WATER) continue;
      // Тонет в воде: вода поднимается на место блока.
      if (!world.set(c.x, c.y - 1, c.z, id)) continue;
      world.set(c.x, c.y, c.z, below);
      moved++;
      next.push({ x: c.x, y: c.y - 1, z: c.z });
      // Над ушедшим блоком мог стоять ещё песок - столб осыпается целиком.
      if (LOOSE.has(world.get(c.x, c.y + 1, c.z))) next.push({ x: c.x, y: c.y + 1, z: c.z });
    }
    this.queue.push(...next);
    return moved;
  }
}
