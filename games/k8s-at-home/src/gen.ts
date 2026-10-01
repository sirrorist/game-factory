// Генерация чанка из сида: рельеф, биомы, пещеры, руда, деревья и контейнеры.
// Чистая функция без DOM и Three: её можно гонять в тестах и в воркере.

import { B } from './blocks.ts';
import { fbm2, hash3, makeNoise, type Noise } from './noise.ts';

export const CHUNK = 16;
export const HEIGHT = 96;
export const SEA = 30;
export const CHUNK_VOLUME = CHUNK * CHUNK * HEIGHT;

/** Индекс блока в чанке: x быстрее всех, потом z, потом y - так соседи по x рядом в памяти. */
export function idx(x: number, y: number, z: number): number {
  return x + (z << 4) + (y << 8);
}

export type Biome = 'ocean' | 'beach' | 'plains' | 'forest' | 'desert' | 'mountain' | 'tundra' | 'peaks';

export const BIOME_NAMES: Record<Biome, string> = {
  ocean: 'океан', beach: 'пляж', plains: 'равнина', forest: 'лес', desert: 'пустыня',
  mountain: 'горы', tundra: 'тундра', peaks: 'снежные пики',
};

export interface Column {
  /** y верхнего твёрдого блока. */
  height: number;
  biome: Biome;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Шаг сетки шума пещер: трёхмерный шум дорог, считаем его в узлах и интерполируем.
const CAVE_STEP = 4;
const CAVE_NX = CHUNK / CAVE_STEP + 1;
const CAVE_NY = HEIGHT / CAVE_STEP + 1;

export class Generator {
  readonly seed: number;
  private readonly terrain: Noise;
  private readonly climate: Noise;
  private readonly caves: Noise;
  private readonly caveA = new Float32Array(CAVE_NX * CAVE_NX * CAVE_NY);
  private readonly caveB = new Float32Array(CAVE_NX * CAVE_NX * CAVE_NY);

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.terrain = makeNoise(this.seed);
    this.climate = makeNoise(this.seed ^ 0x5bd1e995);
    this.caves = makeNoise(this.seed ^ 0x1b873593);
  }

  column(wx: number, wz: number): Column {
    const cont = fbm2(this.terrain, wx / 320, wz / 320, 3);
    const detail = fbm2(this.terrain, wx / 64 + 100, wz / 64 + 100, 3);
    const ridge = 1 - Math.abs(fbm2(this.climate, wx / 220 - 700, wz / 220 + 300, 2));
    const mountain = smoothstep(0.62, 0.95, ridge) * smoothstep(-0.15, 0.35, cont);
    let h = SEA + 3 + cont * 12 + detail * 5 + mountain * 40;
    if (cont < -0.3) h += (cont + 0.3) * 24; // океанские впадины
    const height = Math.max(4, Math.min(HEIGHT - 12, Math.floor(h)));

    const temp = fbm2(this.climate, wx / 500, wz / 500, 2);
    const moist = fbm2(this.climate, wx / 400 + 500, wz / 400 - 300, 2);
    let biome: Biome;
    if (height < SEA) biome = 'ocean';
    else if (height <= SEA + 1) biome = temp < -0.45 ? 'tundra' : 'beach';
    else if (height > SEA + 34) biome = 'peaks';
    else if (mountain > 0.35 && height > SEA + 20) biome = 'mountain';
    else if (temp < -0.4) biome = 'tundra';
    else if (temp > 0.28 && moist < 0.1) biome = 'desert';
    else if (moist > 0.12) biome = 'forest';
    else biome = 'plains';
    return { height, biome };
  }

