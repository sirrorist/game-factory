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
    baseHp: 5000,
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
    endTarget: 70,
  },
  {
    startSec: 600,
    endSec: 720, // 10:00 - 12:00 (овертайм: враги становятся сильнее и спавнятся до 100 одновременно)
    types: ['old_stump', 'mushlet', 'ram_beetle', 'spit_owl'],
    startTarget: 80,
    endTarget: 100,
  },
];

/** Потолок мобов одновременно на карте (DESIGN.md, раздел 5.4, овертайм до 100) */
export const MAX_MOBS_TOUCH = 80;
export const MAX_MOBS_DESKTOP = 150;

/** Множитель здоровья мобов: растёт на 10% каждую полную минуту до 10 мин, далее +20%/мин */
export function getMobHpMultiplier(runTimeSec: number): number {
  const totalMinutes = Math.floor(Math.max(0, runTimeSec) / 60);
  const regularMinutes = Math.min(totalMinutes, 10);
  const extraMinutes = Math.max(0, totalMinutes - 10);
  return Math.pow(1.10, regularMinutes) * Math.pow(1.20, extraMinutes);
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
  description: string;
  damageByLevel: readonly number[];
  cooldownSec: number;
  rangeByLevel: readonly number[];
  projectilesByLevel?: readonly number[];
  projSpeed?: number;
  sectorAngle?: number;
  sectorAngleByLevel?: readonly number[];
}

export const WEAPON_CONFIGS: Record<WeaponType, WeaponConfig> = {
  tail_blade: {
    id: 'tail_blade',
    name: 'Хвост-клинок',
    description: 'Взмах хвостом сзади (дуга растёт до кольца 360°)',
    damageByLevel: [14, 18, 22, 26, 30],
    cooldownSec: 0.9,
    rangeByLevel: [2.8, 3.1, 3.4, 3.7, 4.0],
    sectorAngle: (120 * Math.PI) / 180,
    sectorAngleByLevel: [
      (120 * Math.PI) / 180,
      (180 * Math.PI) / 180,
      (240 * Math.PI) / 180,
      (300 * Math.PI) / 180,
      2 * Math.PI,
    ],
  },
  spark_sling: {
    id: 'spark_sling',
    name: 'Искровая праща',
    description: 'Снаряд в ближайшего врага',
    damageByLevel: [9, 12, 15, 18, 21],
    cooldownSec: 0.7,
    rangeByLevel: [16.0, 16.0, 16.0, 16.0, 16.0],
    projectilesByLevel: [1, 1, 2, 2, 3],
    projSpeed: 22.0,
  },
};

export type TomeType = 'tome_haste' | 'tome_might';

export interface TomeConfig {
  id: TomeType;
  name: string;
  description: string;
}

export const TOME_CONFIGS: Record<TomeType, TomeConfig> = {
  tome_haste: {
    id: 'tome_haste',
    name: 'Фолиант быстроты',
    description: '+12 % к скорости атаки всех оружий',
  },
  tome_might: {
    id: 'tome_might',
    name: 'Фолиант силы',
    description: '+3 к силе каждого удара',
  },
};

export interface FallbackBonusConfig {
  id: 'heal_bonus' | 'speed_bonus';
  name: string;
  description: string;
}

export const FALLBACK_BONUSES: Record<'heal_bonus' | 'speed_bonus', FallbackBonusConfig> = {
  heal_bonus: {
    id: 'heal_bonus',
    name: 'Лечебный чай',
    description: '+20 к текущему и максимальному здоровью',
  },
  speed_bonus: {
    id: 'speed_bonus',
    name: 'Легконог',
    description: '+5 % к скорости бега',
  },
};

