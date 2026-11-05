/** Короткие синтезированные эффекты: офлайн, без загрузок и фоновых аудиоциклов. */
export type Sound = 'staff' | 'hit' | 'parry' | 'magic' | 'hurt' | 'heal' | 'pickup' | 'dodge' | 'cue';
const tones: Record<Sound, { from: number; to: number; duration: number; volume: number; wave: OscillatorType }> = {
  staff: { from: 180, to: 55, duration: 0.12, volume: 0.045, wave: 'triangle' },
  hit: { from: 90, to: 35, duration: 0.09, volume: 0.065, wave: 'sawtooth' },
  parry: { from: 700, to: 1400, duration: 0.2, volume: 0.04, wave: 'sine' },
  magic: { from: 120, to: 640, duration: 0.28, volume: 0.04, wave: 'triangle' },
  hurt: { from: 100, to: 42, duration: 0.22, volume: 0.055, wave: 'triangle' },
  heal: { from: 320, to: 640, duration: 0.4, volume: 0.035, wave: 'sine' },
  pickup: { from: 660, to: 990, duration: 0.12, volume: 0.03, wave: 'sine' },
  cue: { from: 180, to: 130, duration: 0.45, volume: 0.015, wave: 'sine' },
  dodge: { from: 220, to: 75, duration: 0.12, volume: 0.025, wave: 'triangle' },
};
export function createGameAudio() {
  let context: AudioContext | null = null;
  let muted = false;
  let voices = 0;
  return {
    get muted() { return muted; },
    setMuted(value: boolean): void { muted = value; },
    unlock(): void {
      if (muted || !globalThis.AudioContext) return;
      try { context ??= new AudioContext(); void context.resume().catch(() => undefined); } catch { /* Звук необязателен для запуска. */ }
    },
    play(sound: Sound): void {
      if (muted || !context || context.state !== 'running' || voices >= 8) return;
      const settings = tones[sound], now = context.currentTime;
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = settings.wave;
      oscillator.frequency.setValueAtTime(settings.from, now);
      oscillator.frequency.exponentialRampToValueAtTime(settings.to, now + settings.duration);
      gain.gain.setValueAtTime(settings.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.duration);
      oscillator.connect(gain); gain.connect(context.destination); voices++;
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); voices--; };
      oscillator.start(now); oscillator.stop(now + settings.duration + 0.01);
    },
  };
}
