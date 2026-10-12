// Чистая логика карточек улучшения, слотов и уровней (DESIGN.md, разделы 3, 5.2, 7).

import {
  WEAPON_CONFIGS,
  TOME_CONFIGS,
  FALLBACK_BONUSES,
  type WeaponType,
  type TomeType,
} from './content.ts';

export type UpgradeKind = 'weapon' | 'tome' | 'fallback';

export type UpgradeId = WeaponType | TomeType | 'heal_bonus' | 'speed_bonus';

export interface UpgradeOption {
  id: UpgradeId;
  kind: UpgradeKind;
  name: string;
  description: string;
  currentLevel: number;
  nextLevel: number;
  isNew: boolean;
}

export interface PlayerInventory {
  weapons: Map<WeaponType, number>;
  tomes: Map<TomeType, number>;
  healBonusCount: number;
  speedBonusCount: number;
}

export const MAX_WEAPON_SLOTS = 2;
export const MAX_TOME_SLOTS = 2;
export const MAX_UPGRADE_LEVEL = 5;

export function createInitialInventory(): PlayerInventory {
  const inv: PlayerInventory = {
    weapons: new Map(),
    tomes: new Map(),
    healBonusCount: 0,
    speedBonusCount: 0,
  };
  // Стартовое оружие лиса: Хвост-клинок (1 уровень)
  inv.weapons.set('tail_blade', 1);
  return inv;
}

/**
 * Получить список всех доступных вариантов улучшений на основе текущего инвентаря.
 */
export function getAvailableUpgrades(inv: PlayerInventory): UpgradeOption[] {
  const options: UpgradeOption[] = [];

  // 1. Оружия
  const allWeapons: WeaponType[] = ['tail_blade', 'spark_sling'];
  const hasFreeWeaponSlot = inv.weapons.size < MAX_WEAPON_SLOTS;

  for (const wId of allWeapons) {
    const curLvl = inv.weapons.get(wId) ?? 0;
    if (curLvl === 0) {
      if (hasFreeWeaponSlot) {
        const cfg = WEAPON_CONFIGS[wId];
        options.push({
          id: wId,
          kind: 'weapon',
          name: cfg.name,
          description: cfg.description,
          currentLevel: 0,
          nextLevel: 1,
          isNew: true,
        });
      }
    } else if (curLvl < MAX_UPGRADE_LEVEL) {
      const cfg = WEAPON_CONFIGS[wId];
      const nextDmg = cfg.damageByLevel[curLvl] ?? cfg.damageByLevel[cfg.damageByLevel.length - 1]!;
      const bonusText = wId === 'spark_sling' && (curLvl + 1 === 3 || curLvl + 1 === 5)
        ? `Урон: ${nextDmg}, +1 снаряд`
        : `Урон: ${nextDmg}`;
      options.push({
        id: wId,
        kind: 'weapon',
        name: cfg.name,
        description: bonusText,
        currentLevel: curLvl,
        nextLevel: curLvl + 1,
        isNew: false,
      });
    }
  }

  // 2. Фолианты
  const allTomes: TomeType[] = ['tome_haste', 'tome_might'];
  const hasFreeTomeSlot = inv.tomes.size < MAX_TOME_SLOTS;

  for (const tId of allTomes) {
    const curLvl = inv.tomes.get(tId) ?? 0;
    if (curLvl === 0) {
      if (hasFreeTomeSlot) {
        const cfg = TOME_CONFIGS[tId];
        options.push({
          id: tId,
          kind: 'tome',
          name: cfg.name,
          description: cfg.description,
          currentLevel: 0,
          nextLevel: 1,
          isNew: true,
        });
      }
    } else if (curLvl < MAX_UPGRADE_LEVEL) {
      const cfg = TOME_CONFIGS[tId];
      const bonusText = tId === 'tome_haste'
        ? `Скорость атаки: +${(curLvl + 1) * 12} %`
        : `Плоский урон: +${(curLvl + 1) * 3}`;
      options.push({
        id: tId,
        kind: 'tome',
        name: cfg.name,
        description: bonusText,
        currentLevel: curLvl,
        nextLevel: curLvl + 1,
        isNew: false,
      });
    }
  }

  // 3. Если обычных улучшений меньше 3 или все на 5-м уровне — предлагаются альтернативные бонусы
  if (options.length === 0) {
    options.push(
      {
        id: 'heal_bonus',
        kind: 'fallback',
        name: FALLBACK_BONUSES.heal_bonus.name,
        description: FALLBACK_BONUSES.heal_bonus.description,
        currentLevel: inv.healBonusCount,
        nextLevel: inv.healBonusCount + 1,
        isNew: false,
      },
      {
        id: 'speed_bonus',
        kind: 'fallback',
        name: FALLBACK_BONUSES.speed_bonus.name,
        description: FALLBACK_BONUSES.speed_bonus.description,
        currentLevel: inv.speedBonusCount,
        nextLevel: inv.speedBonusCount + 1,
        isNew: false,
      },
    );
  }

  return options;
}

/**
 * Выбор до count (по умолчанию 3) неповторяющихся случайных карточек.
 */
export function rollUpgradeChoices(
  inv: PlayerInventory,
  rnd: () => number = Math.random,
  count = 3,
): UpgradeOption[] {
  const available = getAvailableUpgrades(inv);
  if (available.length <= count) {
    return [...available];
  }

  const pool = [...available];
  const choices: UpgradeOption[] = [];

  while (choices.length < count && pool.length > 0) {
    const idx = Math.floor(rnd() * pool.length);
    choices.push(pool[idx]!);
    pool.splice(idx, 1);
  }

  return choices;
}

export interface UpgradeApplyResult {
  hpGain: number;
  speedMultiplier: number;
}

/**
 * Применение выбранного улучшения к инвентарю и характеристикам героя.
 */
export function applyUpgrade(inv: PlayerInventory, upgradeId: UpgradeId): UpgradeApplyResult {
  let hpGain = 0;
  let speedMultiplier = 1.0;

  if (upgradeId === 'tail_blade' || upgradeId === 'spark_sling') {
    const cur = inv.weapons.get(upgradeId) ?? 0;
    inv.weapons.set(upgradeId, Math.min(MAX_UPGRADE_LEVEL, cur + 1));
  } else if (upgradeId === 'tome_haste' || upgradeId === 'tome_might') {
    const cur = inv.tomes.get(upgradeId) ?? 0;
    inv.tomes.set(upgradeId, Math.min(MAX_UPGRADE_LEVEL, cur + 1));
  } else if (upgradeId === 'heal_bonus') {
    inv.healBonusCount++;
    hpGain = 20;
  } else if (upgradeId === 'speed_bonus') {
    inv.speedBonusCount++;
    speedMultiplier = 1.05;
  }

  return { hpGain, speedMultiplier };
}

/**
 * Расчёт перезарядки с учётом фолианта быстроты:
 * +12 % к скорости атаки за уровень фолианта.
 */
export function getWeaponCooldown(baseCooldown: number, hasteLevel: number): number {
  if (hasteLevel <= 0) return baseCooldown;
  const attackSpeedFactor = 1.0 + hasteLevel * 0.12;
  return baseCooldown / attackSpeedFactor;
}

/**
 * Плоский бонус к урону от фолианта силы: +3 за уровень.
 */
export function getFlatMightBonus(mightLevel: number): number {
  return Math.max(0, mightLevel) * 3;
}
