import {legacyState} from './legacy-fixtures.ts';
import {startEvents} from '../src/core/events.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, startSeason, refreshStateOffers, editLayout, harvest, enterGrowthDay, isGameState, type GameState } from '../src/core/state.ts';
import { acceptOrder, submitOrder, closeDay, surrenderSeason, lossShare, harvestAll, canSurrenderSeason } from '../src/core/calendar.ts';
import { unprovenOffersFixture } from './order-fixtures.ts';
import { orderCandidates, type Order } from '../src/core/orders.ts';
import { boardIncome, boardExperience } from '../src/core/board.ts';
import { findProductionPlan } from '../src/core/planner.ts';
import { encode, decode, SaveSession, CURRENT_KEY, PREVIOUS_KEY, type StoragePort } from '../src/core/saves.ts';

// Поздние ступени — независимая подготовка сохранения. В игре пропуска выбора нет.
function fixture(completed = 0, day = 1): GameState {
  const s = startSeason(newProfile(), 123);
  const b = s.season!.board;
  b.completed = Array.from({ length: completed }, (_, i) => ({ ...orderCandidates(i + 1, 1)[0]!, id: 10 + i }));
  b.active = []; b.offers = []; b.pending = null; b.nextId = 20;
  s.season!.day = day; s.season!.status = day === 1 ? 'preparing' : 'growing';
  s.profile.experience = boardExperience(b);s.profile.progress.main=completed;s.season!.events=startEvents(123,day).events;
  return s;
}
const card = (stage: number, appeared: number, id = 20): Order => ({ ...orderCandidates(stage, appeared)[0]!, id });
function preparedDelivery(completed = 0, day = 1): GameState {
  const s = fixture(completed, day), order = card(completed + 1, day);
  s.season!.board.active = [order]; s.season!.board.nextId = 21;
  for (const i of order.ingredients) s.season!.garden.stock[i.kind as 'carnation' | 'chrysanthemum'] = i.count + 2;
  assert.ok(isGameState(s)); return s;
}

test('Стабильные предложения и RNG, позднее принятие не продлевает срок', () => {
  const first = startSeason(newProfile(), 123), copy = structuredClone(first);
  assert.equal(refreshStateOffers(first), first); assert.deepEqual(first, copy);
  const s = fixture(0, 6); s.season!.board.offers = [card(1, 1)]; s.season!.board.nextId = 21;
  assert.throws(() => acceptOrder(s, 20), /план не найден/);
  assert.deepEqual(s.season!.board.offers[0], card(1, 1));
  s.season!.garden.stock={carnation:16,chrysanthemum:8,rose:0,tulip:0,gerbera:0,lily:0};
  const accepted = acceptOrder(s, 20);
  assert.equal(accepted.season!.board.active[0]!.deadline, 6);
  assert.equal(accepted.season!.board.offers.length, 0);
  assert.equal(accepted.season!.rng, s.season!.rng); assert.ok(isGameState(accepted));
  assert.throws(() => acceptOrder(accepted, 20), /занято/);
  assert.throws(() => closeDay(first), /активный/);
  const placed = editLayout(first, { type: 'place', kind: 'lamp', to: { q: 0, r: 0 } });
  const acceptedPlaced = acceptOrder(placed, placed.season!.board.offers[0]!.id);
  assert.ok(placed.season!.layout.undo); assert.ok(placed.season!.garden.undo);
  assert.equal(acceptedPlaced.season!.layout.undo, null); assert.equal(acceptedPlaced.season!.garden.undo, null);
  assert.deepEqual(acceptedPlaced.season!.layout.objects, placed.season!.layout.objects);
});

test('Обычная сдача расходует точный состав один раз и сохраняет обязательную паузу выбора', () => {
  const s = preparedDelivery(), before = structuredClone(s), next = submitOrder(s, 20);
  assert.deepEqual(s, before); assert.equal(next.season!.garden.stock.carnation, 2);
  assert.equal(next.profile.coins, 0); assert.equal(next.profile.experience, 8);
  assert.equal(boardIncome(next.season!.board), 16);
  assert.equal(next.season!.board.pending?.orderId,20);assert.equal(next.season!.board.pending?.stage,1);assert.equal(next.season!.board.pending?.options.length,3);
  assert.ok(isGameState(next)); assert.equal(next.season!.board.offers.length, 0);
  for (const action of [() => submitOrder(next, 20), () => closeDay(next), () => harvest(next, { q: 0, r: 0 }), () => editLayout(next, { type: 'place', kind: 'lamp', to: { q: 0, r: 0 } })]) assert.throws(action, /выбор/);
  assert.deepEqual(startSeason(next, 99), next);
});

