/**
 * Логика QTE-взлома мимика без DOM: движение ползунка и попадание в зону.
 * Позиция - проценты дорожки (0..100), время - секунды.
 */

/** Зелёная зона среза, проценты дорожки. Её же рисует encounters.ts - одно число на двоих. */
export const QTE_ZONE = { from: 36, to: 68 } as const;

const EDGE_MIN = 2;
const EDGE_MAX = 98;

/** Скорость ползунка на усике `stage` (0..2), процентов в секунду: каждый следующий - быстрее. */
export function qteSpeed(stage: number): number {
  return 55 + stage * 15;
}

/** Шаг ползунка за `dt` секунд с отскоком от краёв дорожки. */
export function qteStep(pos: number, dir: number, speed: number, dt: number): { pos: number; dir: number } {
  let next = pos + dir * speed * dt;
  let nextDir = dir;
  if (next >= EDGE_MAX) {
    next = EDGE_MAX - (next - EDGE_MAX);
    nextDir = -1;
  } else if (next <= EDGE_MIN) {
    next = EDGE_MIN + (EDGE_MIN - next);
    nextDir = 1;
  }
  return { pos: Math.min(EDGE_MAX, Math.max(EDGE_MIN, next)), dir: nextDir };
}

export function qteHit(pos: number): boolean {
  return pos >= QTE_ZONE.from && pos <= QTE_ZONE.to;
}
