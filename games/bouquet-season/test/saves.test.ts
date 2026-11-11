import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, startSeason, changeSettings } from '../src/core/state.ts';
import { CURRENT_KEY, PREVIOUS_KEY, MAX_SAVE_BYTES, SaveSession, encode, decode, readCopies, type StoragePort } from '../src/core/saves.ts';

class Memory implements StoragePort {
  mode: 'hub' | 'standalone' = 'standalone';
  gameId = 'bouquet-season';
  persistent = true;
  values = new Map<string, unknown>();
  writes: string[] = [];
  fail: string | null = null;
  failRead: string | null = null;
  async load(key: string): Promise<unknown> {
    if (this.failRead === key) throw new Error('Чтение запрещено.');
    return this.values.get(key) ?? null;
  }
  async save(key: string, value: unknown): Promise<void> {
    this.writes.push(key);
    if (this.fail === key) throw new Error('Запись запрещена.');
    this.values.set(key, structuredClone(value));
  }
}

test('SHA-256 точной строки, версия, дата и игровые ограничения проверяются отдельно', async () => {
  const record = await encode(newProfile(), 1);
  assert.equal((await decode(record)).status, 'valid');
  for (const bad of [ { ...record, payload: record.payload + ' ' }, { ...record, schemaVersion: 7 },
    { ...record, savedAt: 'вчера' }, { ...record, revision: 1.5 }, { ...record, sha256: '0'.repeat(64) },
    { ...record, payload: 'я'.repeat(40000) }, { ...record, extra: true } ]) {
    assert.equal((await decode(bad)).status, 'invalid');
  }
  const payload = JSON.stringify({ ...newProfile(), profile: { coins: -1, experience: 0, seasonsStarted: 0 } });
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))).toString('hex');
  assert.equal((await decode({ ...record, payload, sha256 })).status, 'invalid');
});

test('Сбой текущей записи после ротации: пауза, повтор того же действия и номера, затем возобновление', async () => {
  const storage = new Memory();
  const first = await encode(newProfile(), 1);
  storage.values.set(CURRENT_KEY, first);
  const session = new SaveSession(storage, newProfile(), first, null);
  let calls = 0;
  storage.fail = CURRENT_KEY;
  assert.equal(await session.act(s => { calls++; return startSeason(s, 123); }), false);
  assert.equal(session.blocked, true);
  assert.equal(await session.act(s => { calls++; return s; }), false);
  assert.deepEqual(storage.values.get(PREVIOUS_KEY), first);
  storage.fail = null;
  assert.equal(await session.retry(), true);
  assert.equal(calls, 1);
  const copies = await readCopies(storage);
  assert.equal(copies.current.status, 'valid');
  if (copies.current.status !== 'valid') return;
  assert.equal(copies.current.record.revision, 2);
  assert.deepEqual(copies.current.state, session.state);
  const resumed = new SaveSession(storage, copies.current.state, copies.current.record, first);
  assert.deepEqual(resumed.state.profile, { coins: 0, experience: 0, seasonsStarted: 1, progress:{main:0,urgent:0,wins:0},owned:[],tutorial:[] });
  assert.equal(resumed.state.season?.rng, startSeason(newProfile(), 123).season!.rng);
});

test('persistent: false не запускает сезон; повторная инициализация не теряет ожидающую запись', async () => {
  const storage = new Memory();
  storage.persistent = false;
  const session = new SaveSession(storage, newProfile(), null, null);
  assert.equal(await session.act(s => startSeason(s, 1)), false);
  assert.equal(JSON.stringify(session.state.season), 'null');
  assert.equal(storage.writes.length, 0);
  storage.persistent = true;
  storage.fail = CURRENT_KEY;
  await session.act(s => startSeason(s, 2));
  const available = new Memory();
  session.rebind(available);
  assert.equal(await session.retry(), true);
  assert.equal(session.state.season?.rng, startSeason(newProfile(), 2).season!.rng);
});

test('Повреждённый основной не попадает в резерв; восстановление заменяет профиль целиком', async () => {
  const storage = new Memory();
  const state = startSeason(newProfile(), 123);
  state.profile.coins = 40;
  const backup = await encode(state, 4);
  storage.values.set(CURRENT_KEY, { bad: true });
  storage.values.set(PREVIOUS_KEY, backup);
  const copies = await readCopies(storage);
  assert.equal(copies.current.status, 'invalid');
  assert.equal(copies.previous.status, 'valid');
  assert.equal(storage.writes.length, 0);
  const session = new SaveSession(storage, state, null, backup);
  assert.equal(await session.restore(), true);
  assert.equal(session.state.profile.coins, 40);
  assert.deepEqual(storage.values.get(PREVIOUS_KEY), backup);
  assert.equal(session.savedRevision, 5);
  await session.act(s => changeSettings(s, { tutorial: false }));
  const current = await decode(storage.values.get(CURRENT_KEY));
  assert.equal(current.status, 'valid');
});

