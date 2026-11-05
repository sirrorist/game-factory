import { neighbors, sameCell, hasCell, type Cell, type FieldSize } from './field.ts';
import { CATALOG, isPlant, type ObjectKind, type PlacedObject, type LayoutCommand, type Layout } from './layout.ts';

export const EFFECTS = [
  { id: 'P1', name: 'Смена предпочтений', category: 'plant', form: 'global', text: 'Обязательный и дополнительный уход выбранного вида меняются местами.' },
  { id: 'P2', name: 'Свет от соседей', category: 'plant', form: 'global', text: 'Живой сосед того же вида в прямом свете передаёт свет на один шаг.' },
  { id: 'P3', name: 'Вода от соседей', category: 'plant', form: 'global', text: 'Живой сосед того же вида в прямой зоне поливателя передаёт полив на один шаг.' },
  { id: 'P4', name: 'Смешанная клумба', category: 'plant', form: 'module', text: 'Бонус скорости +50% даёт сосед другого вида вместо своего.' },
  { id: 'P5', name: 'Подпорка у устройства', category: 'plant', form: 'module', text: 'Модуль и соседнее устройство весь цикл дают обычный бонус урожая +1 вместо другого вида.' },
  { id: 'P6', name: 'Минилампа', category: 'plant', form: 'module', text: 'Свет непосредственно своему растению. Передача соседу требует «Света от соседей».' },
  { id: 'E1', name: 'Дальний свет', category: 'device', form: 'global', text: 'Лампы дополнительно освещают две клетки на расстоянии 2 по оси q.' },
  { id: 'E2', name: 'Дальний полив', category: 'device', form: 'global', text: 'Поливатели дополнительно поливают две клетки на расстоянии 2 по оси r.' },
  { id: 'E3', name: 'Парная установка', category: 'device', form: 'global', text: 'Выбранный тип устройства заимствует собственную зону соседнего устройства другого типа, без цепочек.' },
  { id: 'E4', name: 'Двойной уход', category: 'device', form: 'module', text: 'В собственной зоне устройства есть и свет, и полив.' },
  { id: 'E5', name: 'Кольцевая насадка', category: 'device', form: 'module', text: 'Собственная зона — 12 клеток второго кольца, без ближайших шести.' },
  { id: 'E6', name: 'Лепестковая насадка', category: 'device', form: 'module', text: 'Собственная зона — ближайшие шесть клеток и шесть углов второго кольца.' },
] as const;
export type EffectId = typeof EFFECTS[number]['id'];
export type ModuleId = 'P4' | 'P5' | 'P6' | 'E4' | 'E5' | 'E6';
export interface EffectOption { effect: EffectId; target: ObjectKind | null }
export interface Module { id: number; effect: ModuleId; at: Cell | null }
export interface EffectsState {
  globals: EffectOption[];
  modules: Module[];
  nextId: number;
  undo: { id: number; at: Cell | null }[] | null;
}
export const emptyEffects = (): EffectsState => ({ globals: [], modules: [], nextId: 1, undo: null });
export const effectDefinition = (id: EffectId) => EFFECTS.find(e => e.id === id)!;
export const hasGlobal = (fx: EffectsState, effect: EffectId, target: ObjectKind): boolean => fx.globals.some(e => e.effect === effect && e.target === target);
export const moduleAt = (fx: EffectsState, cell: Cell): Module | undefined => fx.modules.find(m => m.at && sameCell(m.at, cell));
export const compatible = (effect: EffectId, kind: ObjectKind): boolean => (effectDefinition(effect).category === 'plant') === isPlant(kind);

const unique = (cells: Cell[], size:FieldSize): Cell[] => [...new Map(cells.map(c => [`${c.q},${c.r}`, c])).values()].filter(c => hasCell(size, c));
export function ownDeviceZone(source: PlacedObject, fx: EffectsState, size:FieldSize = 19): Cell[] {
  const module = moduleAt(fx, source)?.effect;
  let zone: Cell[] = [];
  if (module === 'E5') {
    for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === 2) zone.push({ q: source.q + q, r: source.r + r });
  } else {
    zone = neighbors(source);
    if (module === 'E6') zone.push(...neighbors({ q: 0, r: 0 }).map(d => ({ q: source.q + d.q * 2, r: source.r + d.r * 2 })));
  }
  if (source.kind === 'lamp' && hasGlobal(fx, 'E1', 'lamp')) zone.push({ q: source.q - 2, r: source.r }, { q: source.q + 2, r: source.r });
  if (source.kind === 'sprinkler' && hasGlobal(fx, 'E2', 'sprinkler')) zone.push({ q: source.q, r: source.r - 2 }, { q: source.q, r: source.r + 2 });
  return unique(zone,size);
}

