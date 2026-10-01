// Мир: загруженные чанки и правки игрока. Правки живут отдельно от чанков: чанк можно
// выгрузить и сгенерировать заново из сида, правки лягут поверх и попадут в сохранение.

import { B, type BlockId } from './blocks.ts';
import { CHUNK, CHUNK_VOLUME, Generator, HEIGHT, idx } from './gen.ts';

export interface Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  /** Сетку надо перестроить: правка в нём или у соседа на границе. */
  dirty: boolean;
}

/** Ключ чанка - одно целое: координаты в пределах ±32768 чанков не пересекаются. */
export function chunkKey(cx: number, cz: number): number {
  return (cx & 0xffff) | ((cz & 0xffff) << 16);
}

/**
 * Нужна ли сетка чанку в (dx, dz) чанках от игрока при дальности rd. Строится она в круге
 * rd + 0.5 (`stream`), снимается за rd + 1.5: запас в чанк - чтобы на границе сетка не
 * пересобиралась на каждом шаге. Без этого снятия сетки после уменьшения дальности жили до
 * выгрузки чанка (квадрат rd + 2) и рисовались под туманом - кадр не дешевел.
 */
export function meshInRange(dx: number, dz: number, rd: number): boolean {
  return dx * dx + dz * dz <= (rd + 1.5) ** 2;
}

/** Рисовать ли сетку: только в круге построения. Сетки запаса (до rd + 1.5) ждут скрытыми. */
export function meshVisible(dx: number, dz: number, rd: number): boolean {
  return dx * dx + dz * dz <= (rd + 0.5) ** 2;
}

export const PAD_SIDE = CHUNK + 2;
export const PAD_HEIGHT = HEIGHT + 2;
export const PAD_VOLUME = PAD_SIDE * PAD_SIDE * PAD_HEIGHT;

/** Индекс в массиве чанка с рамкой в 1 блок: x, z от -1 до 16, y от -1 до HEIGHT. */
export function padIdx(x: number, y: number, z: number): number {
  return x + 1 + (z + 1) * PAD_SIDE + (y + 1) * PAD_SIDE * PAD_SIDE;
}

export class World {
  readonly gen: Generator;
  readonly chunks = new Map<number, Chunk>();
  /** Правки по чанкам: индекс блока в чанке → id. */
  readonly edits = new Map<number, Map<number, BlockId>>();

  constructor(seed: number) {
    this.gen = new Generator(seed);
  }

  get seed(): number {
    return this.gen.seed;
  }

  chunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Сгенерировать чанк и наложить правки. Уже загруженный возвращается как есть. */
  load(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    const have = this.chunks.get(key);
    if (have) return have;
    const blocks = this.gen.generate(cx, cz);
    const edits = this.edits.get(key);
    if (edits) for (const [i, id] of edits) blocks[i] = id;
    const chunk: Chunk = { cx, cz, blocks, dirty: true };
    this.chunks.set(key, chunk);
    return chunk;
  }

  unload(cx: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cz));
  }

  /** Блок мира. Незагруженный чанк - воздух: физика игрока в нём не считается (main.ts). */
  get(x: number, y: number, z: number): BlockId {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return c ? c.blocks[idx(x & 15, y, z & 15)]! : B.AIR;
  }

  /** Поставить блок. false - вне мира или чанк не загружен. */
  set(x: number, y: number, z: number, id: BlockId): boolean {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    if (!c) return false;
    const lx = x & 15;
    const lz = z & 15;
    const i = idx(lx, y, lz);
    c.blocks[i] = id;
    c.dirty = true;
    let edits = this.edits.get(key);
    if (!edits) this.edits.set(key, (edits = new Map()));
    edits.set(i, id);
    // Сосед видит этот блок в своей рамке (грани и затенение углов) - его сетку тоже перестроить.
    const dx = lx === 0 ? -1 : lx === CHUNK - 1 ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === CHUNK - 1 ? 1 : 0;
    if (dx) this.markDirty(cx + dx, cz);
    if (dz) this.markDirty(cx, cz + dz);
    if (dx && dz) this.markDirty(cx + dx, cz + dz);
    return true;
  }

  private markDirty(cx: number, cz: number): void {
    const c = this.chunk(cx, cz);
    if (c) c.dirty = true;
  }

  /** Все 8 соседей загружены - чанк можно мешить без дыр по краям. */
  hasNeighbors(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dz) && !this.chunks.has(chunkKey(cx + dx, cz + dz))) return false;
      }
    }
    return true;
  }

  /** Чанк с рамкой из соседей - вход мешинга. Снизу рамки - коренная порода, сверху - воздух. */
  padded(cx: number, cz: number, out: Uint8Array): void {
    out.fill(B.AIR);
    for (let z = -1; z <= CHUNK; z++) {
      for (let x = -1; x <= CHUNK; x++) out[padIdx(x, -1, z)] = B.BEDROCK;
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunk(cx + dx, cz + dz);
        if (!c) continue;
        // Из соседа берём только полосу шириной в блок, которая попадает в рамку.
        const xs = dx < 0 ? CHUNK - 1 : 0, xe = dx > 0 ? 0 : CHUNK - 1;
        const zs = dz < 0 ? CHUNK - 1 : 0, ze = dz > 0 ? 0 : CHUNK - 1;
        const ox = dx * CHUNK, oz = dz * CHUNK;
        for (let y = 0; y < HEIGHT; y++) {
          for (let z = zs; z <= ze; z++) {
            const src = (z << 4) + (y << 8);
            const dst = padIdx(0, y, z + oz);
            for (let x = xs; x <= xe; x++) out[dst + x + ox] = c.blocks[src + x]!;
          }
        }
      }
    }
  }
}

export { CHUNK, CHUNK_VOLUME, HEIGHT };
