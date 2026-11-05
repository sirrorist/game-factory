/** Усталость сужает точный сектор, без случайного промаха по уже попавшей цели. */
export function fatigueModifiers(fatigue: number): { speed: number; damage: number; cooldown: number; cone: number } {
  const strain=Number.isFinite(fatigue)?Math.max(0,Math.min(1,(fatigue-60)/40)):0;
  return {speed:1-strain*0.25,damage:1-strain*0.2,cooldown:1+strain*0.35,cone:0.35+strain*0.2};
}
