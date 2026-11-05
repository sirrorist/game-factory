import type { ElementType } from './types.ts';
export interface EnemyEffects { poison: number; slow: number; damageBuffer: number }
export const createEffects = (): EnemyEffects => ({ poison: 0, slow: 0, damageBuffer: 0 });
export function spellImpact(state: EnemyEffects, element: ElementType, baseDamage: number): number {
  if (element === 'poison') { state.poison = Math.max(state.poison, 4); return Math.round(baseDamage * 0.45); }
  if (element === 'ice') { state.slow = Math.max(state.slow, 3.5); return Math.round(baseDamage * 0.8); }
  return baseDamage;
}
export function tickEffects(state: EnemyEffects, dt: number): number {
  if (!Number.isFinite(dt) || dt < 0) return 0;
  state.damageBuffer += Math.min(state.poison, dt) * 6;
  state.poison = Math.max(0, state.poison - dt);
  state.slow = Math.max(0, state.slow - dt);
  const damage = Math.floor(state.damageBuffer + 1e-8);
  state.damageBuffer -= damage;
  return damage;
}
