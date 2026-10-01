// Сетка чанка: только видимые грани, затенение углов (AO) и яркость по стороне света
// запекаются в цвет вершин. Свет в сцене не считается вовсе - это дёшево и на телефоне.

import { B, OPAQUE } from './blocks.ts';
import { ATLAS_COLS, ATLAS_ROWS } from './atlas.ts';
import { CHUNK, HEIGHT } from './gen.ts';
import { PAD_SIDE, padIdx } from './world.ts';

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  /** Яркость вершины, RGB 0-255. */
  colors: Uint8Array;
  indices: Uint32Array;
  minY: number;
  maxY: number;
}

export interface ChunkMesh {
  /** Непрозрачные блоки и вырезанные по альфе (листва, стекло). */
  solid: MeshData;
  water: MeshData;
}

const AO_LEVEL = [0.45, 0.64, 0.82, 1];
// Яркость граней: верх светлее всех, низ темнее - объём читается без источников света.
const FACE_LIGHT = [0.8, 0.8, 1, 0.55, 0.68, 0.68]; // +x -x +y -y +z -z
// Плитку чуть ужимаем внутрь: без этого на краях граней проступают соседние плитки атласа.
const INSET = 0.02 / 16;

class Builder {
  positions = new Float32Array(4096 * 12);
  uvs = new Float32Array(4096 * 8);
  colors = new Uint8Array(4096 * 12);
  indices = new Uint32Array(4096 * 6);
  faces = 0;
  minY = Infinity;
  maxY = -Infinity;

  reset(): void {
    this.faces = 0;
    this.minY = Infinity;
    this.maxY = -Infinity;
  }

  private grow(): void {
    const n = this.positions.length / 12;
    const g = <T extends Float32Array | Uint8Array | Uint32Array>(a: T, per: number): T => {
      const b = new (a.constructor as new (n: number) => T)(n * 2 * per);
      b.set(a);
      return b;
    };
    this.positions = g(this.positions, 12);
    this.uvs = g(this.uvs, 8);
    this.colors = g(this.colors, 12);
    this.indices = g(this.indices, 6);
  }

  /** Четыре вершины против часовой стрелки, если смотреть снаружи грани. */
  quad(p: number[], uv: number[], light: number[], flip: boolean): void {
    if ((this.faces + 1) * 12 > this.positions.length) this.grow();
    const f = this.faces;
    this.positions.set(p, f * 12);
    this.uvs.set(uv, f * 8);
    for (let k = 0; k < 4; k++) {
      const c = Math.round(light[k]! * 255);
      this.colors[f * 12 + k * 3] = c;
      this.colors[f * 12 + k * 3 + 1] = c;
      this.colors[f * 12 + k * 3 + 2] = c;
      const y = p[k * 3 + 1]!;
      if (y < this.minY) this.minY = y;
      if (y > this.maxY) this.maxY = y;
    }
    const v = f * 4;
    const i = f * 6;
    // Диагональ квадрата выбирается по затенению, иначе на углах видна "складка".
    if (flip) this.indices.set([v + 1, v + 2, v + 3, v + 1, v + 3, v], i);
    else this.indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i);
    this.faces++;
  }

  take(): MeshData {
    const f = this.faces;
    return {
      positions: this.positions.slice(0, f * 12),
      uvs: this.uvs.slice(0, f * 8),
      colors: this.colors.slice(0, f * 12),
      indices: this.indices.slice(0, f * 6),
      minY: f ? this.minY : 0,
      maxY: f ? this.maxY : 0,
    };
  }
}

const solidBuilder = new Builder();
const waterBuilder = new Builder();

// Шаги по осям в массиве с рамкой.
const STEP = [1, PAD_SIDE * PAD_SIDE, PAD_SIDE]; // x, y, z

/**
 * Построить сетку чанка. `pad` - блоки с рамкой (World.padded), `faceTiles` - плитки граней
 * (atlas.FACE_TILES). Координаты вершин - локальные, от 0 до 16.
 */
