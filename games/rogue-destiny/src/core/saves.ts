/** Сохранение проверяется до создания сцены: повреждённый JSON не попадает в правила. */
import { validRunId } from './run-results.ts';
import type { SteamState } from './cooling.ts';
import { parseCodex, type CodexEntry } from './codex.ts';
import { createInventory, placeItem } from './inventory.ts';
import type { InventoryItem } from './types.ts';

export interface SavedWorld {
  player: { x: number; z: number; yaw: number; pitch: number };
  rooms: { id: string; revealed: boolean; visited: boolean; unlocked?: boolean; relicTaken?: boolean; devastated?: boolean }[];
  activeRoomId: string;
  oracle?: 'waiting' | 'won' | 'lost';
  steam?: SteamState;
  healing?: { remaining: number; amount: number; fatigueAmount?: number };
  drops?: { item: InventoryItem; x: number; z: number }[];
  enemies: { id: string; hp: number; x: number; z: number; stealthAvailable: boolean; effects?: { poison: number; slow: number; damageBuffer: number } }[];
  mimics: { roomId: string; opened: boolean; awakened: boolean }[];
}
export interface SavedRunProgress {
  floor: number;
  seed?: number;
  runId?: string;
  hp: number;
  greyHp: number;
  threadsOfFate: number;
  score: number;
  injuriesCount: number;
  elitesDefeated: number;
  lightSupply: number;
  aetherHeat: number;
  fatigue: number;
  temporaryMana?: number;
  aetherCore?: number;
  muddied?: { x: number; y: number }[];
  inventoryItems: InventoryItem[];
  quickSlots: (string | null)[];
  world?: SavedWorld;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 120;

function validItem(v: unknown): v is InventoryItem {
  if (!record(v) || !text(v.id) || !/^[a-zA-Z0-9_-]+$/.test(v.id) || !text(v.name) || !number(v.weight, 0, 100)) return false;
  if (!['weapon', 'shield', 'rune', 'potion', 'scroll', 'relic', 'tool', 'curse'].includes(String(v.category))) return false;
  if (!['physical', 'fire', 'ice', 'poison', 'aether'].includes(String(v.element))) return false;
  if (!['common', 'rare', 'holy', 'infernal'].includes(String(v.rarity))) return false;
  if (v.parryType !== undefined && !['siphon','reflect','both'].includes(String(v.parryType))) return false;
  if (v.relicEffect !== undefined && !['lens','chain','thread'].includes(String(v.relicEffect))) return false;
  if (v.isSevered !== undefined && typeof v.isSevered !== 'boolean') return false;
  if (v.utility !== undefined && !['breathing', 'grapple', 'cipher', 'light'].includes(String(v.utility))) return false;
  if (![0, 90, 180, 270].includes(v.rotation as number)) return false;
  if (!Number.isInteger(v.gridX) || !Number.isInteger(v.gridY)) return false;
  if (!Array.isArray(v.shape) || !v.shape.length || v.shape.length > 20) return false;
  const cells = new Set<string>();
  for (const c of v.shape) {
    if (!record(c) || !number(c.x, 0, 4) || !number(c.y, 0, 4) || !Number.isInteger(c.x) || !Number.isInteger(c.y)) return false;
    const key = `${c.x},${c.y}`;
    if (cells.has(key)) return false;
    cells.add(key);
  }
  for (const key of ['damage', 'defense', 'heatCost', 'fatigueCost', 'healAmount', 'durability', 'maxDurability']) {
    if (v[key] !== undefined && !number(v[key], 0, 10000)) return false;
  }
  if (v.fatigueRestore !== undefined && !number(v.fatigueRestore,0,100)) return false;
  if (v.burnTime !== undefined && !number(v.burnTime,0,8)) return false;
  if (v.poisonTime !== undefined && !number(v.poisonTime,0,6)) return false;
  return v.isSpoiled === undefined || typeof v.isSpoiled === 'boolean';
}
function validWorld(w: unknown): w is SavedWorld {
  if (!record(w) || !record(w.player) || !text(w.activeRoomId)) return false;
  if (!number(w.player.x, -10000, 10000) || !number(w.player.z, -10000, 10000) || !number(w.player.yaw, -1e9, 1e9) || !number(w.player.pitch, -0.45, 0.65)) return false;
  if (!Array.isArray(w.rooms) || w.rooms.length > 100 || !w.rooms.every((r: unknown) => record(r) && text(r.id) && typeof r.revealed === 'boolean' && typeof r.visited === 'boolean' && (r.unlocked === undefined || typeof r.unlocked === 'boolean') && (r.relicTaken === undefined || typeof r.relicTaken === 'boolean') && (r.devastated === undefined || typeof r.devastated === 'boolean'))) return false;
  if (!Array.isArray(w.enemies) || w.enemies.length > 100 || !w.enemies.every((e: unknown) => record(e) && text(e.id) && number(e.hp, 0, 10000) && number(e.x, -10000, 10000) && number(e.z, -10000, 10000) && typeof e.stealthAvailable === 'boolean' && (e.effects === undefined || record(e.effects) && number(e.effects.poison, 0, 4) && number(e.effects.slow, 0, 3.5) && number(e.effects.damageBuffer, -1e-6, 1)))) return false;
  if (w.steam !== undefined && (!record(w.steam) || !number(w.steam.remaining,0,4) || !number(w.steam.damageBuffer,0,1) || !number(w.steam.x,-10000,10000) || !number(w.steam.z,-10000,10000))) return false;
  if (w.healing !== undefined && (!record(w.healing) || !number(w.healing.remaining, 0, 3) || !number(w.healing.amount, 0, 10000) || w.healing.fatigueAmount !== undefined && !number(w.healing.fatigueAmount,0,100))) return false;
  if (w.oracle !== undefined && !['waiting', 'won', 'lost'].includes(String(w.oracle))) return false;
  if (w.drops !== undefined && (!Array.isArray(w.drops) || w.drops.length > 100 || !w.drops.every((drop: unknown) => record(drop) && record(drop.item) && validItem({ ...drop.item, gridX: 0, gridY: 0 }) && number(drop.x, -10000, 10000) && number(drop.z, -10000, 10000)))) return false;
  return Array.isArray(w.mimics) && w.mimics.length <= 100 && w.mimics.every((m: unknown) => record(m) && text(m.roomId) && typeof m.opened === 'boolean' && typeof m.awakened === 'boolean');
}
export function parseSavedRun(value: unknown): SavedRunProgress | null {
  if (!record(value) || !number(value.floor, 1, 999) || !Number.isInteger(value.floor)) return null;
  if (value.runId !== undefined && !validRunId(value.runId)) return null;
  if (value.seed !== undefined && (!number(value.seed, 0, 4294967295) || !Number.isInteger(value.seed))) return null;
  for (const key of ['hp', 'greyHp', 'lightSupply', 'aetherHeat', 'fatigue']) if (!number(value[key], 0, 100)) return null;
  if (value.muddied !== undefined && (!Array.isArray(value.muddied) || value.muddied.length > 20 || !value.muddied.every((c: unknown) => record(c) && number(c.x, 0, 4) && number(c.y, 0, 3) && Number.isInteger(c.x) && Number.isInteger(c.y)))) return null;
  if (value.aetherCore !== undefined && !number(value.aetherCore, 0, 100)) return null;
  if (value.temporaryMana !== undefined && !number(value.temporaryMana, 0, 100)) return null;
  if (!number(value.hp, 1, 100) || !number(value.greyHp, 0, 99) || value.hp > 100 - value.greyHp) return null;
  if (!number(value.threadsOfFate, 0, 3) || !Number.isInteger(value.threadsOfFate)) return null;
  for (const key of ['score', 'injuriesCount', 'elitesDefeated']) if (!number(value[key], 0, 1e9) || !Number.isInteger(value[key])) return null;
  if (!Array.isArray(value.inventoryItems) || value.inventoryItems.length > 20) return null;
  const inv = createInventory(5, 4);
  for (const item of value.inventoryItems) {
    if (!validItem(item) || inv.items.has(item.id)) return null;
    const copy = { ...item, gridX: undefined, gridY: undefined };
    if (!placeItem(inv, copy, item.gridX!, item.gridY!)) return null;
  }
  if (!Array.isArray(value.quickSlots) || value.quickSlots.length !== 4 || !value.quickSlots.every((id) => id === null || typeof id === 'string' && inv.items.has(id))) return null;
  if (value.world !== undefined && !validWorld(value.world)) return null;
  if (value.world !== undefined) {
    const ids = new Set(inv.items.keys());
    for (const drop of (value.world as SavedWorld).drops ?? []) {
      if (ids.has(drop.item.id)) return null;
      ids.add(drop.item.id);
    }
  }
  return value as unknown as SavedRunProgress;
}

export interface MetaProgress { highScore: number; totalRuns: number; victories: number; highestFloor: number; totalElites: number; codex: CodexEntry[]; completedRunIds?: string[] }
export function parseMetaProgress(value: unknown): MetaProgress {
  const source = record(value) ? value : {};
  const count = (key: string, fallback = 0): number => number(source[key], 0, 1e9) && Number.isInteger(source[key]) ? source[key] as number : fallback;
  return { highScore: count('highScore'), totalRuns: count('totalRuns'), victories: count('victories'), highestFloor: Math.max(1, count('highestFloor', 1)), totalElites: count('totalElites'), codex: parseCodex(source.codex), ...(Array.isArray(source.completedRunIds)?{completedRunIds:[...new Set(source.completedRunIds.filter(validRunId))].slice(-64)}:{}) };
}
