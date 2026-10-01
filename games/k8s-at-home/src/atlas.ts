// Текстуры рисуются кодом в один атлас: в офлайн-архиве нет fetch за картинками (П-002, П-019),
// а плитки 16×16 в пиксель-арте и так дешевле нарисовать, чем встроить.

import { BLOCKS, type BlockId } from './blocks.ts';
import { rng } from './noise.ts';

export const TILE = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;

export const TILE_NAMES = [
  'stone', 'dirt', 'grass_top', 'grass_side', 'sand', 'log_side', 'log_top', 'leaves',
  'planks', 'cobble', 'glass', 'water', 'snow', 'coal', 'brick', 'gravel',
  'bedrock', 'container_side', 'container_top', 'server_front', 'server_top', 'snowy_side',
] as const;

export function tileIndex(name: string): number {
  const i = (TILE_NAMES as readonly string[]).indexOf(name);
  if (i < 0) throw new Error(`нет плитки ${name}`);
  return i;
}

/** Плитки граней блока: [верх, низ, бок] на каждый id - таблица для мешинга. */
export const FACE_TILES: Uint8Array = (() => {
  const t = new Uint8Array(BLOCKS.length * 3);
  BLOCKS.forEach((b, id) => {
    t[id * 3] = tileIndex(b.top);
    t[id * 3 + 1] = tileIndex(b.bottom);
    t[id * 3 + 2] = tileIndex(b.side);
  });
  return t;
})();

type RGB = [number, number, number];

function hex(c: number): RGB {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function shade(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

class Tile {
  readonly px = new Uint8ClampedArray(TILE * TILE * 4);
  readonly rand: () => number;
  constructor(seed: number) {
    this.rand = rng(seed);
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (y * TILE + x) * 4;
    return [this.px[i]!, this.px[i + 1]!, this.px[i + 2]!];
  }
  /** Заливка с разбросом яркости: основа почти любой плитки. */
  noise(base: number, spread: number): this {
    const c = hex(base);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) this.set(x, y, shade(c, 1 + (this.rand() - 0.5) * spread));
    }
    return this;
  }
  specks(color: number, chance: number, spread = 0.15): this {
    const c = hex(color);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (this.rand() < chance) this.set(x, y, shade(c, 1 + (this.rand() - 0.5) * spread));
      }
    }
    return this;
  }
}

