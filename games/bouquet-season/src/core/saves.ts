import { ru } from '../i18n/ru.ts';
import { isGameState, readState, type GameState } from './state.ts';

export const CURRENT_KEY = 'progress';
export const PREVIOUS_KEY = 'progress.previous';
export const MAX_SAVE_BYTES = 64 * 1024;
export interface StoragePort {
  readonly mode: 'hub' | 'standalone';
  readonly gameId: string;
  readonly persistent: boolean;
  load(key: string): Promise<unknown>;
  save(key: string, value: unknown): Promise<void>;
}
export interface SaveRecord {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6;
  revision: number;
  savedAt: string;
  payload: string;
  sha256: string;
}
export type Copy = { status: 'missing' } | { status: 'invalid'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'valid'; record: SaveRecord; state: GameState };

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
async function hash(payload: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error(ru.saves.errors.secureContext);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function encode(state: GameState, revision: number, savedAt = new Date().toISOString()): Promise<SaveRecord> {
  if (!isGameState(state) || !Number.isSafeInteger(revision) || revision < 1
    || !Number.isFinite(Date.parse(savedAt)) || new Date(savedAt).toISOString() !== savedAt) {
    throw new Error(ru.saves.errors.verifyFailed);
  }
  const payload = JSON.stringify(state);
  const record: SaveRecord = { schemaVersion: 6, revision, savedAt, payload, sha256: await hash(payload) };
  if (bytes(record) > MAX_SAVE_BYTES) throw new Error(ru.saves.errors.tooBig);
  return record;
}

export async function decode(value: unknown): Promise<Copy> {
  if (value === null) return { status: 'missing' };
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || bytes(value) > MAX_SAVE_BYTES) throw new Error();
    const r = value as SaveRecord;
    if (Object.keys(r).sort().join() !== 'payload,revision,savedAt,schemaVersion,sha256'
      || (r.schemaVersion !== 1 && r.schemaVersion !== 2 && r.schemaVersion !== 3 && r.schemaVersion !== 4 && r.schemaVersion !== 5 && r.schemaVersion !== 6) || !Number.isSafeInteger(r.revision) || r.revision < 1
      || typeof r.payload !== 'string' || typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256)
      || typeof r.savedAt !== 'string' || !Number.isFinite(Date.parse(r.savedAt))
      || new Date(r.savedAt).toISOString() !== r.savedAt) throw new Error();
    if (await hash(r.payload) !== r.sha256) throw new Error();
    const state = readState(JSON.parse(r.payload),r.schemaVersion);
    if (!state) throw new Error();
    return { status: 'valid', record: r, state };
  } catch {
    return { status: 'invalid', reason: ru.saves.errors.invalidCopy };
  }
}

// Читаем копии независимо: ошибка одного ключа не скрывает исправный резерв.
export async function readCopies(storage: StoragePort): Promise<{ current: Copy; previous: Copy }> {
  const read = async (key: string): Promise<Copy> => {
    try { return await decode(await storage.load(key)); }
    catch { return { status: 'unavailable', reason: ru.saves.errors.readFailed }; }
  };
  const [current, previous] = await Promise.all([read(CURRENT_KEY), read(PREVIOUS_KEY)]);
  return { current, previous };
}

export class SaveSession {
  state: GameState;
  busy = false;
  error: string | null = null;
  #storage: StoragePort;
  #current: SaveRecord | null;
  #previous: SaveRecord | null;
  #revision: number;
  #pending: { next: GameState; rotate: SaveRecord | null; record?: SaveRecord } | null = null;

  constructor(storage: StoragePort, state: GameState, current: SaveRecord | null, previous: SaveRecord | null) {
    this.#storage = storage;
    this.state = structuredClone(state);
    this.#current = current;
    this.#previous = previous;
    this.#revision = Math.max(current?.revision ?? 0, previous?.revision ?? 0);
  }
  get blocked(): boolean { return this.busy || this.#pending !== null || !this.#storage.persistent; }
  get hasPending(): boolean { return this.#pending !== null; }
  get backup(): SaveRecord | null { return this.#previous; }
  get savedRevision(): number { return this.#current?.revision ?? 0; }
  rebind(storage: StoragePort): void {
    if (this.busy) throw new Error(ru.saves.errors.busy);
    if (storage === this.#storage) return;
    // SDK хаба закрепляет origin и родительское окно. Его нельзя заменять при повторе записи.
    if (this.#storage.mode === 'hub' || storage.mode !== this.#storage.mode || storage.gameId !== this.#storage.gameId) {
      throw new Error(ru.saves.errors.originUnconfirmed);
    }
    this.#storage = storage;
  }

  async act(transition: (state: GameState) => GameState): Promise<boolean> {
    if (this.blocked) return false;
    const next = transition(structuredClone(this.state));
    if (!isGameState(next)) throw new Error('Игровое действие создало неверное состояние.');
    this.state = structuredClone(next);
    this.#pending = { next: structuredClone(next), rotate: this.#current };
    return this.#flush();
  }

  async restore(): Promise<boolean> {
    if (this.blocked || !this.#previous) return false;
    const copy = await decode(this.#previous);
    if (copy.status !== 'valid') return false;
    // Восстановление заменяет весь профиль; резерв не вращаем и не уничтожаем.
    this.state = structuredClone(copy.state);
    this.#pending = { next: structuredClone(copy.state), rotate: null };
    return this.#flush();
  }

  async retry(): Promise<boolean> {
    if (this.busy || !this.#pending) return false;
    return this.#flush();
  }

  async #flush(): Promise<boolean> {
    const pending = this.#pending;
    if (!pending) return false;
    this.busy = true;
    this.error = null;
    try {
      if (!this.#storage.persistent) throw new Error(ru.saves.errors.notPersistent);
      pending.record ??= await encode(pending.next, this.#revision + 1);
      if (pending.rotate) await this.#storage.save(PREVIOUS_KEY, pending.rotate);
      await this.#storage.save(CURRENT_KEY, pending.record);
      this.#previous = pending.rotate ?? this.#previous;
      this.#current = pending.record;
      this.#revision = pending.record.revision;
      this.#pending = null;
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : ru.saves.errors.writeFailed;
      return false;
    } finally { this.busy = false; }
  }
}
