// Логика k8s-at-home без браузера: генерация, сохранение, мешинг, физика.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACE_TILES } from '../src/atlas.ts';
import { B, SOLID } from '../src/blocks.ts';
import { CHUNK, Generator, HEIGHT, idx, SEA } from '../src/gen.ts';
import { meshChunk } from '../src/mesher.ts';
import { makeBody, raycast, stepBody, type MoveInput } from '../src/physics.ts';
import { decodeEdits, encodeEdits, fromBase64, MAX_PARTS, PART_BYTES, parseMeta, splitParts, toBase64 } from '../src/save.ts';
import { FLOW_RANGE, WaterFlow } from '../src/water.ts';
import { chunkKey, PAD_VOLUME, padIdx, World } from '../src/world.ts';

test('генерация детерминирована: один сид - один мир, другой сид - другой', () => {
  const a = new Generator(42).generate(3, -7);
  const b = new Generator(42).generate(3, -7);
  const c = new Generator(43).generate(3, -7);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('чанк: внизу коренная порода, вода не выше уровня моря, сверху воздух', () => {
  const gen = new Generator(7);
  for (const [cx, cz] of [[0, 0], [-5, 12], [40, -33]] as const) {
    const blocks = gen.generate(cx, cz);
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        assert.equal(blocks[idx(x, 0, z)], B.BEDROCK);
        assert.equal(blocks[idx(x, HEIGHT - 1, z)], B.AIR);
        for (let y = SEA + 1; y < HEIGHT; y++) assert.notEqual(blocks[idx(x, y, z)], B.WATER, `вода на y=${y}`);
      }
    }
  }
});

test('деревья на стыке чанков совпадают: соседний чанк видит ту же крону', () => {
  // Ищем дерево у границы и проверяем, что генерация чанка не зависит от порядка загрузки.
  const w1 = new World(5);
  const w2 = new World(5);
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) w1.load(cx, cz);
  for (let cz = 2; cz >= -2; cz--) for (let cx = 2; cx >= -2; cx--) w2.load(cx, cz);
  for (const [k, c] of w1.chunks) assert.deepEqual(c.blocks, w2.chunks.get(k)!.blocks);
});

test('сохранение: правки переживают кодирование, в том числе в отрицательных чанках', () => {
  const edits = new Map<number, Map<number, number>>([
    [chunkKey(-3, 5), new Map([[idx(0, 1, 2), B.AIR], [idx(15, 95, 15), B.GLASS]])],
    [chunkKey(32767, -32768), new Map([[idx(4, 40, 4), B.SERVER]])],
  ]);
  const bytes = encodeEdits(edits);
  assert.equal(bytes.length, 6 + 2 * 3 + 6 + 3);
  assert.deepEqual(decodeEdits(fromBase64(toBase64(bytes))), edits);
});

test('сохранение: битые байты и чужие id не роняют загрузку', () => {
  const good = encodeEdits(new Map([[chunkKey(1, 1), new Map([[5, B.STONE]])]]));
  assert.deepEqual(decodeEdits(good.subarray(0, good.length - 1)).size, 0); // обрезано - отброшено
  const bad = new Uint8Array(good);
  bad[good.length - 1] = 250; // нет такого блока
  assert.equal(decodeEdits(bad).size, 0);
  assert.equal(decodeEdits(new Uint8Array([1, 2, 3])).size, 0);
});

test('сохранение: части влезают в лимит моста, слишком большой мир - null', () => {
  const parts = splitParts(new Uint8Array(PART_BYTES * 2 + 1))!;
  assert.equal(parts.length, 3);
  // SDK кладёт значение через JSON.stringify: строка + кавычки должны быть меньше 64 КБ.
  for (const p of parts) assert.ok(JSON.stringify(p).length <= 64 * 1024);
  assert.equal(splitParts(new Uint8Array(PART_BYTES * MAX_PARTS + 1)), null);
});

test('сохранение: заголовок проверяется, мусор отвергается, числа зажимаются', () => {
  assert.equal(parseMeta(null), null);
  assert.equal(parseMeta({ v: 2, seed: 1 }), null);
  assert.equal(parseMeta({ v: 1, seed: 'x' }), null);
  const m = parseMeta({ v: 1, seed: 9, time: 5, parts: 999, slot: -4, hotbar: [1, 2], player: [1, 2] })!;
  assert.equal(m.time, 1);
  assert.equal(m.parts, MAX_PARTS);
  assert.equal(m.slot, 0);
  assert.equal(m.hotbar.length, 9);
  assert.ok(Number.isNaN(m.player[0]));
});

function emptyPad(): Uint8Array {
  return new Uint8Array(PAD_VOLUME); // воздух; рамка снизу тоже воздух - так проще считать грани
}