function drawTile(name: (typeof TILE_NAMES)[number], seed: number): Tile {
  const t = new Tile(seed);
  switch (name) {
    case 'stone':
      return t.noise(0x7f7f7f, 0.18).specks(0x6a6a6a, 0.12);
    case 'dirt':
      return t.noise(0x86603f, 0.22).specks(0x6b4a2f, 0.15).specks(0x9a7550, 0.06);
    case 'grass_top':
      return t.noise(0x5f9f3a, 0.25).specks(0x4d8a2e, 0.18).specks(0x76b84a, 0.08);
    case 'grass_side':
    case 'snowy_side': {
      t.noise(0x86603f, 0.22).specks(0x6b4a2f, 0.15);
      const top = name === 'grass_side' ? 0x5f9f3a : 0xf2f6fa;
      for (let x = 0; x < TILE; x++) {
        const depth = 3 + Math.floor(t.rand() * 3);
        for (let y = 0; y < depth; y++) t.set(x, y, shade(hex(top), 1 + (t.rand() - 0.5) * 0.2));
      }
      return t;
    }
    case 'sand':
      return t.noise(0xdccf8f, 0.1).specks(0xc9b97a, 0.12);
    case 'gravel': {
      t.noise(0x857f7b, 0.2);
      for (let k = 0; k < 14; k++) {
        const cx = Math.floor(t.rand() * TILE), cy = Math.floor(t.rand() * TILE);
        const c = shade(hex(t.rand() < 0.5 ? 0x9a9390 : 0x6c6560), 1 + (t.rand() - 0.5) * 0.2);
        t.set(cx, cy, c);
        t.set(cx + 1, cy, c);
        t.set(cx, cy + 1, c);
      }
      return t;
    }
    case 'log_side': {
      t.noise(0x6b4f2c, 0.15);
      for (let x = 0; x < TILE; x++) {
        if (t.rand() < 0.35) for (let y = 0; y < TILE; y++) if (t.rand() < 0.85) t.set(x, y, shade(hex(0x523a1f), 1 + (t.rand() - 0.5) * 0.15));
      }
      return t;
    }
    case 'log_top': {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          const c = d > 6.5 ? 0x6b4f2c : Math.floor(d) % 2 === 0 ? 0xb8915a : 0xa07a46;
          t.set(x, y, shade(hex(c), 1 + (t.rand() - 0.5) * 0.12));
        }
      }
      return t;
    }
    case 'leaves': {
      t.noise(0x3d7a28, 0.35).specks(0x2f6420, 0.2);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (t.rand() < 0.22) t.set(x, y, [0, 0, 0], 0);
      return t;
    }
    case 'planks': {
      t.noise(0xb38f58, 0.1);
      for (let y = 0; y < TILE; y++) {
        const row = y >> 2;
        if (y % 4 === 3) for (let x = 0; x < TILE; x++) t.set(x, y, hex(0x7a5c34));
        const seam = (row * 7 + 3) % TILE;
        if (y % 4 !== 3) t.set(seam, y, hex(0x7a5c34));
        if (t.rand() < 0.4) t.set(Math.floor(t.rand() * TILE), y, hex(0x9c7a48));
      }
      return t;
    }
    case 'cobble': {
      t.noise(0x5c5c5c, 0.1);
      // Камни - пятна вокруг случайных центров, швы между ними тёмные.
      const centers: [number, number, number][] = [];
      for (let k = 0; k < 9; k++) centers.push([t.rand() * TILE, t.rand() * TILE, 0.8 + t.rand() * 0.45]);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          let best = Infinity, second = Infinity, k = 1;
          for (const [cx, cy, kk] of centers) {
            const dx = Math.min(Math.abs(x - cx), TILE - Math.abs(x - cx));
            const dy = Math.min(Math.abs(y - cy), TILE - Math.abs(y - cy));
            const d = dx * dx + dy * dy;
            if (d < best) { second = best; best = d; k = kk; }
            else if (d < second) second = d;
          }
          if (Math.sqrt(second) - Math.sqrt(best) > 1.1) t.set(x, y, shade(hex(0x8a8a8a), k * (1 + (t.rand() - 0.5) * 0.12)));
        }
      }
      return t;
    }
    case 'glass': {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
          if (edge) t.set(x, y, hex(0xdbeef5));
          else t.set(x, y, [0, 0, 0], 0);
        }
      }
      for (let k = 0; k < 4; k++) t.set(3 + k, 6 - k, hex(0xffffff));
      for (let k = 0; k < 2; k++) t.set(9 + k, 12 - k, hex(0xffffff));
      return t;
    }
    case 'water':
      return t.noise(0x3a6ed4, 0.12).specks(0x5287e8, 0.1);
    case 'snow':
      return t.noise(0xf2f6fa, 0.06).specks(0xdfe8f0, 0.1);
    case 'coal': {
      t.noise(0x7f7f7f, 0.18).specks(0x6a6a6a, 0.12);
      for (let k = 0; k < 5; k++) {
        const cx = 2 + Math.floor(t.rand() * 12), cy = 2 + Math.floor(t.rand() * 12);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0]] as const) {
          if (t.rand() < 0.85) t.set(cx + dx, cy + dy, shade(hex(0x222222), 1 + t.rand() * 0.4));
        }
      }
      return t;
    }
    case 'brick': {
      t.noise(0xa04b33, 0.12);
      for (let y = 0; y < TILE; y++) {
        const row = y >> 2;
        for (let x = 0; x < TILE; x++) {
          const off = row % 2 === 0 ? 0 : 4;
          if (y % 4 === 3 || (x + off) % 8 === 7) t.set(x, y, shade(hex(0xb5aea4), 1 + (t.rand() - 0.5) * 0.1));
        }
      }
      return t;
    }
    case 'bedrock':
      return t.noise(0x4a4a4a, 0.6).specks(0x222222, 0.25);
    case 'container_side': {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const rib = x % 3 === 0 ? 0x24589a : x % 3 === 1 ? 0x3478c4 : 0x2f6bb2;
          const frame = y === 0 || y === TILE - 1 || x === 0 || x === TILE - 1;
          t.set(x, y, shade(hex(frame ? 0x1d4373 : rib), 1 + (t.rand() - 0.5) * 0.06));
        }
      }
      // Маркировка: белая полоска - "надпись" на контейнере.
      for (let x = 4; x < 12; x++) t.set(x, 3, hex(0xe6edf3));
      return t;
    }
    case 'container_top': {
      t.noise(0x2f6bb2, 0.08);
      for (let k = 0; k < TILE; k++) {
        t.set(k, 0, hex(0x1d4373));
        t.set(k, TILE - 1, hex(0x1d4373));
        t.set(0, k, hex(0x1d4373));
        t.set(TILE - 1, k, hex(0x1d4373));
      }
      return t;
    }
    case 'server_front': {
      t.noise(0x2b2e34, 0.08);
      const leds = [0x3fb950, 0x58a6ff, 0xd29922, 0x3fb950];
      for (let u = 0; u < 4; u++) {
        const y0 = u * 4;
        for (let x = 0; x < TILE; x++) t.set(x, y0, hex(0x1b1d21));
        for (let x = 2; x < 9; x++) t.set(x, y0 + 2, hex(0x3b3f47));
        t.set(11, y0 + 2, hex(leds[u]!));
        if (t.rand() < 0.7) t.set(13, y0 + 2, hex(leds[(u + 1) % 4]!));
      }
      return t;
    }
    case 'server_top': {
      t.noise(0x2b2e34, 0.08);
      for (let y = 2; y < TILE - 2; y += 2) for (let x = 2; x < TILE - 2; x += 2) t.set(x, y, hex(0x15171a));
      return t;
    }
  }
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  /** Отдельные плитки - для иконок блоков. */
  tiles: HTMLCanvasElement[];
}