test('Просрочка: сначала штраф, затем один рост и новые сроки с нового дня; провалы и ярмарка завершают сезон до роста', () => {
  let s = startSeason(newProfile(), 123);
  for (let attempt = 0; attempt < 3; attempt++) {
    s = acceptOrder(s, s.season!.board.offers[0]!.id);
    const deadline = s.season!.board.active[0]!.deadline;
    while (s.season!.day < deadline) { s = closeDay(s); if(s.season!.day===6){s.season!.events.fair.minimum=true;s.profile.experience+=16;} assert.ok(isGameState(s)); }
    assert.equal(s.season!.reputation, 3 - attempt);
    s = closeDay(s); assert.ok(isGameState(s));
    assert.equal(s.season!.reputation, 2 - attempt);
    if (attempt < 2) {
      assert.equal(s.season!.day, deadline + 1);
      assert.ok(s.season!.board.offers.every(o => o.stage === 1 && o.appeared === deadline + 1 && o.deadline === Math.min(20, deadline + 6)));
    } else {
      assert.equal(s.season!.day, deadline);
      assert.equal(s.season!.board.result!.reason, 'reputation');
      assert.equal(s.season!.board.offers.length, 0); assert.equal(closeDay(s), s);
    }
  }
});

test('Сдача разрешена в день дедлайна и восстанавливает репутацию не выше 3', () => {
  let s = preparedDelivery(0, 6); s.season!.board.active = [card(1, 1)]; s.season!.reputation = 2;
  s = submitOrder(s, 20); assert.equal(s.season!.reputation, 3); assert.ok(isGameState(s));
  const max = submitOrder(preparedDelivery(), 20); assert.equal(max.season!.reputation, 3);
});

test('Пятый основной фиксирует награду и pending, финальных предложений ещё нет', () => {
  const next = submitOrder(preparedDelivery(4, 15), 20);
  assert.equal(next.season!.board.completed.length, 5); assert.equal(next.season!.board.pending!.stage, 5);
  assert.equal(next.season!.board.offers.length, 0); assert.equal(refreshStateOffers(next), next);
  assert.ok(isGameState(next));
});

test('Финал на дне 20 — немедленная победа, итог зачислен один раз; следующий сезон сохраняет кошелёк/опыт', () => {
  const s = preparedDelivery(5, 20); s.profile.coins = 100;
  const win = submitOrder(s, 20); assert.ok(isGameState(win));
  assert.equal(win.season!.day, 20); assert.equal(win.season!.board.result!.outcome, 'win');
  assert.equal(win.season!.board.result!.income, 296); assert.equal(win.profile.coins, 396); assert.equal(win.profile.experience, 196);
  assert.equal(closeDay(win), win); assert.equal(surrenderSeason(win), win);
  assert.throws(() => submitOrder(win, 20), /завершён/);
  const next = startSeason(win, 99); assert.equal(next.season!.number, 2); assert.equal(next.season!.day, 1);
  assert.equal(next.profile.coins, 396); assert.equal(next.profile.experience, 196); assert.equal(next.season!.board.completed.length, 0); assert.ok(isGameState(next));
});

test('Конец дня 20 без финала: без роста 21, потеря floor(доход/4), старые деньги и весь опыт сохранены', () => {
  const s = fixture(2, 20); s.profile.coins = 100; s.profile.experience += 50;
  s.season!.board.active = [card(3, 15)]; s.season!.board.nextId = 21;
  assert.ok(isGameState(s));
  const lost = closeDay(s); assert.ok(isGameState(lost));
  assert.equal(lost.season!.day, 20); assert.equal(lost.season!.reputation, 2);
  assert.deepEqual(lost.season!.garden, s.season!.garden);
  assert.equal(lost.season!.board.result!.reason, 'calendar');
  assert.equal(lost.season!.board.result!.lost, 11); assert.equal(lost.profile.coins, 133); assert.equal(lost.profile.experience, 72);
  assert.deepEqual(lossShare(27), { lost: 6, credited: 21 });
  assert.equal(closeDay(lost), lost);
});

test('Пустая доска не означает автоматического поражения и не даёт бесплатного дня', () => {
  const s = refreshStateOffers(fixture(0, 20));
  assert.equal(s.season!.board.offers.length, 0); assert.equal(s.season!.board.result, null);
  assert.throws(() => closeDay(s), /активный/);
  const end = surrenderSeason(s); assert.ok(isGameState(end)); assert.equal(end.season!.board.result!.reason, 'surrender');
  const normal = startSeason(newProfile(), 123); assert.throws(() => surrenderSeason(normal), /ни для одного/);
});

test('Сохранённые предложения без найденного плана не запирают сезон и не обновляются', () => {
  const s = unprovenOffersFixture(), before = structuredClone(s);
  assert.ok(isGameState(s)); assert.ok(s.season!.board.offers.length);
  for (const order of s.season!.board.offers) assert.throws(() => acceptOrder(s, order.id), /план не найден/);
  assert.equal(refreshStateOffers(s), s); assert.deepEqual(s, before);
  assert.equal(canSurrenderSeason(s), true);
  const lost = surrenderSeason(s); assert.ok(isGameState(lost)); assert.equal(lost.season!.board.result!.reason, 'surrender');
  assert.equal(canSurrenderSeason(startSeason(newProfile(), 123)), false);
});

