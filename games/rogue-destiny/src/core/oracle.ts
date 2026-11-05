import type { WeightClass } from './types.ts';

export interface OracleChallenge { awareness: number; remaining: number; nodes: boolean[]; status: 'waiting' | 'active' | 'won' | 'lost' }
export const createOracleChallenge = (): OracleChallenge => ({ awareness: 0, remaining: 20, nodes: [true, true, true], status: 'waiting' });
export function strikeOracleNode(state: OracleChallenge, index: number): boolean {
  if (state.status !== 'active' || !state.nodes[index]) return false;
  state.nodes[index] = false;
  if (state.nodes.every((active) => !active)) state.status = 'won';
  return true;
}
export function tickOracle(state: OracleChallenge, dt: number): void {
  if (state.status !== 'active' || !Number.isFinite(dt) || dt < 0) return;
  state.remaining = Math.max(0, state.remaining - dt);
  if (state.remaining <= 1e-8) { state.remaining = 0; state.status = 'lost'; }
}

export const ORACLE_ARENA_RADIUS = 5.6;
/** Иллюзия имеет собственную круглую границу, видимую в сцене. */
export function moveInNightmare(x: number, z: number, dx: number, dz: number, cx: number, cz: number): { x: number; z: number } {
  const nx = x + dx - cx, nz = z + dz - cz;
  const distance = Math.hypot(nx, nz);
  const factor = distance > ORACLE_ARENA_RADIUS ? ORACLE_ARENA_RADIUS / distance : 1;
  return { x: cx + nx * factor, z: cz + nz * factor };
}

/** Оракул смотрит ко входу (-X): шум и передний сектор выдают героя. */
export function observeOracle(state: OracleChallenge, dt: number, dx: number, dz: number, weight: WeightClass, sprinting: boolean): boolean {
  if (state.status !== 'waiting' || !Number.isFinite(dt) || dt <= 0) return false;
  const distance = Math.hypot(dx,dz);
  const radius = weight === 'heavy' ? 7 : weight === 'medium' ? 6 : 4.5;
  const inSight = dx < 0 && -dx >= distance * 0.35;
  const noisy = sprinting || weight === 'heavy';
  const noticed = distance < radius && (inSight || noisy && distance < 3.5);
  state.awareness = Math.max(0, Math.min(1, state.awareness + dt * (noticed ? (noisy ? 1.25 : 0.6) : -0.8)));
  return state.awareness >= 1;
}
export function oracleStealthChance(weight: WeightClass): number {
  return weight === 'light' ? 0.95 : weight === 'medium' ? 0.8 : 0.4;
}
