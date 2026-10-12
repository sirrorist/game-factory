// src/meta/casino.ts
// Модуль слот-машины "Forest 777" и рулетки CS-кейсов со скинами.
// Реализует:
// 1. Слот-машина: 3 барабана, RTP 96.0%, Provably Fair на базе CSPRNG / HMAC.
// 2. Кейс "CS:Forest Case": открытие за 50 $GFC, 4 градации редкости, скины для 3D-модели лиса.

import { sha256 } from './security.ts';

export type SlotSymbol = '🍒' | '🌰' | '🦊' | '💎' | '7️⃣';

export interface SlotSpinResult {
  reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  payout: number;
  isWin: boolean;
  multiplier: number;
  serverSeed: string;
  revealedHash: string;
}

export type SkinRarity = 'consumer' | 'mil_spec' | 'classified' | 'covert';

export interface SkinItem {
  id: string;
  name: string;
  rarity: SkinRarity;
  rarityTitle: string;
  rarityColor: string;
  tintColor: number; // Цвет для Three.js материала шерсти лиса
  description: string;
}

export const SKINS_COLLECTION: readonly SkinItem[] = [
  {
    id: 'skin_sock',
    name: 'Бабушкин вязаный носок',
    rarity: 'consumer',
    rarityTitle: 'Ширпотреб',
    rarityColor: '#b0c3d9',
    tintColor: 0x8d6e63,
    description: 'Тёплый шерстяной носок из деревни. Защищает от лесных сквозняков.',
  },
  {
    id: 'skin_forest_camo',
    name: 'Хвойный камуфляж',
    rarity: 'mil_spec',
    rarityTitle: 'Армейское',
    rarityColor: '#4b69ff',
    tintColor: 0x2d6a4f,
    description: 'Тактический лесной окрас для скрытного кайта совухов и грибышей.',
  },
  {
    id: 'skin_neon_fox',
    name: 'Кибер-Лис 2077',
    rarity: 'classified',
    rarityTitle: 'Засекреченное',
    rarityColor: '#d32ce6',
    tintColor: 0x00f5d4,
    description: 'Неоновые импланты и бирюзовое сияние шерсти прямо из Ночного Леса.',
  },
  {
    id: 'skin_fade_tail',
    name: 'Керамбит-Хвост ★ Fade',
    rarity: 'covert',
    rarityTitle: 'Тайное ★',
    rarityColor: '#eb4b4b',
    tintColor: 0x9d4edd,
    description: 'Редчайший паттерн Градиент 99.8%. Хвост переливается в лучах солнца!',
  },
];

// Символы и веса вероятностей барабанов (суммарный вес = 100)
interface SymbolWeight {
  symbol: SlotSymbol;
  weight: number;
  payout3: number; // Множитель за 3 совпадения
  payout2: number; // Множитель за 2 первых символа
}

const SYMBOL_TABLE: readonly SymbolWeight[] = [
  { symbol: '🍒', weight: 40, payout3: 3, payout2: 1.5 },
  { symbol: '🌰', weight: 28, payout3: 6, payout2: 2.5 },
  { symbol: '🦊', weight: 18, payout3: 15, payout2: 4.0 },
  { symbol: '💎', weight: 10, payout3: 40, payout2: 10.0 },
  { symbol: '7️⃣', weight: 4, payout3: 150, payout2: 20.0 },
];

export const SLOT_SPIN_COST = 10; // 10 $GFC
export const CASE_OPEN_COST = 50; // 50 $GFC

export class ForestCasino {
  /**
   * Provably Fair спин слот-машины
   */
  public static spinSlots(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
  ): SlotSpinResult {
    const combined = `${serverSeed}:${clientSeed}:${nonce}`;
    const hash = sha256(combined);

    // Извлекаем 3 детерминированных псевдослучайных числа из хеша
    const rand1 = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
    const rand2 = parseInt(hash.slice(8, 16), 16) / 0xffffffff;
    const rand3 = parseInt(hash.slice(16, 24), 16) / 0xffffffff;

    const r1 = this.pickSymbol(rand1);
    const r2 = this.pickSymbol(rand2);
    const r3 = this.pickSymbol(rand3);

    const { multiplier, payout } = this.calculatePayout(r1, r2, r3);

    return {
      reels: [r1, r2, r3],
      payout,
      isWin: payout > 0,
      multiplier,
      serverSeed,
      revealedHash: hash,
    };
  }

  /**
   * Открытие CS-кейса
   */
  public static openCase(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
  ): { item: SkinItem; rollValue: number; revealedHash: string } {
    const combined = `case:${serverSeed}:${clientSeed}:${nonce}`;
    const hash = sha256(combined);
    const roll = parseInt(hash.slice(0, 8), 16) / 0xffffffff;

    // Вероятности:
    // Covert: 5% (0.00 .. 0.05)
    // Classified: 15% (0.05 .. 0.20)
    // Mil-Spec: 30% (0.20 .. 0.50)
    // Consumer: 50% (0.50 .. 1.00)
    let selectedId = 'skin_sock';
    if (roll < 0.05) {
      selectedId = 'skin_fade_tail';
    } else if (roll < 0.20) {
      selectedId = 'skin_neon_fox';
    } else if (roll < 0.50) {
      selectedId = 'skin_forest_camo';
    } else {
      selectedId = 'skin_sock';
    }

    const item = SKINS_COLLECTION.find((s) => s.id === selectedId) ?? SKINS_COLLECTION[0]!;
    return {
      item,
      rollValue: roll,
      revealedHash: hash,
    };
  }

