import { applyHealing, getEffectiveMaxHp } from './player.ts';
import type { PlayerState } from './types.ts';
export interface Healing { remaining: number; amount: number; fatigueAmount?: number }
export function startHealing(player: PlayerState, amount: number, fatigueAmount=0): Healing | null {
  if(player.isDead||!Number.isFinite(amount)||!Number.isFinite(fatigueAmount)||amount<0||fatigueAmount<0) return null;
  if(!(amount>0&&player.hp<getEffectiveMaxHp(player))&&!(fatigueAmount>0&&player.fatigue>0)) return null;
  return {remaining:3,amount,fatigueAmount};
}
export function advanceHealing(action: Healing, player: PlayerState, dt: number): number {
  if(!Number.isFinite(dt)||dt<0||(action.amount<=0&&(action.fatigueAmount??0)<=0)) return 0;
  action.remaining=Math.max(0,action.remaining-dt);
  if(action.remaining>1e-8) return 0;
  action.remaining=0;
  const amount=action.amount,fatigue=action.fatigueAmount??0;action.amount=0;action.fatigueAmount=0;
  if(!player.isDead) player.fatigue=Math.max(0,player.fatigue-fatigue);
  return applyHealing(player,amount);
}
