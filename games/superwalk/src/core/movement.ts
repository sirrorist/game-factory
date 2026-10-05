// Чистая логика движения и физики героя (без Three.js и DOM).
// Параметры из DESIGN.md, раздел 5.1 (Лис: скорость 6.0 м/с, прыжок 1.6 м).
// Координатная сетка Three.js: -Z - вперёд, +X - вправо, +Y - вверх.

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  yaw: number;
  /** Количество оставшихся прыжков в воздухе (для Пружинных башмаков) */
  airJumpsLeft?: number;
  /** Была ли нажата клавиша прыжка на прошлом шаге (для фронта нажатия) */
  jumpPressedLast?: boolean;
}

export interface MovementInput {
  /** Движение вперёд (1) / назад (-1) */
  forward: number;
  /** Движение вправо (1) / влево (-1) */
  strafe: number;
  /** Нажатие прыжка */
  jump: boolean;
  /** Направление взгляда камеры (радианы) */
  yaw: number;
}

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

export interface PlayerParams {
  speed: number;
  jumpHeight: number;
  gravity: number;
  radius: number;
  arenaRadius?: number;
  /** Максимальное число прыжков в воздухе (0 по умолчанию, 1+ с башмаками) */
  maxAirJumps?: number;
}

export const DEFAULT_PLAYER_PARAMS: PlayerParams = {
  speed: 6.0,       // м/с
  jumpHeight: 1.6,  // м
  gravity: 24.0,    // м/с^2
  radius: 0.45,     // радиус коллизии героя
  arenaRadius: 65.0,// радиус игровой арены "Солнечные холмы"
  maxAirJumps: 0,
};

/**
 * Аналитическая высота ландшафта "Солнечные холмы" в точке (x, z).
 * Соответствует геометрии холмов в Three.js.
 */
export function getTerrainHeight(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  const factor = Math.min(dist / 40, 1.0);
  return (Math.sin(x * 0.08) * Math.cos(z * 0.08) * 1.6 + Math.sin(x * 0.03 + z * 0.04) * 1.0) * factor;
}

/**
 * Рассчитывает один физический шаг перемещения игрока строго через dt.
 * Стандарт Three.js: камера смотрит на героя сзади (-Z - вперёд, +X - вправо).
 * Клавиша D (strafe=1) перемещает вправо по экрану (+X при yaw=0).
 * Клавиша A (strafe=-1) перемещает влево по экрану (-X при yaw=0).
 */
export function stepPlayer(
  state: PlayerState,
  input: MovementInput,
  dt: number,
  params: PlayerParams = DEFAULT_PLAYER_PARAMS,
  obstacles: readonly Obstacle[] = [],
  getGroundHeight: (x: number, z: number) => number = () => 0,
): PlayerState {
  // Ограничиваем dt потолком 0.05 с на случай лагов/фонового режима (GAME-TZ.md)
  const safeDt = Math.min(Math.max(dt, 0), 0.05);

  const len = Math.hypot(input.strafe, input.forward);
  let moveX = 0;
  let moveZ = 0;

  if (len > 0.0001) {
    const scale = len > 1.0 ? 1.0 / len : 1.0;
    const s = input.strafe * scale;
    const f = input.forward * scale;

    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);

    // Вперёд от камеры: (-sin, -cos)
    // Вправо от камеры: (+cos, -sin)
    // D (s=1): +X (вправо), A (s=-1): -X (влево)
    // W (f=1): -Z (вперёд вглубь экрана), S (f=-1): +Z (назад к камере)
    moveX = (-f * sin + s * cos) * params.speed;
    moveZ = (-f * cos - s * sin) * params.speed;
  }

  let nextX = state.x + moveX * safeDt;
  let nextZ = state.z + moveZ * safeDt;

  // Коллизии с препятствиями (камни, деревья) - скольжение по контуру
  for (const obs of obstacles) {
    const minDist = obs.radius + params.radius;
    const dx = nextX - obs.x;
    const dz = nextZ - obs.z;
    const dist = Math.hypot(dx, dz);
    if (dist < minDist && dist > 0.0001) {
      const overlap = minDist - dist;
      nextX += (dx / dist) * overlap;
      nextZ += (dz / dist) * overlap;
    }
  }

  // Ограничение игровой арены (не даёт лису выйти за край карты)
  if (params.arenaRadius && params.arenaRadius > 0) {
    const currentDist = Math.hypot(nextX, nextZ);
    if (currentDist > params.arenaRadius) {
      nextX = (nextX / currentDist) * params.arenaRadius;
      nextZ = (nextZ / currentDist) * params.arenaRadius;
    }
  }

  // Высота поверхности под ногами
  const groundY = getGroundHeight(nextX, nextZ);

  // Вертикальная физика и прыжок
  const vy0 = Math.sqrt(2 * params.gravity * params.jumpHeight);
  let nextVy = state.vy;
  let nextY = state.y;
  let nextGrounded = state.grounded;
  const maxAirJumps = params.maxAirJumps ?? 0;
  let nextAirJumpsLeft = state.airJumpsLeft !== undefined ? state.airJumpsLeft : maxAirJumps;

  if (nextGrounded) {
    nextAirJumpsLeft = maxAirJumps;
    if (input.jump) {
      nextVy = vy0;
      nextGrounded = false;
    }
  } else {
    // В воздухе: проверка двойного прыжка по фронту нажатия (spring_boots)
    const jumpTriggeredNow = input.jump && !state.jumpPressedLast;
    if (jumpTriggeredNow && nextAirJumpsLeft > 0) {
      nextVy = vy0;
      nextAirJumpsLeft--;
    }
  }

  if (!nextGrounded) {
    const currentVy = nextVy;
    nextVy -= params.gravity * safeDt;
    nextY += (currentVy + nextVy) * 0.5 * safeDt;
    if (nextY <= groundY) {
      nextY = groundY;
      nextVy = 0;
      nextGrounded = true;
      nextAirJumpsLeft = maxAirJumps;
    }
  } else {
    nextY = groundY;
  }

  return {
    x: nextX,
    y: nextY,
    z: nextZ,
    vy: nextVy,
    grounded: nextGrounded,
    yaw: input.yaw,
    airJumpsLeft: nextAirJumpsLeft,
    jumpPressedLast: input.jump,
  };
}