  /** Блоки чанка (cx, cz) без правок игрока. */
  generate(cx: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const seed = this.seed;

    // Колонки с запасом 2 блока вокруг: деревья у края соседнего чанка свешиваются в этот.
    const PAD = 2;
    const SIDE = CHUNK + PAD * 2;
    const cols: Column[] = new Array(SIDE * SIDE);
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) cols[x + z * SIDE] = this.column(x0 + x - PAD, z0 + z - PAD);
    }
    const col = (x: number, z: number): Column => cols[x + PAD + (z + PAD) * SIDE]!;

    this.sampleCaves(x0, z0);

    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const { height: h, biome } = col(x, z);
        const wx = x0 + x;
        const wz = z0 + z;
        let top: number;
        let filler: number;
        switch (biome) {
          case 'ocean': {
            const gravel = hash3(seed, wx >> 3, 1, wz >> 3) < 0.3;
            top = gravel ? B.GRAVEL : B.SAND;
            filler = gravel ? B.GRAVEL : B.SAND;
            break;
          }
          case 'beach':
          case 'desert':
            top = B.SAND;
            filler = B.SAND;
            break;
          case 'mountain':
            top = hash3(seed, wx, 2, wz) < 0.35 ? B.GRASS : B.STONE;
            filler = B.STONE;
            break;
          case 'peaks':
            top = B.SNOW;
            filler = B.STONE;
            break;
          case 'tundra':
            top = B.SNOWY_GRASS;
            filler = B.DIRT;
            break;
          default:
            top = B.GRASS;
            filler = B.DIRT;
        }
        // Пещеры у воды не режем у самой поверхности: вода в мире стоячая и висела бы стеной.
        const caveTop = h <= SEA + 2 ? h - 4 : h;
        for (let y = 0; y <= h; y++) {
          let id: number;
          if (y === 0 || (y === 1 && hash3(seed, wx, y, wz) < 0.5)) id = B.BEDROCK;
          else if (y === h) id = top;
          else if (y > h - 4) id = filler;
          else id = hash3(seed, wx, y, wz) < 0.012 && y < 64 ? B.COAL : B.STONE;
          if (id !== B.BEDROCK && y <= caveTop && y > 1 && this.isCave(x, y, z)) id = B.AIR;
          blocks[idx(x, y, z)] = id;
        }
        for (let y = h + 1; y <= SEA; y++) blocks[idx(x, y, z)] = B.WATER;
      }
    }

    this.decorate(blocks, x0, z0, PAD, col);
    return blocks;
  }

  private sampleCaves(x0: number, z0: number): void {
    for (let y = 0; y < CAVE_NY; y++) {
      for (let z = 0; z < CAVE_NX; z++) {
        for (let x = 0; x < CAVE_NX; x++) {
          const wx = x0 + x * CAVE_STEP;
          const wy = y * CAVE_STEP;
          const wz = z0 + z * CAVE_STEP;
          const i = x + z * CAVE_NX + y * CAVE_NX * CAVE_NX;
          this.caveA[i] = this.caves.n3(wx / 28, wy / 18, wz / 28);
          this.caveB[i] = this.caves.n3(wx / 28 + 91.7, wy / 18 - 13.1, wz / 28 + 47.3);
        }
      }
    }
  }

  /** Спагетти-пещеры: туннель там, где оба шума близки к нулю. */
  private isCave(x: number, y: number, z: number): boolean {
    const fx = x / CAVE_STEP, fy = y / CAVE_STEP, fz = z / CAVE_STEP;
    const ix = Math.min(CAVE_NX - 2, Math.floor(fx));
    const iy = Math.min(CAVE_NY - 2, Math.floor(fy));
    const iz = Math.min(CAVE_NX - 2, Math.floor(fz));
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const a = trilinear(this.caveA, ix, iy, iz, tx, ty, tz);
    const b = trilinear(this.caveB, ix, iy, iz, tx, ty, tz);
    // Глубже - шире: у поверхности редкие узкие ходы, внизу - просторнее.
    const width = 0.012 + (y < 24 ? (24 - y) * 0.0012 : 0);
    return a * a + b * b < width;
  }

  private decorate(blocks: Uint8Array, x0: number, z0: number, pad: number, col: (x: number, z: number) => Column): void {
    const seed = this.seed;
    const put = (x: number, y: number, z: number, id: number, over: number[]): void => {
      if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || y < 0 || y >= HEIGHT) return;
      const i = idx(x, y, z);
      if (over.includes(blocks[i]!)) blocks[i] = id;
    };
    for (let z = -pad; z < CHUNK + pad; z++) {
      for (let x = -pad; x < CHUNK + pad; x++) {
        const { height: h, biome } = col(x, z);
        const wx = x0 + x;
        const wz = z0 + z;
        if (h <= SEA || h > HEIGHT - 10) continue;
        const chance = biome === 'forest' ? 0.045 : biome === 'plains' ? 0.007 : biome === 'tundra' ? 0.012 : 0;
        if (hash3(seed, wx, 7, wz) < chance) {
          const trunk = 4 + Math.floor(hash3(seed, wx, 8, wz) * 3);
          const topY = h + trunk;
          for (let y = topY - 2; y <= topY + 1; y++) {
            const r = y >= topY ? 1 : 2;
            for (let dz = -r; dz <= r; dz++) {
              for (let dx = -r; dx <= r; dx++) {
                const corner = Math.abs(dx) === r && Math.abs(dz) === r;
                // Углы листвы срезаем через раз - крона не выглядит кубом.
                if (corner && (y === topY + 1 || hash3(seed, wx + dx, y, wz + dz) < 0.5)) continue;
                put(x + dx, y, z + dz, B.LEAVES, [B.AIR]);
              }
            }
          }
          for (let y = h + 1; y <= topY; y++) put(x, y, z, B.LOG, [B.AIR, B.LEAVES]);
          continue;
        }
        // Пасхалка: редкие стопки контейнеров на равнинах, сверху иногда сервер.
        if (biome === 'plains' && hash3(seed, wx, 13, wz) < 0.0012) {
          const n = 1 + Math.floor(hash3(seed, wx, 14, wz) * 3);
          for (let k = 1; k <= n; k++) {
            const id = k === n && hash3(seed, wx, 15, wz) < 0.4 ? B.SERVER : B.CONTAINER;
            put(x, h + k, z, id, [B.AIR, B.LEAVES]);
          }
        }
      }
    }
  }
}

function trilinear(g: Float32Array, ix: number, iy: number, iz: number, tx: number, ty: number, tz: number): number {
  const sx = 1, sz = CAVE_NX, sy = CAVE_NX * CAVE_NX;
  const i = ix * sx + iz * sz + iy * sy;
  const c000 = g[i]!, c100 = g[i + sx]!, c010 = g[i + sy]!, c110 = g[i + sx + sy]!;
  const c001 = g[i + sz]!, c101 = g[i + sx + sz]!, c011 = g[i + sy + sz]!, c111 = g[i + sx + sy + sz]!;
  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}
