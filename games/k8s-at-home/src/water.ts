// Растекание воды после правок игрока. Упрощённо, без уровней воды: вода падает вниз сколько
// угодно, а вбок расходится не дальше FLOW_RANGE блоков от места, где упёрлась. Мир из генерации
// не течёт - только то, что разбудила правка, иначе на старте поплыли бы все берега пещер.

import { B } from './blocks.ts';

export const FLOW_RANGE = 7;

interface Cell {
  x: number;
  y: number;
  z: number;
  /** Сколько ещё блоков вбок можно пройти. */
  left: number;
}

export interface WaterWorld {
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, id: number): boolean;
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export class WaterFlow {
  private queue: Cell[] = [];

  get pending(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }

  /** Блок (x, y, z) стал воздухом: соседняя вода сверху и сбоку начинает течь в него. */
  wake(world: WaterWorld, x: number, y: number, z: number): void {
    const around = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const;
    for (const [dx, dy, dz] of around) {
      if (world.get(x + dx, y + dy, z + dz) === B.WATER) this.queue.push({ x: x + dx, y: y + dy, z: z + dz, left: FLOW_RANGE });
    }
  }

  /** Обработать до `budget` клеток. Возвращает, сколько блоков стало водой. */
  step(world: WaterWorld, budget: number): number {
    let filled = 0;
    for (let n = 0; n < budget && this.queue.length; n++) {
      const c = this.queue.shift()!;
      if (world.get(c.x, c.y, c.z) !== B.WATER) continue;
      // Сначала вниз: падающая вода вбок не растекается, как в жизни.
      if (world.get(c.x, c.y - 1, c.z) === B.AIR) {
        if (world.set(c.x, c.y - 1, c.z, B.WATER)) {
          filled++;
          this.queue.push({ x: c.x, y: c.y - 1, z: c.z, left: c.left });
        }
        continue;
      }
      if (c.left <= 0) continue;
      for (const [dx, dz] of SIDES) {
        if (world.get(c.x + dx, c.y, c.z + dz) !== B.AIR) continue;
        if (world.set(c.x + dx, c.y, c.z + dz, B.WATER)) {
          filled++;
          this.queue.push({ x: c.x + dx, y: c.y, z: c.z + dz, left: c.left - 1 });
        }
      }
    }
    return filled;
  }
}
