// Физика игрока и луч до блока. Без Three и DOM: проверяется тестами в node.

export const PLAYER_HALF = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const EYE = 1.62;

const GRAVITY = 28;
const JUMP_SPEED = 8.6; // ≈ 1,3 блока: на блок запрыгнуть можно, на два - нет
const EPS = 1e-3;

export interface Body {
  /** Центр ступней. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  flying: boolean;
  inWater: boolean;
  headInWater: boolean;
}

export interface MoveInput {
  /** Вперёд-назад и вбок, от -1 до 1. */
  forward: number;
  strafe: number;
  jump: boolean;
  down: boolean;
  sprint: boolean;
  /** Поворот камеры: при yaw = 0 взгляд вдоль -z. */
  yaw: number;
  /** Сам запрыгивать на ступеньку в блок - на телефоне прыгать кнопкой неудобно. */
  autoJump: boolean;
}

export type BlockTest = (x: number, y: number, z: number) => boolean;

export function makeBody(x: number, y: number, z: number): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, flying: false, inWater: false, headInWater: false };
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/** Пересекает ли тело игрока в точке (x, y, z) хоть один твёрдый блок. */
export function bodyCollides(x: number, y: number, z: number, solid: BlockTest): boolean {
  for (let by = Math.floor(y + EPS); by <= Math.floor(y + PLAYER_HEIGHT - EPS); by++) {
    for (let bz = Math.floor(z - PLAYER_HALF + EPS); bz <= Math.floor(z + PLAYER_HALF - EPS); bz++) {
      for (let bx = Math.floor(x - PLAYER_HALF + EPS); bx <= Math.floor(x + PLAYER_HALF - EPS); bx++) {
        if (solid(bx, by, bz)) return true;
      }
    }
  }
  return false;
}

/**
 * Сдвинуть тело по одной оси. Шаг меньше блока, поэтому упереться можно только
 * в слой блоков на переднем крае - его и проверяем. true - упёрлись.
 */
function moveAxis(b: Body, axis: 0 | 1 | 2, delta: number, solid: BlockTest): boolean {
  if (delta === 0) return false;
  if (axis === 0) b.x += delta;
  else if (axis === 1) b.y += delta;
  else b.z += delta;
  const minX = b.x - PLAYER_HALF, maxX = b.x + PLAYER_HALF;
  const minY = b.y, maxY = b.y + PLAYER_HEIGHT;
  const minZ = b.z - PLAYER_HALF, maxZ = b.z + PLAYER_HALF;
  const lead = Math.floor(delta > 0
    ? (axis === 0 ? maxX : axis === 1 ? maxY : maxZ) - EPS
    : (axis === 0 ? minX : axis === 1 ? minY : minZ) + EPS);
  const r0 = [Math.floor(minX + EPS), Math.floor(minY + EPS), Math.floor(minZ + EPS)];
  const r1 = [Math.floor(maxX - EPS), Math.floor(maxY - EPS), Math.floor(maxZ - EPS)];
  r0[axis] = lead;
  r1[axis] = lead;
  for (let by = r0[1]!; by <= r1[1]!; by++) {
    for (let bz = r0[2]!; bz <= r1[2]!; bz++) {
      for (let bx = r0[0]!; bx <= r1[0]!; bx++) {
        if (!solid(bx, by, bz)) continue;
        const edge = delta > 0 ? lead - EPS : lead + 1 + EPS;
        if (axis === 0) b.x = delta > 0 ? edge - PLAYER_HALF : edge + PLAYER_HALF;
        else if (axis === 1) b.y = delta > 0 ? edge - PLAYER_HEIGHT : edge;
        else b.z = delta > 0 ? edge - PLAYER_HALF : edge + PLAYER_HALF;
        return true;
      }
    }
  }
  return false;
}

