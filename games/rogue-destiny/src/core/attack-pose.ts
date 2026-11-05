/** Геометрия замаха без зависимости от Three.js, браузера и моделей. */
export const ARM_LENGTH = 0.55;
export const STAFF_LENGTH = 2.0;
export const STAFF_GRIP = 0.35;

/** Поза руки в момент t (0..1) удара посохом: плечо, наклон посоха в мире, увод к центру. */
export function attackPose(t: number): { shoulder: number; staff: number; inward: number } {
  const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
  if (t < 0.3) {
    // Замах: рука вверх, навершие уходит за плечо
    const p = t / 0.3;
    return { shoulder: lerp(-0.3, -2.6, p), staff: lerp(0, -0.6, p), inward: 0 };
  }
  if (t < 0.65) {
    // Удар: рубящая дуга сверху вниз перед собой, навершие - вперёд и вниз
    const p = (t - 0.3) / 0.35;
    const e = 1 - (1 - p) * (1 - p);
    return { shoulder: lerp(-2.6, -1.2, e), staff: lerp(-0.6, 1.9, e), inward: lerp(0, 0.3, e) };
  }
  // Возврат в стойку
  const p = (t - 0.65) / 0.35;
  return { shoulder: lerp(-1.2, -0.3, p), staff: lerp(1.9, 0, p), inward: lerp(0.3, 0, p) };
}
