// Все числа и баланс игры superwalk в одном модуле (DESIGN.md, раздел 5).

export interface HeroConfig {
  id: string;
  name: string;
  maxHp: number;
  speed: number;
  jumpHeight: number;
  pickupRadius: number;
  armor: number;
}

export const HERO_CONFIG: HeroConfig = {
  id: 'fox',
  name: 'Лис',
  maxHp: 100,
  speed: 6.0,        // м/с
  jumpHeight: 1.6,   // м
  pickupRadius: 2.5, // м
  armor: 0,
};

export type MobType = 'mushlet' | 'ram_beetle' | 'spit_owl' | 'old_stump';

export interface MobConfig {
  id: MobType;
  name: string;
  baseHp: number;
  speed: number;
  damage: number;
  exp: number;
  radius: number;
}

export const MOB_CONFIGS: Record<MobType, MobConfig> = {
  mushlet: {
    id: 'mushlet',
    name: 'Грибыш',
    baseHp: 18,
    speed: 2.6,
    damage: 6, // касанием
    exp: 1,
    radius: 0.45,
  },
  ram_beetle: {
    id: 'ram_beetle',
    name: 'Жук-таран',
    baseHp: 30,
    speed: 2.0,
    damage: 12, // при рывке (скорость рывка 9 м/с)
    exp: 2,
    radius: 0.55,
  },
  spit_owl: {
    id: 'spit_owl',
    name: 'Плевун-совёнок',
    baseHp: 14,
    speed: 2.2,
    damage: 8, // снарядом (10 м/с)
    exp: 2,
    radius: 0.45,
  },
  old_stump: {
    id: 'old_stump',
    name: 'Старый Пень (босс)',
    baseHp: 2400,
    speed: 1.8,
    damage: 20,
    exp: 50,
    radius: 1.8,
  },
};

export interface WavePeriod {
  startSec: number;
  endSec: number;
  types: readonly MobType[];
  startTarget: number;
  endTarget: number;
}

export const WAVE_SCHEDULE: readonly WavePeriod[] = [
  {
    startSec: 0,
    endSec: 120, // 0:00 - 2:00
    types: ['mushlet'],
    startTarget: 20,
    endTarget: 40,
  },
  {
    startSec: 120,
    endSec: 240, // 2:00 - 4:00
    types: ['mushlet', 'ram_beetle'],
    startTarget: 40,
    endTarget: 70,
  },
  {
    startSec: 240,
    endSec: 480, // 4:00 - 8:00
    types: ['mushlet', 'ram_beetle', 'spit_owl'],
    startTarget: 70,
    endTarget: 120,
  },
  {
    startSec: 480,
    endSec: 600, // 8:00 - 10:00 (босс)
    types: ['old_stump', 'mushlet', 'ram_beetle', 'spit_owl'],
    startTarget: 60,
    endTarget: 60,
  },
];

/** Потолок мобов одновременно на карте (DESIGN.md, раздел 5.4) */
export const MAX_MOBS_TOUCH = 80;
export const MAX_MOBS_DESKTOP = 150;

/** Множитель здоровья мобов: растёт на 10% каждую полную минуту забега */
export function getMobHpMultiplier(runTimeSec: number): number {
  const minutes = Math.floor(Math.max(0, runTimeSec) / 60);
  return Math.pow(1.10, minutes);
}

/** Опыт до следующего уровня N: 5 + (N - 1) * 4 (DESIGN.md, раздел 5.5) */
export function getRequiredExp(level: number): number {
  const safeLvl = Math.max(1, Math.floor(level));
  return 5 + (safeLvl - 1) * 4;
}

/** Ценность кристаллика опыта по типу */
export const GEM_VALUES = {
  small: 1,
  medium: 2,
  large: 5,
} as const;

export function getGemTypeForExp(amount: number): 'small' | 'medium' | 'large' {
  if (amount >= 5) return 'large';
  if (amount >= 2) return 'medium';
  return 'small';
}

export type WeaponType = 'tail_blade' | 'spark_sling';

export interface WeaponConfig {
  id: WeaponType;
  name: string;
  damageByLevel: readonly number[];
  cooldownByLevel: readonly number[];
  range: number;
  sectorAngle?: number;
}

export const WEAPON_CONFIGS: Record<WeaponType, WeaponConfig> = {
  tail_blade: {
    id: 'tail_blade',
    name: 'Взмах хвостом',
    damageByLevel: [14, 18, 22, 26, 32],
    cooldownByLevel: [1.1, 1.04, 0.98, 0.91, 0.85],
    range: 2.8,
    sectorAngle: (120 * Math.PI) / 180,
  },
  spark_sling: {
    id: 'spark_sling',
    name: 'Искромёт',
    damageByLevel: [10, 13, 16, 20, 25],
    cooldownByLevel: [1.4, 1.28, 1.17, 1.06, 0.95],
    range: 14.0,
  },
};

