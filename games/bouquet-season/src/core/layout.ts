import { hasCell, sameCell, type Cell, type FieldSize } from './field.ts';

export const CATALOG = [
  { kind: 'carnation', name: 'Гвоздика', care: 'Нужен полив · свет ускоряет рост', color: 0xcd6876 },
  { kind: 'chrysanthemum', name: 'Хризантема', care: 'Нужен свет · полив ускоряет рост', color: 0xe7bb52 },
  { kind: 'rose', name: 'Роза', care: 'Нужен полив · свет ускоряет рост', color: 0xbe4e64 },
  { kind: 'tulip', name: 'Тюльпан', care: 'Нужен свет · полив ускоряет рост', color: 0xe69354 },
  { kind: 'gerbera', name: 'Гербера', care: 'Нужен свет · полив ускоряет рост', color: 0xe46c4a },
  { kind: 'lily', name: 'Лилия', care: 'Нужен полив · свет ускоряет рост', color: 0xf5ead5 },
  { kind: 'lamp', name: 'Лампа', care: 'Свет на шести соседних клетках', color: 0xeac66b },
  { kind: 'sprinkler', name: 'Поливатель', care: 'Полив на шести соседних клетках', color: 0x639fa7 },
] as const;
export type ObjectKind = typeof CATALOG[number]['kind'];
export type PlantKind = Exclude<ObjectKind,'lamp'|'sprinkler'>;
export interface PlacedObject extends Cell { kind: ObjectKind; adaptation: 0 | 1 }
export interface Layout { objects: PlacedObject[]; undo: PlacedObject[] | null }
export type LayoutCommand = { type: 'place'; kind: ObjectKind; to: Cell }
  | { type: 'move'; from: Cell; to: Cell } | { type: 'remove'; from: Cell } | { type: 'undo' };
export const isPlant = (kind: ObjectKind): kind is PlantKind => kind !== 'lamp' && kind !== 'sprinkler';
export const objectName = (kind: ObjectKind): string => CATALOG.find(c => c.kind === kind)!.name;
export const waterPlant = (kind: PlantKind): boolean => ['carnation','rose','lily'].includes(kind);
export function isObjects(value: unknown, size:FieldSize = 19, open:readonly ObjectKind[] = CATALOG.map(c=>c.kind)): value is PlacedObject[] {
  if (!Array.isArray(value) || value.length > size) return false;
  const occupied = new Set<string>();
  return Array.from(value).every(o => {
    if (!o || typeof o !== 'object' || Object.keys(o).sort().join() !== 'adaptation,kind,q,r'
      || !open.includes(o.kind) || !Number.isSafeInteger(o.q) || !Number.isSafeInteger(o.r)
      || !hasCell(size,o) || (o.adaptation !== 0 && o.adaptation !== 1) || (!isPlant(o.kind) && o.adaptation !== 0)) return false;
    const key = `${o.q},${o.r}`;
    if (occupied.has(key)) return false;
    occupied.add(key); return true;
  });
}
export function changeLayout(layout: Layout, command: LayoutCommand, size:FieldSize = 19): Layout {
  if (command.type === 'undo') return layout.undo ? { objects: structuredClone(layout.undo), undo: null } : layout;
  if (command.type !== 'remove') {
    if (!hasCell(size,command.to)) throw new Error('Эта клетка за пределами участка.');
    if (command.type === 'move' && sameCell(command.from,command.to)) return layout;
    if (layout.objects.some(o => sameCell(o,command.to))) throw new Error('Клетка уже занята.');
  }
  let objects: PlacedObject[];
  if (command.type === 'place') {
    if (!CATALOG.some(c => c.kind === command.kind)) throw new Error('Объект ещё не открыт.');
    objects = [...layout.objects,{ kind: command.kind,q:command.to.q,r:command.to.r,adaptation:0 }];
  } else {
    const source = layout.objects.find(o => sameCell(o,command.from));
    if (!source) throw new Error('Объект не найден.');
    objects = command.type === 'remove' ? layout.objects.filter(o => o !== source)
      : layout.objects.map(o => o === source ? { ...o,q:command.to.q,r:command.to.r,adaptation:isPlant(o.kind) ? 1 : 0 } : o);
  }
  return { objects,undo:structuredClone(layout.objects) };
}
