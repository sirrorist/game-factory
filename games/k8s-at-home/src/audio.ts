// Звуки синтезируются WebAudio: файлов нет, офлайн-архив остаётся одним HTML.
// Контекст создаётся по первому жесту игрока - иначе браузер не даст ему играть.

export class Sound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Вызывать из обработчика жеста (клик, касание, клавиша). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return; // без звука, но игра идёт
    }
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Короткий шум через фильтр: ломание, установка, шаги. pitch 0-1 - от глухого к звонкому. */
  private burst(pitch: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.noise || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 300 + pitch * 2600 + Math.random() * 200;
    filter.Q.value = 1.2 + pitch * 2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.3, dur);
  }

  dig(pitch: number): void {
    this.burst(pitch, 0.16, 0.5);
    setTimeout(() => this.burst(pitch * 0.8, 0.12, 0.3), 45);
  }

  place(pitch: number): void {
    this.burst(pitch * 0.6, 0.1, 0.45);
  }

  step(pitch: number): void {
    this.burst(pitch * 0.5, 0.07, 0.12);
  }

  splash(): void {
    this.burst(0.35, 0.35, 0.25);
  }
}
