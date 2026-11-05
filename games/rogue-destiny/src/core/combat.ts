/** Таймеры боя используют игровое время, поэтому пауза не съедает окно защиты. */
import { fatigueModifiers } from './fatigue.ts';
import type { WeightClass } from './types.ts';
export interface CombatState { dodge: number; cooldown: number; parry: number; guarding: boolean }
export const createCombat = (): CombatState => ({ dodge: 0, cooldown: 0, parry: 0, guarding: false });
export function tickCombat(state: CombatState, dt: number): void {
  if (!Number.isFinite(dt) || dt < 0) return;
  state.dodge = Math.max(0, state.dodge - dt);
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.parry = Math.max(0, state.parry - dt);
}
export function beginDodge(state: CombatState, fatigue: number, weight: WeightClass): number {
  if (state.cooldown > 0 || fatigue >= 85) return 0;
  state.dodge = 0.24;
  state.cooldown = weight === 'heavy' ? 1.25 : 0.85;
  state.guarding = false;
  state.parry = 0;
  return (weight === 'light' ? 13 : weight === 'medium' ? 10 : 7) * fatigueModifiers(fatigue).speed;
}
export function setGuard(state: CombatState, active: boolean): void {
  if (active && !state.guarding) state.parry = 0.24;
  if (!active) state.parry = 0;
  state.guarding = active;
}
export function incomingHit(state: CombatState, damage: number, fatigue: number, facingAttacker: boolean): { damage: number; parried: boolean; fatigue: number } {
  if (state.dodge > 0.07) return { damage: 0, parried: false, fatigue: 0 };
  if (!state.guarding || !facingAttacker || fatigue >= 85) return { damage, parried: false, fatigue: 0 };
  if (state.parry > 0) return { damage: 0, parried: true, fatigue: 4 };
  return { damage: Math.ceil(damage * 0.35), parried: false, fatigue: 10 };
}

/** Контакт приходится на середину 320-мс дуги посоха, а не на начало замаха. */
export const STAFF_CONTACT_TIME = 0.16;
export interface StaffStrike { remaining: number; landed: boolean }
export const createStaffStrike = (): StaffStrike => ({ remaining: STAFF_CONTACT_TIME, landed: false });
export function advanceStaffStrike(strike: StaffStrike, dt: number): boolean {
  if (strike.landed || !Number.isFinite(dt) || dt < 0) return false;
  strike.remaining -= dt;
  if (strike.remaining > 1e-8) return false;
  strike.landed = true; return true;
}