export function buildAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE;
  canvas.height = ATLAS_ROWS * TILE;
  const ctx = canvas.getContext('2d')!;
  const tiles: HTMLCanvasElement[] = [];
  TILE_NAMES.forEach((name, i) => {
    const tile = drawTile(name, 1000 + i * 7919);
    const img = new ImageData(tile.px, TILE, TILE);
    ctx.putImageData(img, (i % ATLAS_COLS) * TILE, Math.floor(i / ATLAS_COLS) * TILE);
    const one = document.createElement('canvas');
    one.width = TILE;
    one.height = TILE;
    one.getContext('2d')!.putImageData(img, 0, 0);
    tiles.push(one);
  });
  return { canvas, tiles };
}

/** Иконка блока в изометрии: верх и две боковые грани с разной яркостью. Canvas в DOM не попадает. */
export function blockIcon(atlas: Atlas, id: BlockId, size = 48): string {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const top = atlas.tiles[FACE_TILES[id * 3]!]!;
  const side = atlas.tiles[FACE_TILES[id * 3 + 2]!]!;
  const s = size / 2 / TILE; // половина ширины иконки на плитку
  const h = size / 4;
  // Верх: ромб.
  ctx.setTransform(s, s / 2, -s, s / 2, size / 2, 0);
  ctx.drawImage(top, 0, 0);
  // Левая грань.
  ctx.setTransform(s, s / 2, 0, s, 0, h);
  ctx.drawImage(side, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Затемняем только нарисованные пиксели: у стекла и листвы дыры должны остаться дырами.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(size / 2, h * 2);
  ctx.lineTo(size / 2, size);
  ctx.lineTo(0, h * 3);
  ctx.fill();
  // Правая грань.
  ctx.setTransform(s, -s / 2, 0, s, size / 2, h * 2);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(side, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.moveTo(size / 2, h * 2);
  ctx.lineTo(size, h);
  ctx.lineTo(size, h * 3);
  ctx.lineTo(size / 2, size);
  ctx.fill();
  return c.toDataURL();
}
