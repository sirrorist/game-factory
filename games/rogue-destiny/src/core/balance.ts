/** Начальные числа для ручной приёмки; длительность боя ещё не измерена игроком. */
export const STAFF_COOLDOWN_MS = 420;
export function enemyBalance(level: number, boss: boolean): { hp: number; claw: number; slam: number } {
  const depth = Math.max(0, Math.min(2, Math.floor(level) - 1));
  return boss ? { hp: 360 + depth * 120, claw: 22 + depth * 2, slam: 30 + depth * 3 }
    : { hp: 40 + depth * 8, claw: 16 + depth, slam: 16 + depth };
}
