import {startEvents} from '../src/core/events.ts';
import { newProfile, startSeason, refreshStateOffers, editLayout, enterGrowthDay, type GameState } from '../src/core/state.ts';
import { boardExperience } from '../src/core/board.ts';
import { orderCandidates, type Order } from '../src/core/orders.ts';
import { findProductionPlan } from '../src/core/planner.ts';

// Только подготовка браузерных проверок поздних состояний. В сборку игры не входит.
export function orderFixture(completed = 0, day = 1, stock = 0): GameState {
  const s = startSeason(newProfile(), 123), b = s.season!.board;
  b.completed = Array.from({ length: completed }, (_, i) => ({ ...orderCandidates(i + 1, 1)[0]!, id: 10 + i }));
  b.offers = []; b.active = []; b.pending = null; b.nextId = 20;
  s.season!.day = day; s.season!.status = day === 1 ? 'preparing' : 'growing';
  s.season!.garden.stock = {carnation:stock,chrysanthemum:stock,rose:0,tulip:0,gerbera:0,lily:0};
  s.profile.experience = boardExperience(b); s.profile.progress.main=completed; s.season!.events=startEvents(123,day).events;
  return refreshStateOffers(s);
}
export function activeOrderFixture(completed: number, day: number, appeared: number, reputation = 3): GameState {
  const s = orderFixture(completed, day);
  s.season!.board.offers = [];
  const order: Order = { ...orderCandidates(completed + 1, appeared)[0]!, id: 20 };
  s.season!.board.active = [order]; s.season!.board.nextId = 21; s.season!.reputation = reputation;
  return s;
}
export function readyOrderFixture(completed: number, day: number): GameState {
  const s = activeOrderFixture(completed, day, day);
  for (const i of s.season!.board.active[0]!.ingredients) s.season!.garden.stock[i.kind as 'carnation' | 'chrysanthemum'] = i.count + 1;
  return s;
}
export function plantedOrderFixture(): { state: GameState; finishDay: number } {
  let state = startSeason(newProfile(), 123);
  const order = state.season!.board.offers[0]!;
  const plan = findProductionPlan({ day: 1, objects: [], plants: [], stock: state.season!.garden.stock }, [order]);
  if (!plan?.layout) throw Error('Для стартового заказа нет опорной расстановки.');
  for (const object of plan.layout) state = editLayout(state, { type: 'place', kind: object.kind, to: object });
  return { state, finishDay: plan.days.at(-1)!.day };
}

export function unprovenOffersFixture(): GameState {
  let state = plantedOrderFixture().state;
  state = enterGrowthDay(enterGrowthDay(enterGrowthDay(state)));
  state.season!.day = 20; state.season!.events=startEvents(123,20).events; state.season!.board.offers = [];
  state = refreshStateOffers(state);
  for (const object of state.season!.layout.objects.filter(o => o.kind === 'carnation' || o.kind === 'chrysanthemum')) state = editLayout(state, { type: 'remove', from: object });
  return state;
}
