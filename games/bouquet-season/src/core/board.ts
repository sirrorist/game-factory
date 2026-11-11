import { orderCandidates, nextRandom, OPEN_FLOWERS, type FlowerKind, type Order } from './orders.ts';
import { findProductionPlan, type ProductionGoal, type ProductionState } from './planner.ts';
import { isOption, effectDefinition } from './effects.ts';
import type { RewardPending } from './rewards.ts';

export interface SeasonResult {
  outcome: 'win' | 'loss';
  reason: 'final' | 'reputation' | 'calendar' | 'surrender';
  income: number;
  lost: number;
  credited: number;
  experience: number;
  final: Order | null;
}
export interface OrderBoard {
  completed: Order[];
  active: Order[];
  offers: Order[];
  nextId: number;
  pending: RewardPending | null;
  result: SeasonResult | null;
  reason: 'initial' | 'expired' | 'earlier' | 'unproven';
}
export const newBoard = (): OrderBoard => ({ completed: [], active: [], offers: [], nextId: 1, pending: null, result: null, reason: 'initial' });
export const boardIncome = (board: OrderBoard): number => board.completed.reduce((n, o) => n + o.coins, 0) + (board.result?.final?.coins ?? 0);
export const boardExperience = (board: OrderBoard): number => board.completed.reduce((n, o) => n + o.experience, 0) + (board.result?.final?.experience ?? 0);
export const freeStage = (board: OrderBoard): number => [1, 2, 3, 4, 5].find(s => !board.completed.some(o => o.stage === s) && !board.active.some(o => o.stage === s)) ?? 6;