/** Один шаг физики. dt - секунды, не больше ~0,05 (ограничивает вызывающий). */
export function stepBody(b: Body, input: MoveInput, dt: number, solid: BlockTest, water: BlockTest): void {
  b.inWater = water(Math.floor(b.x), Math.floor(b.y + 0.4), Math.floor(b.z));
  b.headInWater = water(Math.floor(b.x), Math.floor(b.y + EYE), Math.floor(b.z));

  let speed = b.flying ? (input.sprint ? 20 : 10) : input.sprint ? 5.8 : 4.3;
  if (b.inWater && !b.flying) speed *= 0.55;
  let fx = input.forward, sx = input.strafe;
  const len = Math.hypot(fx, sx);
  if (len > 1) { fx /= len; sx /= len; }
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  const tx = (-sin * fx + cos * sx) * speed;
  const tz = (-cos * fx - sin * sx) * speed;
  const accel = b.flying ? 40 : b.onGround ? 60 : b.inWater ? 20 : 14;
  b.vx = approach(b.vx, tx, accel * dt);
  b.vz = approach(b.vz, tz, accel * dt);

  if (b.flying) {
    const ty = ((input.jump ? 1 : 0) - (input.down ? 1 : 0)) * (input.sprint ? 14 : 8);
    b.vy = approach(b.vy, ty, 40 * dt);
  } else if (b.inWater) {
    b.vy -= 7 * dt;
    if (input.jump) b.vy = Math.min(b.vy + 22 * dt, 3.2);
    b.vy = Math.max(b.vy, -3);
  } else {
    if (input.jump && b.onGround) b.vy = JUMP_SPEED;
    b.vy = Math.max(b.vy - GRAVITY * dt, -50);
  }

  // Подшаги: за кадр тело не должно пролететь сквозь блок.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt / 0.4));
  const h = dt / steps;
  let bumped = false;
  b.onGround = false;
  for (let i = 0; i < steps; i++) {
    if (moveAxis(b, 1, b.vy * h, solid)) {
      if (b.vy < 0) b.onGround = true;
      b.vy = 0;
    }
    if (moveAxis(b, 0, b.vx * h, solid)) { bumped = true; b.vx = 0; }
    if (moveAxis(b, 2, b.vz * h, solid)) { bumped = true; b.vz = 0; }
  }
  if (!b.onGround && b.vy <= 0 && !b.flying) {
    // Стоим ровно на блоке: проверка на волосок ниже ступней.
    b.onGround = bodyCollides(b.x, b.y - 0.01, b.z, solid) && !bodyCollides(b.x, b.y, b.z, solid);
  }
  if (b.onGround && b.flying) b.flying = false;

  if (input.autoJump && bumped && b.onGround && !b.flying && len > 0.3) {
    // Впереди стенка в один блок, а над ней свободно - запрыгиваем.
    const ax = b.x + (-sin * fx + cos * sx) * 0.6 / Math.max(len, 1);
    const az = b.z + (-cos * fx - sin * sx) * 0.6 / Math.max(len, 1);
    if (bodyCollides(ax, b.y, az, solid) && !bodyCollides(ax, b.y + 1.05, az, solid) && !bodyCollides(b.x, b.y + 1.05, b.z, solid)) {
      b.vy = JUMP_SPEED;
    }
  }
}

export interface Hit {
  x: number;
  y: number;
  z: number;
  /** Нормаль грани, в которую попал луч: туда ставится новый блок. */
  nx: number;
  ny: number;
  nz: number;
  dist: number;
}

/** Луч по вокселям (Amanatides-Woo). Возвращает первый блок, для которого pick = true. */
export function raycast(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  max: number, pick: BlockTest,
): Hit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(1 / dx) : Infinity;
  const tdy = sy ? Math.abs(1 / dy) : Infinity;
  const tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  while (t <= max) {
    if (pick(x, y, z)) return { x, y, z, nx, ny, nz, dist: t };
    if (tmx < tmy && tmx < tmz) {
      x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0;
    } else if (tmy < tmz) {
      y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0;
    } else {
      z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz;
    }
  }
  return null;
}
