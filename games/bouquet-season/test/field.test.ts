import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldCells, neighbors, sameCell, cellAt, cellCenter, cellCorners } from '../src/core/field.ts';

test('Утверждённый асимметричный контур: точные строки, 19 входят в 37, шесть полноокружённых клеток', () => {
  assert.deepEqual(fieldCells(19).map(c => [c.q, c.r]), [
    [2,-2],[-1,-1],[0,-1],[1,-1],[2,-1],[-2,0],[-1,0],[0,0],[1,0],[2,0],
    [-3,1],[-2,1],[-1,1],[0,1],[1,1],[-3,2],[-2,2],[-1,2],[0,2],
  ]);
  assert.equal(fieldCells(37).length, 37);
  assert.equal(new Set(fieldCells(37).map(c => `${c.q},${c.r}`)).size, 37);
  assert.deepEqual(fieldCells(37).filter(c => c.r === -2).map(c => c.q), [-1,2,3]);
  for (const size of [19,37] as const) {
    const cells = fieldCells(size);
    for (const c of fieldCells(19)) assert.ok(cells.some(x => sameCell(c,x)));
    assert.equal(cells.filter(c => neighbors(c).every(n => cells.some(x => sameCell(n,x)))).length, size === 19 ? 6 : 15);
    const seen = new Set<string>(); const queue = [cells[0]!];
    for (const c of queue) for (const n of neighbors(c)) {
      const key = `${n.q},${n.r}`;
      if (!seen.has(key) && cells.some(x => sameCell(n,x))) { seen.add(key);queue.push(n); }
    }
    assert.equal(seen.size, size);
  }
});
test('Попадание: все центры и внутренние точки, вырезы контура и внешняя область', () => {
  for (const size of [19,37] as const) for (const c of fieldCells(size)) {
    const center = cellCenter(c);
    assert.deepEqual(cellAt(center,size),c);
    for (const corner of cellCorners(c)) assert.deepEqual(cellAt({ x: center.x + .9*(corner.x-center.x), y: center.y+.9*(corner.y-center.y) },size),c);
  }
  for (const c of [{q:0,r:-2},{q:1,r:-2},{q:-3,r:0},{q:3,r:0}]) assert.equal(cellAt(cellCenter(c),19),null);
  assert.equal(cellAt({x:1e6,y:0},37),null);
  assert.equal(cellAt({x:NaN,y:Infinity},19),null);
});
