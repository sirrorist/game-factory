export interface Cell { readonly q: number; readonly r: number }
export interface Point { x: number; y: number }
export type FieldSize = 19 | 37;
const row = (r: number, from: number, to: number): Cell[] =>
  Array.from({ length: to - from + 1 }, (_, i) => Object.freeze({ q: from + i, r }));
// Точный контур DESIGN.md; это не правильный шестиугольник радиуса 2/3.
const initial = Object.freeze([...row(-2, 2, 2), ...row(-1, -1, 2), ...row(0, -2, 2), ...row(1, -3, 1), ...row(2, -3, 0)]);
const expanded = Object.freeze([...row(-3, 2, 3), ...row(-2, -1, -1), ...row(-2, 2, 3), ...row(-1, -2, 3), ...row(0, -3, 3), ...row(1, -4, 2), ...row(2, -4, 1), ...row(3, -4, 0), ...row(4, -3, -3)]);
const directions: readonly Cell[] = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
export const sameCell = (a: Cell, b: Cell): boolean => a.q === b.q && a.r === b.r;
export const fieldCells = (size: FieldSize): readonly Cell[] => size === 19 ? initial : expanded;
export const hasCell = (size: FieldSize, cell: Cell): boolean => fieldCells(size).some(c => sameCell(c, cell));
export const neighbors = (cell: Cell): Cell[] => directions.map(d => ({ q: cell.q + d.q, r: cell.r + d.r }));
// Радиус в мировых единицах; наклонённая плоскость с вертикальными силуэтами.
export const RADIUS = 40;
export const TILT = .8;
export function cellCenter(cell: Cell): Point {
  return { x: Math.sqrt(3) * RADIUS * (cell.q + cell.r / 2), y: 1.5 * RADIUS * cell.r * TILT };
}
export function cellCorners(cell: Cell): Point[] {
  const center = cellCenter(cell);
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60 - 30) * Math.PI / 180;
    return { x: center.x + RADIUS * Math.cos(a), y: center.y + RADIUS * Math.sin(a) * TILT };
  });
}
export function cellAt(point: Point, size: FieldSize): Cell | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const y = point.y / TILT;
  const q = (Math.sqrt(3) / 3 * point.x - y / 3) / RADIUS;
  const r = 2 / 3 * y / RADIUS;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return fieldCells(size).find(c => c.q === rq && c.r === rr) ?? null;
}
