// Сохранение мира. Сам мир восстанавливается из сида, храним только правки игрока.
// Мост хаба принимает значение до 64 КБ и только JSON (SDK.md), поэтому правки упакованы
// в байты, разложены по частям `edits.N` в base64, а `world` - короткий заголовок.

import { BLOCK_COUNT, DEFAULT_HOTBAR, isBlockId, type BlockId } from './blocks.ts';
import { CHUNK_VOLUME } from './gen.ts';
import { chunkKey } from './world.ts';

export const SAVE_VERSION = 1;
/** Сырых байт в одной части: в base64 это 60 000 символов, с запасом до лимита моста. */
export const PART_BYTES = 45_000;
/** Не больше частей: больше 1 МБ в хранилище хаба на одну игру не кладём. */
export const MAX_PARTS = 16;

export interface WorldMeta {
  v: number;
  seed: number;
  /** Время суток, 0-1. */
  time: number;
  /** x, y, z, yaw, pitch. */
  player: [number, number, number, number, number];
  flying: boolean;
  hotbar: BlockId[];
  slot: number;
  mined: number;
  parts: number;
  renderDistance: number;
  sound: boolean;
}

type Edits = Map<number, Map<number, BlockId>>;

/** Обратное к chunkKey: младшие 16 бит - cx со знаком, старшие - cz. */
function unpackKey(key: number): [number, number] {
  return [(key << 16) >> 16, key >> 16];
}

/**
 * Правки → байты. На чанк: cx, cz (int16), число правок (uint16), затем правки по 3 байта:
 * индекс в чанке (uint16, меньше 24 576) и id блока.
 */
export function encodeEdits(edits: Edits): Uint8Array {
  let size = 0;
  for (const m of edits.values()) if (m.size) size += 6 + m.size * 3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (const [key, m] of edits) {
    if (!m.size) continue;
    // Чанк с правками больше 65 535 невозможен: в чанке меньше блоков.
    const [cx, cz] = unpackKey(key);
    dv.setInt16(o, cx, true);
    dv.setInt16(o + 2, cz, true);
    dv.setUint16(o + 4, m.size, true);
    o += 6;
    for (const [i, id] of m) {
      dv.setUint16(o, i, true);
      out[o + 2] = id;
      o += 3;
    }
  }
  return out;
}

/** Байты → правки. Битые данные не роняют игру: всё, что не сходится, отбрасывается. */
export function decodeEdits(bytes: Uint8Array): Edits {
  const edits: Edits = new Map();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  while (o + 6 <= bytes.length) {
    const cx = dv.getInt16(o, true);
    const cz = dv.getInt16(o + 2, true);
    const n = dv.getUint16(o + 4, true);
    o += 6;
    if (o + n * 3 > bytes.length) break;
    const m = new Map<number, BlockId>();
    for (let k = 0; k < n; k++, o += 3) {
      const i = dv.getUint16(o, true);
      const id = bytes[o + 2]!;
      // Воздух (0) - тоже правка: блок сломан.
      if (i < CHUNK_VOLUME && id < BLOCK_COUNT) m.set(i, id);
    }
    if (m.size) edits.set(chunkKey(cx, cz), m);
  }
  return edits;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Разрезать на части для отдельных ключей. null - мир не влезает в MAX_PARTS. */
export function splitParts(bytes: Uint8Array): string[] | null {
  const parts: string[] = [];
  for (let o = 0; o < bytes.length; o += PART_BYTES) parts.push(toBase64(bytes.subarray(o, o + PART_BYTES)));
  return parts.length > MAX_PARTS ? null : parts;
}

/** Заголовок из сохранения - только то, что прошло проверку; остальное по умолчанию. */
export function parseMeta(raw: unknown): WorldMeta | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.v !== SAVE_VERSION || typeof m.seed !== 'number' || !Number.isInteger(m.seed)) return null;
  const num = (v: unknown, def: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  const p = Array.isArray(m.player) && m.player.length === 5 && m.player.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (m.player as WorldMeta['player'])
    : null;
  const hotbar = Array.isArray(m.hotbar) && m.hotbar.length === DEFAULT_HOTBAR.length && m.hotbar.every(isBlockId)
    ? (m.hotbar as BlockId[])
    : [...DEFAULT_HOTBAR];
  return {
    v: SAVE_VERSION,
    seed: m.seed >>> 0,
    time: num(m.time, 0.3, 0, 1),
    player: p ?? [NaN, NaN, NaN, 0, 0],
    flying: m.flying === true,
    hotbar,
    slot: Math.floor(num(m.slot, 0, 0, DEFAULT_HOTBAR.length - 1)),
    mined: Math.floor(num(m.mined, 0, 0, 1e9)),
    parts: Math.floor(num(m.parts, 0, 0, MAX_PARTS)),
    renderDistance: Math.floor(num(m.renderDistance, 0, 0, 12)),
    sound: m.sound !== false,
  };
}
