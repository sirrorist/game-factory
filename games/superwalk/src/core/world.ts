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
  const PLAY_RADIUS = 55.0;        // Радиус размещения деревьев внутри 60-метровой арены

  // 1. Деревья-ели (48 штук в диапазоне 40-60 препятствий по ТЗ)
  let attempts = 0;
  while (trees.length < 48 && attempts < 800) {
    attempts++;
    const angle = rnd() * Math.PI * 2;
    const dist = SPAWN_CLEAR_RADIUS + rnd() * (PLAY_RADIUS - SPAWN_CLEAR_RADIUS);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    // Проверяем минимальную дистанцию между деревьями (3.2 м)
    const tooClose = trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2);
    if (!tooClose) {
      const radius = 0.65;
      const scale = 0.85 + rnd() * 0.35;
      const tree: TreeInstance = { x, z, radius, scale };
      trees.push(tree);
      obstacles.push({ x, z, radius, height: 5.0 });
    }
  }

  // 2. Камни полностью исключены из мира по ТЗ арены в стиле Megabonk (rocks = [], boundaryRocks = [])
  // Препятствиями арены служат стройные деревья-ели, а границей — круговой силовой барьер (R = 60.0 м).

  // 3. Декоративные пучки травы (240 штук) для живости поляны
  for (let i = 0; i < 240; i++) {
    const angle = rnd() * Math.PI * 2;
    const dist = rnd() * (PLAY_RADIUS + 2.0);
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
