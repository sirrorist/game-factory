import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ForestCasino,
  SKINS_COLLECTION,
  SLOT_SPIN_COST,
  CASE_OPEN_COST,
  generateSlotReelStrips,
  generateCsRouletteTrack,
  calculateRouletteOffset,
  ALL_SLOT_SYMBOLS,
} from '../src/meta/casino.ts';
import {
  playTickSound,
  playReelStopSound,
  playWinChime,
  playRareDropSound,
  getAudioContext,
  initAudioOnUserGesture,
  SoundSynthesizer,
} from '../src/meta/sound.ts';

describe('Слот-машина 777 и CS-кейсы (src/meta/casino.ts)', () => {
  it('стоимости спина и кейса соответствуют ТЗ', () => {
    assert.equal(SLOT_SPIN_COST, 10);
    assert.equal(CASE_OPEN_COST, 50);
  });

  it('спин детерминирован для одинаковых serverSeed, clientSeed и nonce', () => {
    const res1 = ForestCasino.spinSlots('server_123', 'client_abc', 1);
    const res2 = ForestCasino.spinSlots('server_123', 'client_abc', 1);
    assert.deepEqual(res1.reels, res2.reels);
    assert.equal(res1.payout, res2.payout);
    assert.equal(res1.revealedHash, res2.revealedHash);
  });

  it('разные сиды или nonce дают разные результаты вращения барабанов', () => {
    const res1 = ForestCasino.spinSlots('seed_A', 'client_1', 0);
    const res2 = ForestCasino.spinSlots('seed_B', 'client_1', 1);
    assert.notEqual(res1.revealedHash, res2.revealedHash);
  });

  it('открытие кейса возвращает валидный скин из коллекции', () => {
    const res = ForestCasino.openCase('server_seed', 'client_seed', 42);
    assert.ok(res.item);
    assert.ok(SKINS_COLLECTION.some((s) => s.id === res.item.id));
    assert.ok(typeof res.item.tintColor === 'number');
    assert.ok(res.rollValue >= 0 && res.rollValue < 1);
  });

  it('коллекция скинов содержит все 4 градации редкости (Consumer, Mil-Spec, Classified, Covert ★)', () => {
    const rarities = new Set(SKINS_COLLECTION.map((s) => s.rarity));
    assert.ok(rarities.has('consumer'));
    assert.ok(rarities.has('mil_spec'));
    assert.ok(rarities.has('classified'));
    assert.ok(rarities.has('covert'));
  });

  it('generateSlotReelStrips формирует 3 ленты заданной длины с финальным символом на конце', () => {
    const targets: [string, string, string] = ['🦊', '7️⃣', '💎'];
    const strips = generateSlotReelStrips(targets, 24);

    assert.equal(strips.length, 3);
    for (let i = 0; i < 3; i++) {
      const strip = strips[i]!;
      assert.equal(strip.length, 24);
      assert.equal(strip[strip.length - 1], targets[i]);

      for (const symbol of strip) {
        assert.ok(ALL_SLOT_SYMBOLS.includes(symbol as any));
      }
    }

    // Проверка статического метода класса
    const classStrips = ForestCasino.generateSlotReelStrips(targets, 16);
    assert.equal(classStrips.length, 3);
    assert.equal(classStrips[0]?.length, 16);
    assert.equal(classStrips[0]?.[15], targets[0]);
    assert.equal(classStrips[1]?.[15], targets[1]);
    assert.equal(classStrips[2]?.[15], targets[2]);
  });

  it('generateCsRouletteTrack формирует ленту из 42 карточек с выигрышным скином строго на индексе 32', () => {
    const winningSkinId = 'skin_fade_tail';
    const track = generateCsRouletteTrack(winningSkinId, 42, 32);

    assert.equal(track.length, 42);
    assert.equal(track[32]?.id, winningSkinId);
    assert.equal(track[32]?.rarity, 'covert');

    // Проверяем, что в ленте присутствуют все 4 градации редкости
    const rarities = new Set(track.map((c) => c.rarity));
    assert.ok(rarities.has('consumer'));
    assert.ok(rarities.has('mil_spec'));
    assert.ok(rarities.has('classified'));
    assert.ok(rarities.has('covert'));

    // Проверка через статический метод с кастомными параметрами
    const customTrack = ForestCasino.generateCsRouletteTrack('skin_neon_fox', 30, 20);
    assert.equal(customTrack.length, 30);
    assert.equal(customTrack[20]?.id, 'skin_neon_fox');
  });

  it('calculateRouletteOffset вычисляет точное смещение по X и учитывает диапазон джиттера', () => {
    const containerWidth = 800;
    const cardWidth = 96;
    const cardGap = 10;
    const winningIndex = 32;

    // Центр карточки 32: 32 * (96 + 10) + 96 / 2 = 32 * 106 + 48 = 3440
    // Базовое смещение для центрирования в контейнере 800: 3440 - 800 / 2 = 3040
    const nominal = calculateRouletteOffset(containerWidth, cardWidth, cardGap, winningIndex, 0);
    assert.equal(nominal, 3040);

    // Смещение через статический метод ForestCasino
    const nominalClass = ForestCasino.calculateRouletteOffset(containerWidth, cardWidth, cardGap, winningIndex, 0);
    assert.equal(nominalClass, 3040);

    // Смещение с джиттером по умолчанию попадает в диапазон ±20 px
    for (let i = 0; i < 20; i++) {
      const offset = calculateRouletteOffset(containerWidth, cardWidth, cardGap, winningIndex);
      assert.ok(offset >= 3020 && offset <= 3060, `Offset ${offset} вне допустимого диапазона [3020, 3060]`);
    }

    // Проверка для другого размера экрана (например, мобильный 390 px)
    const mobileOffset = calculateRouletteOffset(390, 96, 10, 32, 0);
    assert.equal(mobileOffset, 3440 - 195); // 3245
  });
});

