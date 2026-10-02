/**
 * Типы данных ядра игры Rogue Destiny.
 * Правила: чистый TypeScript без enum и namespace, явные типы.
 */

export type ElementType = 'physical' | 'fire' | 'ice' | 'poison' | 'aether';

export type ItemRarity = 'common' | 'rare' | 'holy' | 'infernal';

export type ItemCategory =
  | 'weapon'
  | 'shield'
  | 'rune'
  | 'potion'
  | 'scroll'
  | 'relic'
  | 'tool'
  | 'curse';

export type WeightClass = 'light' | 'medium' | 'heavy';

export interface GridCoord {
  readonly x: number;
  readonly y: number;
}

export interface InventoryItem {
  readonly id: string;
  readonly name: string;
  readonly category: ItemCategory;
  readonly rarity: ItemRarity;
  readonly element: ElementType;
  /** Базовая форма в сетке (список координат относительно [0, 0]) */
  readonly shape: readonly GridCoord[];
  readonly weight: number;
  rotation: 0 | 90 | 180 | 270;
  gridX?: number;
  gridY?: number;
  /** Прочность предмета (для кристаллов, оружия, линз) */
  durability?: number;
  maxDurability?: number;
  /** Числовые параметры */
  damage?: number;
  defense?: number;
  heatCost?: number;
  fatigueCost?: number;
  healAmount?: number;
  /** Флаг испорченности/загрязненности */
  isSpoiled?: boolean;
}

export interface InventorySlot {
  readonly x: number;
  readonly y: number;
  itemId: string | null;
  /** Отсек испачкан врагами и заблокирован */
  isMudded: boolean;
}

export interface InventoryGrid {
  readonly width: number;
  readonly height: number;
  readonly slots: InventorySlot[];
  readonly items: Map<string, InventoryItem>;
  /** Быстрые слоты пояса (1..4) */
  quickSlots: (string | null)[];
}

export interface InventoryStats {
  readonly totalWeight: number;
  readonly weightClass: WeightClass;
  readonly totalArmor: number;
  readonly bonusFireDamage: number;
  readonly bonusPoisonDamage: number;
  readonly bonusCritRate: number;
}

export interface PlayerState {
  hp: number;
  maxHp: number;
  /** Серое здоровье (неизлечимая травма плоти, снижающая эффективный потолок HP) */
  greyHp: number;
  /** Эфирный Перегрев (0..100) */
  aetherHeat: number;
  /** Усталость тела (0..100) */
  fatigue: number;
  /** Временная забранная мана врагов (0..100) */
  temporaryMana: number;
  /** Активные Нити Судьбы (1..3) */
  threadsOfFate: number;
  maxThreads: number;
  /** Запас света/масла (100 -> 0) */
  lightSupply: number;
  /** Очки текущего забега */
  score: number;
  /** Число полученных тяжелых травм за забег */
  injuriesCount: number;
  /** Число побежденных элитных врагов */
  elitesDefeated: number;
  /** Текущий этаж */
  currentFloor: number;
  isDead: boolean;
}

export type MetroidvaniaLockType =
  | 'illusionary'
  | 'runeCipher'
  | 'submerged'
  | 'brambles'
  | 'chasm'
  | 'elementalWard'
  | 'pitchBlack'
  | 'soundTrap'
  | 'steamVent';

export interface RoomCue {
  readonly type: 'whisper' | 'scoot' | 'spore_buzz' | 'blood_scent' | 'heat_radiance';
  readonly message: string;
}

export interface DungeonRoom {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly type: 'spawn' | 'hall' | 'corridor' | 'library' | 'shrine' | 'mimic_room' | 'boss_gate';
  isRevealed: boolean;
  isVisited: boolean;
  hasAetherRift: boolean;
  lockType?: MetroidvaniaLockType;
  cue?: RoomCue;
}

export interface DungeonFloor {
  readonly floorNumber: number;
  readonly rooms: DungeonRoom[];
  readonly connections: [string, string][];
  activeRoomId: string;
}