test('мешинг: одиночный блок - 6 граней, два рядом - 10, стекло к стеклу - без внутренней грани', () => {
  const pad = emptyPad();
  pad[padIdx(5, 10, 5)] = B.STONE;
  assert.equal(meshChunk(pad, FACE_TILES).solid.indices.length / 6, 6);
  pad[padIdx(6, 10, 5)] = B.STONE;
  assert.equal(meshChunk(pad, FACE_TILES).solid.indices.length / 6, 10);
  const glass = emptyPad();
  glass[padIdx(5, 10, 5)] = B.GLASS;
  glass[padIdx(6, 10, 5)] = B.GLASS;
  assert.equal(meshChunk(glass, FACE_TILES).solid.indices.length / 6, 10);
  // А листва к листве рисуется: крона сквозная.
  const leaves = emptyPad();
  leaves[padIdx(5, 10, 5)] = B.LEAVES;
  leaves[padIdx(6, 10, 5)] = B.LEAVES;
  assert.equal(meshChunk(leaves, FACE_TILES).solid.indices.length / 6, 12);
});

test('мешинг: блок у края чанка видит соседа в рамке', () => {
  const pad = emptyPad();
  pad[padIdx(0, 10, 0)] = B.STONE;
  pad[padIdx(-1, 10, 0)] = B.STONE; // это блок соседнего чанка
  assert.equal(meshChunk(pad, FACE_TILES).solid.indices.length / 6, 5);
});

test('мешинг: поверхность воды ниже края блока, под водой граней нет', () => {
  const pad = emptyPad();
  pad[padIdx(3, 20, 3)] = B.WATER;
  pad[padIdx(3, 21, 3)] = B.WATER;
  const { water, solid } = meshChunk(pad, FACE_TILES);
  assert.equal(solid.indices.length, 0);
  assert.equal(water.indices.length / 6, 10); // столб из двух: 4 + 4 боковых, верх и низ
  assert.equal(water.maxY, 21.875);
});

test('мешинг: угол под нависающим блоком затенён (AO)', () => {
  const pad = emptyPad();
  pad[padIdx(5, 10, 5)] = B.STONE;
  const lit = meshChunk(pad, FACE_TILES).solid;
  pad[padIdx(6, 11, 5)] = B.STONE; // сосед над верхней гранью
  const shaded = meshChunk(pad, FACE_TILES).solid;
  // Грани идут в порядке +x -x +y -y +z -z, по 12 байт цвета; верхняя - третья.
  const top = (c: Uint8Array): Uint8Array => c.subarray(24, 36);
  assert.equal(Math.min(...top(lit.colors)), 255);
  assert.ok(Math.min(...top(shaded.colors)) < 255);
});

test('мир: правка у границы помечает соседний чанк, рамка берёт блоки соседа', () => {
  const w = new World(1);
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) w.load(cx, cz);
  for (const c of w.chunks.values()) c.dirty = false;
  assert.ok(w.set(-1, 50, 3, B.BRICK)); // x = -1 - последний столбец чанка -1
  assert.equal(w.chunk(-1, 0)!.dirty, true);
  assert.equal(w.chunk(0, 0)!.dirty, true);
  assert.equal(w.chunk(1, 0)!.dirty, false);
  const pad = new Uint8Array(PAD_VOLUME);
  w.padded(0, 0, pad);
  assert.equal(pad[padIdx(-1, 50, 3)], B.BRICK);
  assert.equal(pad[padIdx(0, -1, 0)], B.BEDROCK);
  assert.deepEqual(w.edits.get(chunkKey(-1, 0)), new Map([[idx(15, 50, 3), B.BRICK]]));
  assert.equal(w.set(0, HEIGHT, 0, B.BRICK), false);
});

const IDLE: MoveInput = { forward: 0, strafe: 0, jump: false, down: false, sprint: false, yaw: 0, autoJump: false };

/** Плоский мир: твёрдо всё ниже y = 10, плюс заданные блоки. */
function flat(extra: [number, number, number][] = []): (x: number, y: number, z: number) => boolean {
  const set = new Set(extra.map((p) => p.join()));
  return (x, y, z) => y < 10 || set.has([x, y, z].join());
}
const dry = (): boolean => false;

function run(b: ReturnType<typeof makeBody>, input: MoveInput, seconds: number, solid: ReturnType<typeof flat>): void {
  for (let t = 0; t < seconds; t += 1 / 60) stepBody(b, input, 1 / 60, solid, dry);
}

test('физика: игрок падает и стоит на земле, сквозь стену не проходит', () => {
  const b = makeBody(0.5, 20, 0.5);
  run(b, IDLE, 2, flat());
  assert.ok(b.onGround);
  assert.ok(Math.abs(b.y - 10) < 0.01, `y=${b.y}`);
  // Стена в двух блоках впереди (взгляд вдоль -z).
  const wall = flat([[0, 10, -2], [0, 11, -2]]);
  run(b, { ...IDLE, forward: 1 }, 2, wall);
  assert.ok(b.z > -1 - 0.3 - 0.01, `z=${b.z}`);
  assert.ok(b.z < -0.6, 'дошёл до стены');
});