test('Срезать всё в день 20: общий запас, нет нового роста и повторной срезки', () => {
  let s = startSeason(newProfile(), 123);
  const order = s.season!.board.offers[0]!;
  const plan = findProductionPlan({ day: 1, objects: [], plants: [], stock: s.season!.garden.stock }, [order]); assert.ok(plan?.layout);
  for (const o of plan.layout) s = editLayout(s, { type: 'place', kind: o.kind, to: o });
  s = enterGrowthDay(enterGrowthDay(enterGrowthDay(s)));
  s.season!.day = 20; s.season!.events=startEvents(123,20).events; s.season!.board.offers = []; s.season!.board.active = [card(1, 15, 1)];
  const next = harvestAll(s); assert.ok(isGameState(next));
  assert.ok(next.season!.garden.stock.carnation + next.season!.garden.stock.chrysanthemum >= 8);
  assert.equal(next.season!.day, 20); assert.equal(harvestAll(next), next);
});

class Memory implements StoragePort {
  readonly mode = 'standalone' as const; readonly gameId = 'bouquet-season'; readonly persistent = true;
  records = new Map<string, unknown>(); fail = false; writes = 0;
  async load(key: string): Promise<unknown> { return this.records.get(key) ?? null; }
  async save(key: string, value: unknown): Promise<void> { this.writes++; if (this.fail && key === CURRENT_KEY) throw Error('Отказ записи.'); this.records.set(key, structuredClone(value)); }
}
test('Отказ/повтор принятия, дня, сдачи и финала: один revision, один рост/расход/награда; reload сохраняет pending', async () => {
  const first = startSeason(newProfile(), 123), active = acceptOrder(first, first.season!.board.offers[0]!.id);
  for (const [initial, action] of [[first, (s: GameState) => acceptOrder(s, first.season!.board.offers[0]!.id)], [active, closeDay], [preparedDelivery(), (s: GameState) => submitOrder(s, 20)], [preparedDelivery(5, 20), (s: GameState) => submitOrder(s, 20)]] as const) {
    const port = new Memory(), record = await encode(initial, 10); port.records.set(CURRENT_KEY, record);
    const session = new SaveSession(port, initial, record, null); port.fail = true;
    assert.equal(await session.act(action), false); const pending = structuredClone(session.state); assert.ok(isGameState(pending));
    assert.equal(await session.act(action), false); assert.equal(await session.retry(), false); assert.deepEqual(session.state, pending);
    port.fail = false; assert.equal(await session.retry(), true); assert.equal(session.savedRevision, 11);
    const copy = await decode(port.records.get(CURRENT_KEY)); assert.equal(copy.status, 'valid');
    if (copy.status === 'valid') assert.deepEqual(copy.state, pending);
    assert.deepEqual(port.records.get(PREVIOUS_KEY), record);
  }
});

test('Схема 4: точная форма, состав/награды/ступени/ID, pending и однократный итог проверяются', () => {
  const s = startSeason(newProfile(), 123), offer = s.season!.board.offers[0]!;
  for (const patch of [{ nextId: offer.id }, { completed: [offer] }, { offers: [offer, offer] }, { pending: { orderId: 99, stage: 1 } },
    { offers: [{ ...offer, coins: 999 }] }, { offers: [{ ...offer, deadline: 20 }] }, { offers: [{ ...offer, ingredients: [{ kind: 'rose', count: 8 }] }] }, { future: true }]) {
    assert.equal(isGameState({ ...s, season: { ...s.season!, board: { ...s.season!.board, ...patch } } }), false);
  }
  const win = submitOrder(preparedDelivery(5, 20), 20);
  assert.equal(isGameState({ ...win, season: { ...win.season!, board: { ...win.season!.board, result: { ...win.season!.board.result!, credited: 297 } } } }), false);
});

test('Старая схема 3: строгая проверка перед миграцией, те же сад/склад и воспроизводимая доска; чтение не пишет', async () => {
  const state = startSeason(newProfile(), 123); const { board: ignored, ...oldSeason } = state.season!; void ignored;
  const old = legacyState(state,3), payload = JSON.stringify(old);
  const record = { schemaVersion: 3 as const, revision: 8, savedAt: new Date().toISOString(), payload, sha256: Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))).toString('hex') };
  const port = new Memory(); port.records.set(CURRENT_KEY, record);
  const a = await decode(record), b = await decode(record); assert.equal(a.status, 'valid'); assert.deepEqual(a, b); assert.equal(port.writes, 0);
  if (a.status !== 'valid') return;
  assert.deepEqual(a.state.season!.garden, oldSeason.garden); assert.deepEqual(a.state.profile, {...old.profile,progress:{main:0,urgent:0,wins:0},owned:[],tutorial:[]});
  const session = new SaveSession(port, a.state, record, null); await session.act(s => acceptOrder(s, s.season!.board.offers[0]!.id));
  assert.equal((port.records.get(CURRENT_KEY) as { schemaVersion: number }).schemaVersion, 6); assert.deepEqual(port.records.get(PREVIOUS_KEY), record);
  assert.equal((await decode({ ...record, payload: JSON.stringify({ ...old, season: { ...oldSeason, future: true } }) })).status, 'invalid');
});
