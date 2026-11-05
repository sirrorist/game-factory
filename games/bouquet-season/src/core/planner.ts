import { fieldCells, neighbors, sameCell, type FieldSize } from './field.ts';
import { isPlant, waterPlant, type PlacedObject, type PlantKind } from './layout.ts';
import { cutPlant, growDay, newPlant, type PlantState } from './growth.ts';
import { emptyStock, type Stock } from './garden.ts';
import type { Order } from './orders.ts';
import { emptyEffects, hasGlobal, conditionZone, type EffectsState } from './effects.ts';

export interface ProductionState { day: number; objects: readonly PlacedObject[]; plants: readonly PlantState[]; stock: Stock; effects?: EffectsState; size?:FieldSize; open?:readonly PlantKind[]; mainSlots?:number; eventSlots?:number }
export type ProductionGoal = Order & { earliest?: number };
export interface PlanDay { day: number; cut: Stock; delivered: number[]; stock: Stock }
export interface ProductionPlan {
  // Пустое значение означает сохранение расстановки. Иначе: убрать несовпавшее,
  // оставить совпавшие растения с их прогрессом, посадить остальные с нуля.
  layout: PlacedObject[] | null;
  days: PlanDay[];
}
const key = (objects: readonly PlacedObject[]): string => objects.map(o => `${o.q},${o.r}:${o.kind}`).sort().join(';');
const templates = new Map<string, PlacedObject[][]>();

function references(orders: readonly ProductionGoal[], state: ProductionState): PlacedObject[][] {
  const size=state.size??19,cells=fieldCells(size),totals=emptyStock();
  for (const order of orders) for (const i of order.ingredients) {
    totals[i.kind] += i.count;
  }
  const needed=(Object.keys(totals) as PlantKind[]).filter(k=>totals[k]>0);
  const basic=needed.every(k=>k==='carnation'||k==='chrysanthemum');
  const ratio = totals.carnation / (totals.carnation + totals.chrysanthemum || 1);
  const fx = state.effects ?? emptyEffects();
  const cacheKey = `${size}:${JSON.stringify(totals)}:${JSON.stringify(fx.globals)}:${JSON.stringify(fx.modules)}:${key(state.objects)}`;
  const cached = templates.get(cacheKey);
  if (cached) return cached;
  const variants: { score: number; objects: PlacedObject[] }[] = [];
  for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
    for (const deviceKinds of [['sprinkler', 'lamp'], ['lamp', 'sprinkler'], ...(needed.every(k=>waterPlant(k)!==hasGlobal(fx,'P1',k)) ? [['sprinkler','sprinkler']] : needed.every(k=>waterPlant(k)===hasGlobal(fx,'P1',k)) ? [['lamp','lamp']] : [])] as const) {
      const devices = [a, b].map((index, i) => ({ ...cells[index]!, kind: deviceKinds[i]!, adaptation: 0 as const })) as PlacedObject[];
      const scoped = referenceEffects(fx, state.objects, devices);
      const zones=devices.map(d=>new Set(conditionZone(d,devices,scoped,size).map(c=>`${c.q},${c.r}`)));
      const covered = (c: typeof cells[number], kind: 'lamp' | 'sprinkler'): boolean => devices.some((d,i) => d.kind === kind && zones[i]!.has(`${c.q},${c.r}`));
      const plants: PlacedObject[] = [];
      let c = 0, h = 0;
      const allocated=emptyStock();
      // Однозначные клетки сначала, общие распределяем по пропорциям требования.
      const spots = cells.filter(cell => !devices.some(d => sameCell(d, cell)))
        .map(cell => ({ cell, water: covered(cell, 'sprinkler'), light: covered(cell, 'lamp') }))
        .sort((x, y) => Number(x.water && x.light) - Number(y.water && y.light));
      for (const spot of spots) {
        const canC = (hasGlobal(fx,'P1','carnation') ? spot.light : spot.water) && totals.carnation > 0;
        const canH = (hasGlobal(fx,'P1','chrysanthemum') ? spot.water : spot.light) && totals.chrysanthemum > 0;
        if (basic && !canC && !canH) continue;
        const eligible=needed.filter(k=>(waterPlant(k)!==hasGlobal(fx,'P1',k))?spot.water:spot.light);
        if(!eligible.length)continue;
        const kind: PlantKind = basic ? canC && (!canH || c / (c + h || 1) < ratio) ? 'carnation' : 'chrysanthemum' : eligible.sort((a,b)=>allocated[a]/totals[a]-allocated[b]/totals[b])[0]!;
        allocated[kind]++;
        if (kind === 'carnation') c++; else h++;
        plants.push({ ...spot.cell, kind, adaptation: 0 });
      }
      const capacity = Math.min(...needed.map(k=>allocated[k]/totals[k]));
      variants.push({ objects: [...devices, ...plants], score: capacity * 1000 + plants.length });
    }
  }
  variants.sort((a, b) => b.score - a.score);
  const unique = new Map<string, PlacedObject[]>();
  for (const v of variants) if (!unique.has(key(v.objects))) { unique.set(key(v.objects), v.objects); if (unique.size === 16) break; }
  const result = [...unique.values()];
  // Кэш ограничен и не влияет на результат или RNG сезона.
  if (templates.size === 32) templates.delete(templates.keys().next().value!);
  templates.set(cacheKey, result);
  return result;
}

