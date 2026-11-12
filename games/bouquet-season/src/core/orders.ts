import { ru } from '../i18n/ru.ts';
import type { PlantKind } from './layout.ts';

export type FlowerKind = PlantKind | 'rose' | 'tulip' | 'gerbera' | 'lily';
export interface Ingredient { kind: FlowerKind; count: number }
export type OrderFormat = 'supply' | 'gift' | 'showcase' | 'exhibition';
export interface Order {
  id: number;
  stage: number;
  recipe: string;
  format: OrderFormat;
  appeared: number;
  deadline: number;
  ingredients: Ingredient[];
  coins: number;
  experience: number;
}
export const RECIPES: ReadonlyArray<{ id: string; kinds: readonly FlowerKind[] }> = [
  { id: 'R1', kinds: ['carnation'] }, { id: 'R2', kinds: ['chrysanthemum'] },
  { id: 'R3', kinds: ['carnation', 'chrysanthemum'] },
  { id: 'R4', kinds: ['rose', 'carnation'] }, { id: 'R5', kinds: ['tulip', 'chrysanthemum'] },
  { id: 'R6', kinds: ['gerbera', 'rose'] }, { id: 'R7', kinds: ['lily', 'tulip'] },
  { id: 'R8', kinds: ['rose', 'gerbera', 'lily'] },
];
export const BASE_VOLUMES = [8, 14, 20, 26, 32] as const;
export const OPEN_FLOWERS: readonly PlantKind[] = ['carnation', 'chrysanthemum'];
export const flowerName = (kind: FlowerKind): string => ru.field.flowersPlural[kind];

// Метод наибольших остатков; равенство решается порядком ингредиентов рецепта.
export function portions(total: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(total) || total < weights.length || !weights.length
    || weights.some(w => !Number.isSafeInteger(w) || w < 1)) throw Error('Некорректные пропорции заказа.');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || weights.some(w => !Number.isSafeInteger(w * total))) throw Error('Слишком большой состав заказа.');
  const counts = weights.map(w => Math.floor(total * w / sum));
  const order = weights.map((w, i) => ({ i, remainder: total * w % sum })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let n = total - counts.reduce((a, b) => a + b, 0), i = 0; i < n; i++) counts[order[i]!.i]!++;
  if (counts.some(c => c < 1)) throw Error('Каждый ингредиент должен присутствовать.');
  return counts;
}

export function orderCandidates(stage: number, day: number, open: readonly FlowerKind[] = OPEN_FLOWERS): Omit<Order, 'id'>[] {
  if (!Number.isInteger(stage) || stage < 1 || stage > 6 || !Number.isInteger(day) || day < 1 || day > 20) throw Error('Некорректная ступень или день заказа.');
  const make = (kinds: readonly FlowerKind[], weights: number[], format: OrderFormat, recipe: string): Omit<Order, 'id'> => {
    const total = stage === 6 ? 48 : BASE_VOLUMES[stage - 1]! + Number(format === 'gift');
    const counts = portions(total, weights);
    return { stage, recipe, format, appeared: day, deadline: Math.min(20, day + (stage === 6 ? 7 : 5)),
      ingredients: kinds.map((kind, i) => ({ kind, count: counts[i]! })), coins: total * 2, experience: total * (stage === 6 ? 2 : 1) };
  };
  if (stage < 6) return RECIPES.filter(r => r.kinds.every(k => open.includes(k))).flatMap(r =>
    (['supply', 'gift'] as const).map(format => make(r.kinds, r.kinds.map(() => 1), format, r.id)));
  // Небольшой конечный набор: 2–4 вида, равные доли либо один ведущий вид.
  const kinds = [...new Set(open)];
  const result: Omit<Order, 'id'>[] = [];
  for (let bits = 1; bits < 2 ** kinds.length; bits++) {
    const subset = kinds.filter((_, i) => bits & 2 ** i);
    if (subset.length < 2 || subset.length > 4) continue;
    for (let lead = -1; lead < subset.length; lead++) {
      const weights = subset.map((_, i) => i === lead ? 2 : 1);
      result.push(make(subset, weights, result.length % 2 ? 'exhibition' : 'showcase', 'final'));
    }
  }
  return result;
}

export function nextRandom(seed: number): number {
  let n = seed >>> 0;
  n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
  return n >>> 0;
}

export function orderTitle(order: Pick<Order, 'stage' | 'format'>): string {
  return order.stage === 6 ? (order.format === 'showcase' ? ru.orders.titles.showcase : ru.orders.titles.cityExpo)
    : ru.orders.titles.stage(order.stage, order.format === 'gift');
}
