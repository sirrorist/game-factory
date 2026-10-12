// Расчёт игровых очков забега (DESIGN.md, раздел "Бриф" и раздел 7).
// Формула: убитые_мобы + 2 * секунды + 500 (за победу над боссом) + 10 * уровень

export interface ScoreParams {
  killedMobs: number;
  survivalSeconds: number;
  bossDefeated: boolean;
  heroLevel: number;
}

export function calculateScore(params: ScoreParams): number {
  const mobsScore = Math.max(0, Math.floor(params.killedMobs));
  const timeScore = Math.max(0, Math.floor(params.survivalSeconds)) * 2;
  const bossScore = params.bossDefeated ? 500 : 0;
  const levelScore = Math.max(1, Math.floor(params.heroLevel)) * 10;

  return mobsScore + timeScore + bossScore + levelScore;
}

/**
 * Блокировка клавиш при завершении забега (ERR-20):
 * Разрешены только Space и Enter для рестарта, любые другие хоткеи (Tab, Escape, B, 1-3) блокируются.
 */
export function isAllowedGameOverKey(code: string): boolean {
  return code === 'Space' || code === 'Enter';
}

