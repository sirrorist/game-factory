/** Масштаб по доступному окну: широкое, но низкое окно не увеличивает UI. */
export function applyUiScale(width: number, height: number): void {
  const scale = Math.max(1, Math.min(width / 1920, height / 1080));
  document.documentElement.style.fontSize = `${16 * scale}px`;
  document.documentElement.dataset.uiScale = String(scale);
}