describe('Синтезатор звуков Web Audio API (src/meta/sound.ts)', () => {
  it('функции синтезатора безопасно вызываются в среде без DOM / AudioContext', () => {
    assert.equal(getAudioContext(), null);
    assert.doesNotThrow(() => initAudioOnUserGesture());
    assert.doesNotThrow(() => playTickSound());
    assert.doesNotThrow(() => playReelStopSound());
    assert.doesNotThrow(() => playWinChime());
    assert.doesNotThrow(() => playRareDropSound());
    assert.ok(SoundSynthesizer.playTickSound);
  });

  it('синтезатор генерирует ожидаемые звуковые узлы при наличии AudioContext', () => {
    type CreatedOsc = {
      type: string;
      freqStart: number;
      freqEnd?: number;
      rampTime?: number;
    };

    const createdOscillators: CreatedOsc[] = [];

    class MockAudioParam {
      public value = 0;
      setValueAtTime(val: number) {
        this.value = val;
      }
      exponentialRampToValueAtTime(val: number, _time: number) {
        this.value = val;
      }
      linearRampToValueAtTime(val: number, _time: number) {
        this.value = val;
      }
    }

    class MockOscillator {
      public type = 'sine';
      public frequency = new MockAudioParam();
      connect() {}
      start() {}
      stop() {}
    }

    class MockGain {
      public gain = new MockAudioParam();
      connect() {}
    }

    class MockAudioContext {
      public currentTime = 10;
      public state = 'running';
      public destination = {};
      createOscillator() {
        const osc = new MockOscillator();
        createdOscillators.push({
          get type() {
            return osc.type;
          },
          get freqStart() {
            return osc.frequency.value;
          },
        });
        return osc;
      }
      createGain() {
        return new MockGain();
      }
      resume() {
        return Promise.resolve();
      }
    }

    const originalWindow = (globalThis as any).window;
    try {
      (globalThis as any).window = {
        AudioContext: MockAudioContext,
        addEventListener: () => {},
        removeEventListener: () => {},
      };

      // Проверка щелчка тикера
      createdOscillators.length = 0;
      playTickSound();
      assert.equal(createdOscillators.length, 1);
      assert.equal(createdOscillators[0]?.type, 'triangle');

      // Проверка стука барабана
      createdOscillators.length = 0;
      playReelStopSound();
      assert.equal(createdOscillators.length, 1);
      assert.equal(createdOscillators[0]?.type, 'sine');

      // Проверка победного арпеджио
      createdOscillators.length = 0;
      playWinChime();
      assert.equal(createdOscillators.length, 4); // 4 ноты: C5, E5, G5, C6

      // Проверка редкого дропа
      createdOscillators.length = 0;
      playRareDropSound();
      assert.ok(createdOscillators.length >= 7);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});