export function conditionZone(source: PlacedObject, objects: readonly PlacedObject[], fx: EffectsState, size:FieldSize = 19): Cell[] {
  const zone = ownDeviceZone(source, fx,size);
  if (hasGlobal(fx, 'E3', source.kind)) for (const other of objects) {
    if (!isPlant(other.kind) && other.kind !== source.kind && neighbors(source).some(c => sameCell(c, other))) zone.push(...ownDeviceZone(other, fx,size));
  }
  return unique(zone,size);
}

export function editEffectBindings(fx: EffectsState, command: LayoutCommand): EffectsState {
  if (command.type === 'undo') return fx.undo === null ? fx : { ...fx, modules: fx.modules.map(m => ({ ...m, at: fx.undo!.find(x => x.id === m.id)!.at })), undo: null };
  const undo = fx.modules.map(m => ({ id: m.id, at: m.at && { ...m.at } }));
  return { ...fx, undo, modules: fx.modules.map(m => !m.at || command.type === 'place' || !sameCell(m.at, command.from) ? m
    : { ...m, at: command.type === 'remove' ? null : { ...command.to } }) };
}

const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const natural = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export function isOption(value: unknown): value is EffectOption {
  if (!exact(value, ['effect', 'target'])) return false;
  const def = EFFECTS.find(e => e.id === value.effect);
  if (!def) return false;
  return def.form === 'module' ? value.target === null : def.id === 'E1' ? value.target === 'lamp' : def.id === 'E2' ? value.target === 'sprinkler'
    : def.category === 'plant' ? CATALOG.some(c=>isPlant(c.kind)&&c.kind===value.target) : value.target === 'lamp' || value.target === 'sprinkler';
}
export function isEffects(value: unknown, layout: Layout): value is EffectsState {
  if (!exact(value, ['globals', 'modules', 'nextId', 'undo']) || !Array.isArray(value.globals) || !Array.isArray(value.modules)
    || value.globals.length + value.modules.length > 7 || !natural(value.nextId) || value.nextId < 1
    || !Array.from(value.globals).every(g => isOption(g) && effectDefinition(g.effect).form === 'global')
    || new Set(value.globals.map(g => `${g.effect}:${g.target}`)).size !== value.globals.length) return false;
  const modules = value.modules as Module[];
  const binding = (at: unknown, effect: EffectId, objects: readonly PlacedObject[]): boolean => at === null || (exact(at, ['q', 'r']) && Number.isSafeInteger(at.q) && Number.isSafeInteger(at.r)
    && objects.some(o => sameCell(o, at as unknown as Cell) && compatible(effect, o.kind)));
  if (!Array.from(modules).every(m => exact(m, ['id', 'effect', 'at']) && natural(m.id) && m.id > 0 && m.id < (value.nextId as number)
    && EFFECTS.some(e => e.id === m.effect && e.form === 'module') && binding(m.at, m.effect, layout.objects))
    || new Set(modules.map(m => m.id)).size !== modules.length || new Set(modules.filter(m => m.at).map(m => `${m.at!.q},${m.at!.r}`)).size !== modules.filter(m => m.at).length) return false;
  if (layout.undo === null) return value.undo === null;
  if (!Array.isArray(value.undo) || value.undo.length !== modules.length) return false;
  const seen = new Set<number>(), cells = new Set<string>();
  return Array.from(value.undo).every(b => {
    if (!exact(b, ['id', 'at']) || !natural(b.id) || seen.has(b.id)) return false;
    const m = modules.find(m => m.id === b.id); if (!m || !binding(b.at, m.effect, layout.undo!)) return false;
    const key = b.at ? `${(b.at as Cell).q},${(b.at as Cell).r}` : null;
    if (key && cells.has(key)) return false;
    seen.add(b.id); if (key) cells.add(key); return true;
  });
}