export function meshChunk(pad: Uint8Array, faceTiles: Uint8Array): ChunkMesh {
  solidBuilder.reset();
  waterBuilder.reset();
  const p = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const uv = [0, 0, 0, 0, 0, 0, 0, 0];
  const light = [0, 0, 0, 0];
  const ao = [0, 0, 0, 0];
  const pos = [0, 0, 0];
  const corner = [0, 0, 0];

  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const at = padIdx(x, y, z);
        const id = pad[at]!;
        if (id === B.AIR) continue;
        const water = id === B.WATER;
        const glass = id === B.GLASS;
        const waterTop = water && pad[at + STEP[1]!] !== B.WATER;
        pos[0] = x;
        pos[1] = y;
        pos[2] = z;
        for (let face = 0; face < 6; face++) {
          const a = face >> 1; // ось: 0 x, 1 y, 2 z
          const s = face & 1 ? -1 : 1;
          const n = at + s * STEP[a]!;
          const nid = pad[n]!;
          if (OPAQUE[nid]) continue;
          if (water && nid === B.WATER) continue;
          if (glass && nid === B.GLASS) continue;
          const ua = (a + 1) % 3;
          const va = (a + 2) % 3;
          const du = STEP[ua]!;
          const dv = STEP[va]!;
          const tile = faceTiles[id * 3 + (a === 1 ? (s > 0 ? 0 : 1) : 2)]!;
          const tu0 = (tile % ATLAS_COLS) / ATLAS_COLS + INSET;
          const tu1 = (tile % ATLAS_COLS + 1) / ATLAS_COLS - INSET;
          const tv1 = 1 - Math.floor(tile / ATLAS_COLS) / ATLAS_ROWS - INSET;
          const tv0 = 1 - (Math.floor(tile / ATLAS_COLS) + 1) / ATLAS_ROWS + INSET;
          for (let k = 0; k < 4; k++) {
            // Обход углов: при s = +1 (0,0) (1,0) (1,1) (0,1), при s = -1 - в обратную сторону.
            const cu = s > 0 ? (k === 1 || k === 2 ? 1 : 0) : k === 2 || k === 3 ? 1 : 0;
            const cv = s > 0 ? (k >= 2 ? 1 : 0) : k === 1 || k === 2 ? 1 : 0;
            corner[a] = pos[a]! + (s > 0 ? 1 : 0);
            corner[ua] = pos[ua]! + cu;
            corner[va] = pos[va]! + cv;
            if (waterTop && corner[1] === y + 1) corner[1] = y + 0.875;
            p[k * 3] = corner[0]!;
            p[k * 3 + 1] = corner[1]!;
            p[k * 3 + 2] = corner[2]!;
            // Текстура на боках стоит "вертикально": её v всегда вдоль y.
            const tu = a === 2 ? cu : cv;
            const tv = a === 2 ? cv : cu;
            uv[k * 2] = tu ? tu1 : tu0;
            uv[k * 2 + 1] = tv ? tv1 : tv0;
            if (water) {
              ao[k] = 3;
            } else {
              const su = cu ? du : -du;
              const sv = cv ? dv : -dv;
              const s1 = OPAQUE[pad[n + su]!]!;
              const s2 = OPAQUE[pad[n + sv]!]!;
              const c = OPAQUE[pad[n + su + sv]!]!;
              ao[k] = s1 && s2 ? 0 : 3 - s1 - s2 - c;
            }
            light[k] = FACE_LIGHT[face]! * AO_LEVEL[ao[k]!]!;
          }
          const flip = ao[0]! + ao[2]! < ao[1]! + ao[3]!;
          (water ? waterBuilder : solidBuilder).quad(p, uv, light, flip);
        }
      }
    }
  }
  return { solid: solidBuilder.take(), water: waterBuilder.take() };
}