test('Сбой резервной записи не перезаписывает основную; чтение и повреждение не создают пустой профиль', async () => {
  const storage = new Memory();
  const first = await encode(newProfile(), 1);
  storage.values.set(CURRENT_KEY, first);
  storage.fail = PREVIOUS_KEY;
  const session = new SaveSession(storage, newProfile(), first, null);
  assert.equal(await session.act(s => startSeason(s, 1)), false);
  assert.deepEqual(storage.values.get(CURRENT_KEY), first);
  storage.failRead = CURRENT_KEY;
  storage.values.set(PREVIOUS_KEY, { broken: true });
  const copies = await readCopies(storage);
  assert.equal(copies.current.status, 'unavailable');
  assert.equal(copies.previous.status, 'invalid');
  assert.deepEqual(storage.writes, [PREVIOUS_KEY]);
});

test('Параллельное нажатие не обгоняет обязательную запись', async () => {
  const storage = new Memory();
  const session = new SaveSession(storage, newProfile(), null, null);
  const first = session.act(s => startSeason(s, 1));
  assert.equal(await session.act(s => startSeason(s, 2)), false);
  assert.equal(await first, true);
  assert.equal(session.savedRevision, 1);
});

test('Потеря ответа после успешной записи повторяет тот же revision и не суммирует прогресс', async () => {
  const storage = new Memory();
  const originalSave = storage.save.bind(storage);
  let loseResponse = true;
  storage.save = async (key, value) => {
    await originalSave(key, value);
    if (loseResponse && key === CURRENT_KEY) throw new Error('Ответ потерян.');
  };
  const session = new SaveSession(storage, newProfile(), null, null);
  await session.act(s => startSeason(s, 123));
  const accepted = structuredClone(storage.values.get(CURRENT_KEY));
  assert.equal(session.blocked, true);
  loseResponse = false;
  assert.equal(await session.retry(), true);
  assert.deepEqual(storage.values.get(CURRENT_KEY), accepted);
  assert.equal(session.state.profile.seasonsStarted, 1);
});

test('Восстановление более раннего профиля заменяет деньги, опыт, настройки и RNG', async () => {
  const storage = new Memory();
  const old = startSeason(newProfile(), 123);
  old.profile.coins = 40;
  old.profile.experience = 12;
  const recent = changeSettings(startSeason(newProfile(), 456), { tutorial: false });
  recent.profile.coins = 80;
  recent.profile.experience = 24;
  const current = await encode(recent, 10);
  const previous = await encode(old, 8);
  const session = new SaveSession(storage, recent, current, previous);
  assert.equal(await session.restore(), true);
  assert.deepEqual(session.state, old);
  assert.equal(session.savedRevision, 11);
});

test('Ожидающая запись хаба не переходит в локальное хранилище или другое подключение', async () => {
  const hub = new Memory();
  hub.mode = 'hub';
  const first = await encode(newProfile(), 1);
  hub.values.set(CURRENT_KEY, first);
  hub.fail = CURRENT_KEY;
  const session = new SaveSession(hub, newProfile(), first, null);
  await session.act(s => startSeason(s, 123));
  const pendingState = structuredClone(session.state);
  const local = new Memory();
  const otherHub = new Memory();
  otherHub.mode = 'hub';
  assert.throws(() => session.rebind(local), /хранилищ/);
  assert.throws(() => session.rebind(otherHub), /хранилищ/);
  assert.equal(session.hasPending, true);
  assert.deepEqual(session.state, pendingState);
  assert.equal(await session.retry(), false);
  assert.equal(local.writes.length, 0);
  assert.equal(otherHub.writes.length, 0);
  hub.fail = null;
  assert.equal(await session.retry(), true);
  assert.equal(session.savedRevision, 2);
  assert.equal(session.state.season?.rng, startSeason(newProfile(), 123).season!.rng);
  const saved = await decode(await hub.load(CURRENT_KEY));
  assert.equal(saved.status, 'valid');
  if (saved.status === 'valid') assert.deepEqual(saved.state, pendingState);
});

test('Перепроверка локального хранения принимает только тот же режим и gameId', async () => {
  const local = new Memory();
  const session = new SaveSession(local, newProfile(), null, null);
  const hub = new Memory();
  hub.mode = 'hub';
  const otherGame = new Memory();
  otherGame.gameId = 'other-game';
  assert.throws(() => session.rebind(hub), /хранилищ/);
  assert.throws(() => session.rebind(otherGame), /хранилищ/);
  assert.doesNotThrow(() => session.rebind(new Memory()));
});

test('Граница размера: правильный payload и хеш принимаются на 64 КБ и отвергаются на байт выше', async () => {
  const record = await encode(newProfile(), 1);
  const baseBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  for (const extra of [0, 1]) {
    const payload = record.payload + ' '.repeat(MAX_SAVE_BYTES - baseBytes + extra);
    const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))).toString('hex');
    const boundary = { ...record, payload, sha256 };
    assert.equal(new TextEncoder().encode(JSON.stringify(boundary)).byteLength, MAX_SAVE_BYTES + extra);
    assert.equal((await decode(boundary)).status, extra === 0 ? 'valid' : 'invalid');
  }
});