export function refreshOffers(board: OrderBoard, state: ProductionState, rng: number, mandatory: ProductionGoal[] = []): { board: OrderBoard; rng: number } {
  if(board.pending)return {board,rng};
  if (board.result || board.active.length >= (state.mainSlots??1) || freeStage(board)===6&&board.completed.length<5) return { board: board.offers.length ? { ...board, offers: [] } : board, rng };
  const stage = freeStage(board);
  if (board.offers.length && board.offers[0]!.stage === stage && board.offers[0]!.deadline >= state.day) return { board, rng };
  const candidates = orderCandidates(stage, state.day,state.open??OPEN_FLOWERS).filter((o, i) => findProductionPlan(state, [...board.active, { ...o, id: board.nextId + i }, ...mandatory]));
  if (!candidates.length) return { board: { ...board, offers: [], reason: 'unproven' }, rng };
  for (let i = candidates.length - 1; i > 0; i--) {
    rng = nextRandom(rng);
    const j = rng % (i + 1);
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const selected = candidates.slice(0, 3);
  const offers: Order[] = selected.map((o, i) => ({ ...o, id: board.nextId + i,
    format: stage === 6 ? (i % 2 ? 'exhibition' : 'showcase') : o.format }));
  if (!Number.isSafeInteger(board.nextId + offers.length)) throw Error('Номера заказов исчерпаны.');
  const reason = board.offers.length && board.offers[0]!.stage > stage ? 'earlier' : board.reason;
  return { board: { ...board, offers, nextId: board.nextId + offers.length, reason }, rng };
}

export function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
export const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;

function isOrder(value: unknown, day: number, open:readonly FlowerKind[]): value is Order {
  if (!exact(value, ['id', 'stage', 'recipe', 'format', 'appeared', 'deadline', 'ingredients', 'coins', 'experience'])
    || !integer(value.id, 1) || !integer(value.stage, 1, 6) || !integer(value.appeared, 1, day)
    || !Array.isArray(value.ingredients) || !value.ingredients.every(i => exact(i, ['kind', 'count']) && integer(i.count, 1, 49))) return false;
  const candidates = orderCandidates(value.stage, value.appeared,open);
  return candidates.some(o => o.recipe === value.recipe && o.deadline === value.deadline && o.coins === value.coins && o.experience === value.experience
    && (value.stage === 6 ? value.format === 'showcase' || value.format === 'exhibition' : o.format === value.format)
    && o.ingredients.length === (value.ingredients as unknown[]).length
    && o.ingredients.every((i, n) => { const other = (value.ingredients as { kind: string; count: number }[])[n]!; return i.kind === other.kind && i.count === other.count; }));
}

export function isBoard(value: unknown, day: number, reputation: number, legacy = false, extraIncome = 0, extraExperience = 0, slots = 1, open:readonly FlowerKind[] = OPEN_FLOWERS): value is OrderBoard {
  if (!exact(value, ['completed', 'active', 'offers', 'nextId', 'pending', 'result', 'reason'])
    || !Array.isArray(value.completed) || value.completed.length > 5 || !Array.isArray(value.active) || value.active.length > slots
    || !Array.isArray(value.offers) || value.offers.length > 3 || !integer(value.nextId, 1)
    || !['initial', 'expired', 'earlier', 'unproven'].includes(value.reason as string)) return false;
  const lists = [...value.completed, ...value.active, ...value.offers];
  if (!lists.every(o => isOrder(o, day,open)) || new Set(lists.map(o => o.id)).size !== lists.length || lists.some(o => o.id >= (value.nextId as number))) return false;
  const b = value as unknown as OrderBoard;
  if(slots===1&&(b.completed.some((o,i)=>o.stage!==i+1)||b.active.some(o=>o.stage!==freeStage({...b,active:[]}))))return false;
  const reserved=[...b.completed,...b.active];
  if (b.completed.some(o=>o.stage===6) || new Set(reserved.map(o=>o.stage)).size!==reserved.length
    || b.active.some(o=>o.deadline<day || o.stage===6&&b.completed.length!==5)
    || b.offers.some(o=>o.stage!==freeStage(b)||o.deadline<day || o.stage===6&&b.completed.length!==5)
    || b.active.length>=slots&&b.offers.length || b.active.some(o=>o.stage===6)&&b.active.length!==1) return false;
  if (new Set(b.offers.map(o => JSON.stringify(o.ingredients))).size !== b.offers.length
    || (b.offers.length > 1 && b.offers[0]!.stage === 6 && new Set(b.offers.map(o => o.format)).size < 2)
    || b.offers.some(o => o.appeared !== b.offers[0]!.appeared)) return false;
  if (b.pending !== null) {
    const p = b.pending;
    if (!exact(p, legacy ? ['orderId','stage'] : ['orderId','stage','source','options']) || !integer(p.orderId,1) || b.result) return false;
    if (legacy || p.source==='main') {
      if (!integer(p.stage,1,5) || b.completed.at(-1)?.id!==p.orderId || b.completed.at(-1)?.stage!==p.stage || (slots===1&&b.offers.length)) return false;
    } else if (!['urgent','fair'].includes(p.source) || p.stage!==0) return false;
    if (!legacy && (!Array.isArray(p.options) || p.options.length!==3 || !p.options.every(isOption)
      || new Set(p.options.map(o=>`${o.effect}:${o.target}`)).size!==3
      || effectDefinition(p.options[0]!.effect).category!=='plant' || effectDefinition(p.options[1]!.effect).category!=='device')) return false;
  }
  if (b.result === null) return reputation > 0;
  const r = b.result;
  if (!exact(r, ['outcome', 'reason', 'income', 'lost', 'credited', 'experience', 'final']) || b.active.length || b.offers.length || b.pending
    || !['final', 'reputation', 'calendar', 'surrender'].includes(r.reason) || !['win', 'loss'].includes(r.outcome)) return false;
  if (r.outcome === 'win') {
    if (r.reason !== 'final' || reputation === 0 || b.completed.length !== 5 || !isOrder(r.final, day,open) || r.final.stage !== 6 || r.final.deadline < day
      || r.final.id >= b.nextId || lists.some(o => o.id === r.final!.id)) return false;
  } else if (r.reason === 'final' || r.final !== null || (r.reason === 'reputation' ? reputation !== 0 : reputation === 0)
    || (r.reason === 'calendar' && day !== 20)) return false;
  return r.income === boardIncome(b)+extraIncome && r.experience === boardExperience(b)+extraExperience
    && r.lost === (r.outcome === 'win' ? 0 : Math.floor(r.income / 4)) && r.credited === r.income - r.lost;
}