function referenceEffects(fx: EffectsState, old: readonly PlacedObject[], objects: readonly PlacedObject[]): EffectsState {
  return { ...fx, undo: null, modules: fx.modules.map(m => ({ ...m, at: m.at && old.some(o => sameCell(o,m.at!) && objects.some(n => sameCell(n,o) && n.kind === o.kind)) ? m.at : null })) };
}

function cutAll(objects: readonly PlacedObject[], plants: readonly PlantState[], stock: Stock): { plants: PlantState[]; stock: Stock; cut: Stock } {
  let result = [...plants];
  const next = { ...stock }, cut = emptyStock();
  for (const plant of plants) if (plant.yield && plant.wilt < 3) {
    const kind = objects.find(o => sameCell(o, plant))!.kind as PlantKind;
    if (!Number.isSafeInteger(next[kind] + plant.yield)) continue;
    const crop = cutPlant(objects, result, plant);
    result = crop.plants; next[crop.kind] += crop.amount; cut[crop.kind] += crop.amount;
  }
  return { plants: result, stock: next, cut };
}

function simulate(state: ProductionState, orders: readonly ProductionGoal[], layout: PlacedObject[] | null): ProductionPlan | null {
  const first = cutAll(state.objects, state.plants, state.stock);
  let stock = first.stock;
  let objects = layout ?? state.objects.map(o => ({ ...o }));
  const fx = layout ? referenceEffects(state.effects ?? emptyEffects(), state.objects, layout) : state.effects ?? emptyEffects();
  let plants = layout ? objects.filter(o => isPlant(o.kind)).map(o => {
    const old = state.objects.find(p => sameCell(p, o) && p.kind === o.kind);
    return old ? first.plants.find(p => sameCell(p, o))! : newPlant(o);
  }) : first.plants;
  // Пересадка здесь не используется: несовпавшее удаляется и сажается заново.
  objects = objects.map(o => ({ ...o, adaptation: state.objects.find(p => sameCell(p, o) && p.kind === o.kind)?.adaptation ?? 0 }));
  const remaining = [...orders].sort((a, b) => a.deadline - b.deadline || a.id - b.id);
  const days: PlanDay[] = [];
  const lastDay = Math.max(...remaining.map(o => o.deadline));
  for (let day = state.day; day <= lastDay; day++) {
    let cut = first.cut;
    if (day > state.day) {
      const grown = growDay(objects, plants, fx,state.size??19); objects = grown.objects;
      const crop = cutAll(objects, grown.plants, stock); plants = crop.plants; stock = crop.stock; cut = crop.cut;
    }
    const delivered: number[] = [];
    // Досрочная победа снимает ещё не просроченную ярмарку. Не тратим общий
    // запас на неё раньше готового финала, если это помешало бы победе.
    const canPay = (o: ProductionGoal): boolean => (o.earliest ?? state.day) <= day && o.ingredients.every(i => stock[i.kind] >= i.count);
    const final = remaining.find(o => o.stage === 6 && canPay(o));
    if (final) {
      for (const i of final.ingredients) stock[i.kind as PlantKind] -= i.count;
      days.push({ day, cut, delivered: [final.id], stock: { ...stock } });
      return { layout: layout && structuredClone(layout), days };
    }
    // Единица запаса расходуется ровно один раз. Ранний заказ можно сдать,
    // остальные ещё активны и разрешают следующие переходы календаря.
    for (const order of [...remaining].sort((a,b)=>Number(a.stage>0)-Number(b.stage>0)||a.deadline-b.deadline)) {
      if (!canPay(order)) continue;
      // Последний основной удерживаем до остальных целей: иначе дальнейший
      // рост потребовал бы неизвестного будущего заказа или бесплатного дня.
      if (order.stage > 0 && remaining.filter(o=>o.stage>0).length===1 && remaining.some(o=>o.stage===0)) continue;
      for (const i of order.ingredients) stock[i.kind as PlantKind] -= i.count;
      remaining.splice(remaining.indexOf(order), 1); delivered.push(order.id);
    }
    days.push({ day, cut, delivered, stock: { ...stock } });
    if (!remaining.length) return { layout: layout && structuredClone(layout), days };
    if (remaining.some(o => o.deadline <= day)) return null;
  }
  return null;
}

// Свидетельство, а не доказательство невозможности: текущая расстановка + не более
// 16 опорных, рост теми же правилами, без будущих покупок и случайных улучшений.
export function findProductionPlan(state: ProductionState, orders: readonly ProductionGoal[]): ProductionPlan | null {
  if (!orders.length || orders.some(o => o.deadline < state.day || o.deadline > 20)) return null;
  const search=(goals:readonly ProductionGoal[]):ProductionPlan|null=>{
    const current=simulate(state,goals,null);if(current)return current;
    for(const layout of references(goals,state)){const plan=simulate(state,goals,layout);if(plan)return plan;}
    return null;
  };
  const fair=orders.find(o=>o.recipe==='fair');
  if(fair&&orders.some(o=>o.stage===6)){
    // Ярмарку можно отложить, если реальная победа наступит до её штрафа.
    // Жадная ранняя сдача минимума не должна уничтожать такой план финала.
    const early=search(orders.filter(o=>o!==fair));
    if(early&&early.days.at(-1)!.day<=fair.deadline)return early;
  }
  return search(orders);
}
