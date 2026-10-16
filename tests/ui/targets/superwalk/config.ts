export { PROFILES } from '../../core/profiles.ts';

export const SCENES = [
  { id: 'hud', label: 'HUD: начало', root: '#app' },
  { id: 'hud-rich', label: 'HUD: полное снаряжение', root: '#app' },
  { id: 'boss', label: 'Босс и HUD', root: '#app' },
  { id: 'pause', label: 'Пауза и управление', root: '#menu .gf-panel' },
  { id: 'pause-stats', label: 'Пауза: характеристики', root: '#menu .gf-panel' },
  { id: 'dashboard', label: 'Карта и характеристики', root: '.gf-tab-panel' },
  { id: 'upgrade', label: 'Выбор улучшения', root: '.gf-upgrade-panel' },
  { id: 'victory', label: 'Победа', root: '.gf-panel--gameover' },
  { id: 'defeat', label: 'Поражение', root: '.gf-panel--gameover' },
  { id: 'toast', label: 'Уведомление', root: '#toast' },
  { id: 'item', label: 'Полученный предмет', root: '#item-card-popup' },
  { id: 'boss-toast', label: 'Босс + уведомление', root: '#app' },
  { id: 'boss-item', label: 'Босс + полученный предмет', root: '#app' },
  { id: 'debug', label: 'Показатели F3', root: '#debug' },
  { id: 'wallet-slots', label: 'Кошелёк: слоты', root: '.gf-wallet-panel' },
  { id: 'wallet-balance-large', label: 'Кошелёк: крупный баланс', root: '.gf-wallet-panel' },
  { id: 'wallet-cases', label: 'Кошелёк: кейс', root: '.gf-wallet-panel' },
  { id: 'wallet-result', label: 'Кошелёк: результат кейса', root: '.gf-wallet-panel' },
  { id: 'wallet-skins', label: 'Кошелёк: скины', root: '.gf-wallet-panel' },
  { id: 'wallet-skins-rich', label: 'Кошелёк: полная коллекция', root: '.gf-wallet-panel' },
  { id: 'wallet-withdraw', label: 'Кошелёк: вывод', root: '.gf-wallet-panel' },
  { id: 'wallet-withdraw-error', label: 'Кошелёк: ошибка суммы', root: '.gf-wallet-panel' },
  { id: 'wallet-receipt', label: 'Кошелёк: чек', root: '.gf-wallet-panel' },
] as const;

export type SceneId = typeof SCENES[number]['id'];
