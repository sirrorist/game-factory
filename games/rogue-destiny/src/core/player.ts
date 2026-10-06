/**
 * Модуль состояния игрока, урона, перегрева, усталости и Нитей Судьбы.
 * Чистая логика без DOM.
 */
import type { PlayerState } from './types.ts';

export function createPlayer(): PlayerState {
  return {
    hp: 100,
    maxHp: 100,
    greyHp: 0,
    aetherHeat: 0,
    fatigue: 0,
    temporaryMana: 0,
    threadsOfFate: 2,
    maxThreads: 3,
    lightSupply: 100,
    score: 0,
    injuriesCount: 0,
    elitesDefeated: 0,
    currentFloor: 1,
    isDead: false,
  };
}

export function getEffectiveMaxHp(player: PlayerState): number {
  return Math.max(1, player.maxHp - player.greyHp);
}

export function applyDamage(
  player: PlayerState,
  rawDamage: number,
  armor = 0,
): { actualDamage: number; survivedByFate: boolean } {
  if (player.isDead) {
    return { actualDamage: 0, survivedByFate: false };
  }

  const effectiveDamage = Math.max(1, rawDamage - armor);

  // 20% неблокированного урона переходит в неизлечимую серую травму
  const trauma = Math.round(effectiveDamage * 0.2);
  player.greyHp = Math.min(player.maxHp - 1, player.greyHp + trauma);
  if (trauma > 0) {
    player.injuriesCount += 1;
  }

  if (player.hp - effectiveDamage <= 0) {
    // Проверка Нити Судьбы
    if (player.threadsOfFate > 0) {
      player.threadsOfFate -= 1;
      player.hp = 1;
      return { actualDamage: effectiveDamage, survivedByFate: true };
    }

    player.hp = 0;
    player.isDead = true;
    return { actualDamage: effectiveDamage, survivedByFate: false };
  }

  player.hp -= effectiveDamage;
  return { actualDamage: effectiveDamage, survivedByFate: false };
}

export function castMagic(
  player: PlayerState,
  heatCost: number,
): { success: boolean; inRedline: boolean; isOverloaded: boolean } {
  if (player.isDead) {
    return { success: false, inRedline: false, isOverloaded: false };
  }

  player.aetherHeat = Math.min(100, player.aetherHeat + heatCost);

  const inRedline = player.aetherHeat >= 80 && player.aetherHeat <= 95;
  const isOverloaded = player.aetherHeat >= 100;

  return {
    success: true,
    inRedline,
    isOverloaded,
  };
}

export function performPhysicalAttack(
  player: PlayerState,
  fatigueCost = 4,
): { cooledHeat: number } {
  // Физический удар посохом охлаждает тепло на 20%
  const before = player.aetherHeat;
  player.aetherHeat = Math.max(0, player.aetherHeat - 20);
  const cooledHeat = before - player.aetherHeat;

  // И медленно повышает усталость
  player.fatigue = Math.min(100, player.fatigue + fatigueCost);

  return { cooledHeat };
}

export function forceVentHeat(player: PlayerState): { heatVented: number; healthBurned: number } {
  const heatVented = player.aetherHeat;
  player.aetherHeat = 0;

  // Штраф: ожог сожженных каналов мага (12% максимального HP переходит в серую травму)
  const burn = Math.max(5, Math.round(player.maxHp * 0.12));
  player.greyHp = Math.min(player.maxHp - 1, player.greyHp + burn);
  player.hp = Math.max(1, player.hp - burn);
  player.injuriesCount += 1;

  return { heatVented, healthBurned: burn };
}

export function performParry(
  player: PlayerState,
  incomingDamage: number,
  parryType: 'siphon' | 'reflect' | 'both',
): { reflectedDamage: number; manaGained: number } {
  let reflectedDamage = 0;
  let manaGained = 0;

  if (parryType === 'reflect' || parryType === 'both') {
    reflectedDamage = incomingDamage;
  }

  if (parryType === 'siphon' || parryType === 'both') {
    manaGained = Math.round(incomingDamage * 1.2);
    player.temporaryMana = Math.min(100, player.temporaryMana + manaGained);
  }

  return { reflectedDamage, manaGained };
}

export function applyHealing(player: PlayerState, amount: number): number {
  const ceiling = getEffectiveMaxHp(player);
  const oldHp = player.hp;
  player.hp = Math.min(ceiling, player.hp + amount);
  return player.hp - oldHp;
}

export function restAtAetherRift(player: PlayerState): void {
  player.greyHp = 0;
  player.hp = player.maxHp;
  player.aetherHeat = 0;
  player.fatigue = 0;
  player.lightSupply = 100;
}

export function calculateScore(player: PlayerState): number {
  const score =
    player.currentFloor * 100 +
    player.elitesDefeated * 25 +
    player.threadsOfFate * 50 -
    player.injuriesCount * 5 +
    player.score;

  return Math.max(0, score);
}
