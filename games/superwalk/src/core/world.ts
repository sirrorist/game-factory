// Чистая генерация мира "Солнечные холмы" (без Three.js и DOM).
// Параметры из DESIGN.md, раздел 6:
// 140x140 м, мягкие холмы, 40-60 камней и деревьев как препятствия, скалы по краям.

import type { Obstacle } from './movement.ts';

export interface TreeInstance {
  x: number;
  z: number;
  radius: number;
  scale: number;
}

export interface RockInstance {
  x: number;
  z: number;
  radius: number;
  scale: number;
  rotY: number;
}

export interface GrassClump {
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

export interface WorldData {
  trees: readonly TreeInstance[];
  rocks: readonly RockInstance[];
  boundaryRocks: readonly RockInstance[];
  grassClumps: readonly GrassClump[];
  /** Полный список коллизий для физики stepPlayer */
  obstacles: readonly Obstacle[];
}

/** Простой детерминированный PRNG (Mulberry32) для одинаковой генерации */
export function createPrng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateWorld(seed = 1337): WorldData {
  const rnd = createPrng(seed);

  const trees: TreeInstance[] = [];
  const rocks: RockInstance[] = [];
  const obstacles: Obstacle[] = [];
  const boundaryRocks: RockInstance[] = [];
  const grassClumps: GrassClump[] = [];

  const SPAWN_CLEAR_RADIUS = 7.0; // Свободная зона вокруг (0,0) для чистого старта
  const PLAY_RADIUS = 60.0;        // Радиус активной игровой зоны

  // 1. Деревья (36 штук)
  let attempts = 0;
  while (trees.length < 36 && attempts < 500) {
    attempts++;
    const angle = rnd() * Math.PI * 2;
    const dist = SPAWN_CLEAR_RADIUS + rnd() * (PLAY_RADIUS - SPAWN_CLEAR_RADIUS);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    // Проверяем минимальную дистанцию между деревьями (3.5 м)
    const tooClose = trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.5);
    if (!tooClose) {
      const radius = 0.65;
      const scale = 0.85 + rnd() * 0.35;
      const tree: TreeInstance = { x, z, radius, scale };
      trees.push(tree);
      obstacles.push({ x, z, radius });
    }
  }

  // 2. Внутренние камни (22 штуки)
  attempts = 0;
  while (rocks.length < 22 && attempts < 500) {
    attempts++;
    const angle = rnd() * Math.PI * 2;
    const dist = SPAWN_CLEAR_RADIUS + rnd() * (PLAY_RADIUS - SPAWN_CLEAR_RADIUS);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    const tooCloseTree = trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.0);
    const tooCloseRock = rocks.some((r) => Math.hypot(r.x - x, r.z - z) < 4.0);
    if (!tooCloseTree && !tooCloseRock) {
      const radius = 0.9 + rnd() * 0.5;
      const scale = radius;
      const rotY = rnd() * Math.PI * 2;
      const rock: RockInstance = { x, z, radius, scale, rotY };
      rocks.push(rock);
      obstacles.push({ x, z, radius });
    }
  }

  // 3. Кольцо скал по периметру (радиус 63..67 м, 68 массивных валунов, образующих сплошную стену)
  const BOUNDARY_COUNT = 68;
  for (let i = 0; i < BOUNDARY_COUNT; i++) {
    const angle = (i / BOUNDARY_COUNT) * Math.PI * 2 + (rnd() - 0.5) * 0.05;
    const dist = 64.0 + (rnd() - 0.5) * 3.0;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const radius = 3.6;
    const scale = 3.2 + rnd() * 0.8;
    const rotY = rnd() * Math.PI * 2;
    const boundaryRock: RockInstance = { x, z, radius, scale, rotY };
    boundaryRocks.push(boundaryRock);
    obstacles.push({ x, z, radius });
  }

  // 4. Декоративные пучки травы (240 штук) для живости поляны
  for (let i = 0; i < 240; i++) {
    const angle = rnd() * Math.PI * 2;
    const dist = rnd() * PLAY_RADIUS;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    grassClumps.push({
      x,
      z,
      scale: 0.6 + rnd() * 0.6,
      rotY: rnd() * Math.PI * 2,
    });
  }

  return {
    trees,
    rocks,
    boundaryRocks,
    grassClumps,
    obstacles,
  };
}