test('физика: автопрыжок берёт ступеньку в блок, но не стену в два', () => {
  const step = flat([[0, 10, -2]]);
  const b = makeBody(0.5, 10, 0.5);
  run(b, { ...IDLE, forward: 1, autoJump: true }, 2, step);
  assert.ok(b.z < -2, `не забрался: z=${b.z}`);
  const wall = flat([[0, 10, -2], [0, 11, -2]]);
  const c = makeBody(0.5, 10, 0.5);
  run(c, { ...IDLE, forward: 1, autoJump: true }, 2, wall);
  assert.ok(c.z > -1.31, `прошёл стену: z=${c.z}`);
});

test('луч: первый твёрдый блок и грань, в которую попали', () => {
  const solid = (x: number, y: number, z: number): boolean => x === 0 && y === 10 && z === -3;
  const hit = raycast(0.5, 10.5, 0.5, 0, 0, -1, 6, solid)!;
  assert.deepEqual([hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz], [0, 10, -3, 0, 0, 1]);
  assert.equal(raycast(0.5, 10.5, 0.5, 0, 0, -1, 2, solid), null);
  assert.equal(SOLID[B.WATER], 0);
});

/** Маленький мир для воды: всё твёрдое, кроме заданных клеток. */
function box(cells: Record<string, number>): { get(x: number, y: number, z: number): number; set(x: number, y: number, z: number, id: number): boolean; at(k: string): number } {
  const m = new Map(Object.entries(cells));
  return {
    get: (x, y, z) => m.get(`${x},${y},${z}`) ?? B.STONE,
    set: (x, y, z, id) => (m.set(`${x},${y},${z}`, id), true),
    at: (k) => m.get(k) ?? B.STONE,
  };
}

test('вода: из озера затекает в пробитую дыру и дальше по воздушному ходу', () => {
  // Над клеткой (0,5,0) - вода, сбоку от неё ход из двух клеток воздуха.
  const w = box({ '0,6,0': B.WATER, '0,5,0': B.AIR, '1,5,0': B.AIR, '2,5,0': B.AIR });
  const flow = new WaterFlow();
  flow.wake(w, 0, 5, 0);
  for (let i = 0; i < 10; i++) flow.step(w, 24);
  assert.equal(w.at('0,5,0'), B.WATER);
  assert.equal(w.at('1,5,0'), B.WATER);
  assert.equal(w.at('2,5,0'), B.WATER);
  assert.equal(flow.pending, 0);
});

test('вода: вбок не дальше FLOW_RANGE; сама по себе не течёт', () => {
  const cells: Record<string, number> = { '0,10,0': B.WATER };
  for (let x = 1; x <= 20; x++) cells[`${x},10,0`] = B.AIR;
  const w = box(cells);
  const flow = new WaterFlow();
  flow.step(w, 100);
  assert.equal(w.at('1,10,0'), B.AIR, 'без правки вода стоит');
  flow.wake(w, 1, 10, 0);
  for (let i = 0; i < 50; i++) flow.step(w, 24);
  assert.equal(w.at(`${FLOW_RANGE},10,0`), B.WATER);
  assert.equal(w.at(`${FLOW_RANGE + 1},10,0`), B.AIR);
});

test('вода: падает вниз сколько угодно и вбок с падения не растекается', () => {
  const cells: Record<string, number> = { '0,10,0': B.WATER, '1,10,0': B.AIR, '2,9,0': B.AIR };
  for (let y = 0; y < 10; y++) cells[`1,${y},0`] = B.AIR;
  const w = box(cells);
  const flow = new WaterFlow();
  flow.wake(w, 1, 10, 0);
  for (let i = 0; i < 50; i++) flow.step(w, 24);
  for (let y = 0; y <= 10; y++) assert.equal(w.at(`1,${y},0`), B.WATER, `y=${y}`);
  assert.equal(w.at('2,9,0'), B.AIR, 'падающая вода растеклась вбок');
});

test('мешинг: у полного блока воды рядом с опущенной поверхностью - полоска, без щели', () => {
  const pad = emptyPad();
  pad[padIdx(3, 20, 3)] = B.WATER; // над ним вода - он полный
  pad[padIdx(3, 21, 3)] = B.WATER;
  pad[padIdx(4, 20, 3)] = B.WATER; // над ним воздух - поверхность опущена
  const { water } = meshChunk(pad, FACE_TILES);
  // Ищем грань +x у (3, 20): все её вершины на x = 4 и y от 20,875 до 21.
  let strip = false;
  for (let f = 0; f < water.positions.length / 12; f++) {
    const v = water.positions.subarray(f * 12, f * 12 + 12);
    const xs = [v[0]!, v[3]!, v[6]!, v[9]!], ys = [v[1]!, v[4]!, v[7]!, v[10]!];
    if (xs.every((x) => x === 4) && Math.min(...ys) === 20.875 && Math.max(...ys) === 21) strip = true;
  }
  assert.ok(strip, 'нет полоски воды над соседом');
});