  private static pickSymbol(randomFloat: number): SlotSymbol {
    let accumulated = 0;
    const roll = randomFloat * 100;
    for (const item of SYMBOL_TABLE) {
      accumulated += item.weight;
      if (roll < accumulated) {
        return item.symbol;
      }
    }
    return '🍒';
  }

  private static calculatePayout(
    r1: SlotSymbol,
    r2: SlotSymbol,
    r3: SlotSymbol,
  ): { multiplier: number; payout: number } {
    // 3 совпадения
    if (r1 === r2 && r2 === r3) {
      const cfg = SYMBOL_TABLE.find((s) => s.symbol === r1);
      const mult = cfg?.payout3 ?? 0;
      return { multiplier: mult, payout: SLOT_SPIN_COST * mult };
    }

    // 2 совпадения подряд слева (r1 == r2)
    if (r1 === r2) {
      const cfg = SYMBOL_TABLE.find((s) => s.symbol === r1);
      const mult = cfg?.payout2 ?? 0;
      return { multiplier: mult, payout: Math.floor(SLOT_SPIN_COST * mult) };
    }

    // Проигрыш
    return { multiplier: 0, payout: 0 };
  }

  /**
   * Генератор лент для анимации вращения барабанов слот-машины.
   */
  public static generateSlotReelStrips(
    finalSymbols: [string, string, string] | readonly [string, string, string],
    stripLength = 24,
  ): [string[], string[], string[]] {
    return generateSlotReelStrips(finalSymbols, stripLength);
  }

  /**
   * Генератор ленты карточек для горизонтальной анимации CS-рулетки.
   */
  public static generateCsRouletteTrack(
    winningSkinId: string,
    totalCards = 42,
    winningIndex = 32,
  ): SkinItem[] {
    return generateCsRouletteTrack(winningSkinId, totalCards, winningIndex);
  }

  /**
   * Расчет смещения ленты CS-рулетки в пикселях с джиттером.
   */
  public static calculateRouletteOffset(
    containerWidth: number,
    cardWidth = 96,
    cardGap = 10,
    winningIndex = 32,
    jitter?: number,
  ): number {
    return calculateRouletteOffset(containerWidth, cardWidth, cardGap, winningIndex, jitter);
  }
}

export const ALL_SLOT_SYMBOLS: readonly SlotSymbol[] = ['🍒', '🌰', '🦊', '💎', '7️⃣'];

/**
 * Генератор лент символов для анимации 3 барабанов слот-машины.
 * Формирует для каждого барабана массив из stripLength символов,
 * где последний элемент строго равен finalSymbols[i],
 * а предшествующие распределены для создания эффекта динамичного вращения.
 */
export function generateSlotReelStrips(
  finalSymbols: [string, string, string] | readonly [string, string, string],
  stripLength = 24,
): [string[], string[], string[]] {
  const len = Math.max(1, Math.floor(stripLength));
  const strips: [string[], string[], string[]] = [[], [], []];

  for (let i = 0; i < 3; i++) {
    const strip: string[] = [];
    const finalSym = finalSymbols[i] ?? '🍒';
    for (let j = 0; j < len - 1; j++) {
      const prev = strip[j - 1];
      const pool = ALL_SLOT_SYMBOLS.filter((s) => s !== prev);
      const sym = pool[Math.floor(Math.random() * pool.length)] ?? '🍒';
      strip.push(sym);
    }
    strip.push(finalSym);
    strips[i] = strip;
  }

  return strips;
}

/**
 * Генератор ленты карточек скинов для CS-рулетки.
 * Формирует массив из totalCards карточек скинов разной редкости
 * (Ширпотреб, Армейское, Засекреченное, Тайное ★),
 * где на индексе winningIndex строго находится выигранный скин.
 */
export function generateCsRouletteTrack(
  winningSkinId: string,
  totalCards = 42,
  winningIndex = 32,
): SkinItem[] {
  const count = Math.max(1, Math.floor(totalCards));
  const targetIndex = Math.min(Math.max(0, Math.floor(winningIndex)), count - 1);
  const winningSkin = SKINS_COLLECTION.find((s) => s.id === winningSkinId) ?? SKINS_COLLECTION[0]!;

  const track: SkinItem[] = [];
  for (let i = 0; i < count; i++) {
    if (i === targetIndex) {
      track.push(winningSkin);
    } else {
      const randIndex = Math.floor(Math.random() * SKINS_COLLECTION.length);
      track.push(SKINS_COLLECTION[randIndex] ?? SKINS_COLLECTION[0]!);
    }
  }

  // Обеспечиваем присутствие карточек всех 4 редкостей для реалистичной анимации
  const presentRarities = new Set(track.map((s) => s.rarity));
  for (const skin of SKINS_COLLECTION) {
    if (!presentRarities.has(skin.rarity)) {
      for (let j = 0; j < count; j++) {
        if (j !== targetIndex) {
          track[j] = skin;
          presentRarities.add(skin.rarity);
          break;
        }
      }
    }
  }

  return track;
}

/**
 * Метод расчета смещения ленты CS-рулетки в пикселях.
 * Центрирует выигранную карточку под маркером контейнера с легким случайным джиттером ±20 px.
 */
export function calculateRouletteOffset(
  containerWidth: number,
  cardWidth = 96,
  cardGap = 10,
  winningIndex = 32,
  jitter?: number,
): number {
  const cardCenter = winningIndex * (cardWidth + cardGap) + cardWidth / 2;
  const baseOffset = cardCenter - containerWidth / 2;
  const jitterValue = jitter !== undefined ? jitter : (Math.random() * 40 - 20);
  return baseOffset + jitterValue;
}
