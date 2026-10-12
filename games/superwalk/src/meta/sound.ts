// src/meta/sound.ts
// Синтезатор звуковых эффектов для казино, слот-машины и CS-рулетки на чистом Web Audio API.
// Без внешних аудио-файлов, с безопасной инициализацией контекста по жесту пользователя.

let audioContextInstance: AudioContext | null = null;
let gestureListenerRegistered = false;

/**
 * Получить или создать AudioContext с проверкой состояния suspended.
 * В среде Node.js / тестов возвращает null без выброса исключений.
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const AudioContextConstructor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return null;
  }

  if (!audioContextInstance) {
    try {
      audioContextInstance = new AudioContextConstructor();
    } catch {
      return null;
    }
  }

  if (audioContextInstance && audioContextInstance.state === 'suspended') {
    audioContextInstance.resume().catch(() => {});
  }

  return audioContextInstance;
}

/**
 * Безопасная инициализация звукового контекста при первом жесте пользователя
 * (клик, нажатие клавиши, тачскрин).
 */
export function initAudioOnUserGesture(): void {
  if (typeof window === 'undefined' || gestureListenerRegistered) {
    return;
  }
  gestureListenerRegistered = true;

  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };

  const gestureEvents = ['click', 'keydown', 'pointerdown', 'touchstart'];
  const onGesture = () => {
    unlockAudio();
    for (const eventName of gestureEvents) {
      window.removeEventListener(eventName, onGesture);
    }
  };

  for (const eventName of gestureEvents) {
    window.addEventListener(eventName, onGesture, { passive: true, once: true });
  }
}

// Автоматическая регистрация слушателя при загрузке в браузере
if (typeof window !== 'undefined') {
  initAudioOnUserGesture();
}

/**
 * Короткий щелчок тикера (треугольная волна 600 -> 120 Гц за 30 мс).
 * Воспроизводится при прохождении карточек CS-рулетки через указатель.
 */
export function playTickSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(120, now + 0.03);

  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.035);
}

/**
 * Глухой стук остановки барабана (синусоида 220 -> 60 Гц за 80 мс).
 * Воспроизводится при фиксации барабана слот-машины.
 */
export function playReelStopSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);

  gain.gain.setValueAtTime(0.35, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.085);
}

/**
 * Победный мажорный арпеджио-аккорд (C5, E5, G5, C6) для джекпота/выигрыша в слотах.
 * Ноты C5 (523.25 Гц), E5 (659.25 Гц), G5 (783.99 Гц), C6 (1046.50 Гц).
 */
export function playWinChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const notes = [523.25, 659.25, 783.99, 1046.50];
  const now = ctx.currentTime;

  notes.forEach((freq, idx) => {
    const noteTime = now + idx * 0.07;
    const noteDuration = 0.45;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, noteTime);

    gain.gain.setValueAtTime(0.001, noteTime);
    gain.gain.linearRampToValueAtTime(0.2, noteTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, noteTime + noteDuration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(noteTime);
    osc.stop(noteTime + noteDuration);
  });
}

/**
 * Торжественный космический аккорд для выпадения тайного скина (Covert ★).
 * Многоголосный аккорд с широким спектром и объёмным сиянием.
 */
export function playRareDropSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const duration = 2.0;

  // Гармонический ряд космического созвучия: C3, G3, C4, E4, G4, B4, D5
  const freqs = [130.81, 196.00, 261.63, 329.63, 392.00, 493.88, 587.33];

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.001, now);
  masterGain.gain.linearRampToValueAtTime(0.28, now + 0.12);
  masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  masterGain.connect(ctx.destination);

  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    const detunedOsc = ctx.createOscillator();
    detunedOsc.type = 'sine';
    detunedOsc.frequency.setValueAtTime(freq * 1.003, now);

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0.12, now);

    osc.connect(voiceGain);
    detunedOsc.connect(voiceGain);
    voiceGain.connect(masterGain);

    osc.start(now);
    detunedOsc.start(now);
    osc.stop(now + duration);
    detunedOsc.stop(now + duration);
  }
}

export const SoundSynthesizer = {
  getAudioContext,
  initAudioOnUserGesture,
  playTickSound,
  playReelStopSound,
  playWinChime,
  playRareDropSound,
};
