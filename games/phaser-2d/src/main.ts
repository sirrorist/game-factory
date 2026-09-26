import { GameFactory, type Session } from '@gf/game-sdk';
import * as Phaser from 'phaser';
import './style.css';

const WIDTH = 480;
const HEIGHT = 480;
const LIVES = 3;
// Уровень растёт со временем и ускоряет всё сразу: звёзды внутри уровня падают с одной
// скоростью, а платформа ускоряется вместе с ними - игра становится труднее, но остаётся
// проходимой (разброс скоростей делал отдельные звёзды непойманными в принципе).
const LEVEL_MS = 20_000;
const STAR_SPEED = (level: number): number => 140 + (level - 1) * 25;
const PADDLE_SPEED = (level: number): number => STAR_SPEED(level) * 2.6;
// Цвет звёзд меняется с уровнем - повышение видно сразу.
const STAR_COLORS = [0xf2cc60, 0x7ee787, 0x79c0ff, 0xd2a8ff, 0xff7b72, 0xffa657];

const $ = (id: string): HTMLElement => document.getElementById(id)!;

class StarfallScene extends Phaser.Scene {
  private session: Session;
  private player!: Phaser.GameObjects.Image;
  private stars!: Phaser.GameObjects.Group;
  private keys!: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
  };
  private message!: Phaser.GameObjects.Text;
  private score = 0;
  private lives = LIVES;
  private over = false;
  private level = 1;
  private spawnTimer?: Phaser.Time.TimerEvent;
  private levelTimer?: Phaser.Time.TimerEvent;
  private banner!: Phaser.GameObjects.Text;
  private targetX: number | null = null;

  constructor(session: Session) {
    super('starfall');
    this.session = session;
  }

  create(): void {
    // Текстуры рисуются кодом: загрузчик Phaser ходит за файлами через XHR,
    // а в офлайн-архиве (file://) это запрещено (П-002).
    const g = this.add.graphics();
    g.fillStyle(0x58a6ff).fillRoundedRect(0, 0, 80, 14, 7).generateTexture('paddle', 80, 14);
    // Звезда белая, цвет уровня - через tint.
    g.clear().fillStyle(0xffffff).fillCircle(9, 9, 9).generateTexture('star', 18, 18);
    g.destroy();

    this.player = this.add.image(WIDTH / 2, HEIGHT - 24, 'paddle');
    this.stars = this.add.group();
    const kb = this.input.keyboard!;
    this.keys = {
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.message = this.add
      .text(WIDTH / 2, HEIGHT / 2, '', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#e6edf3', align: 'center' })
      .setOrigin(0.5);
    this.banner = this.add
      .text(WIDTH / 2, HEIGHT / 3, '', { fontFamily: 'system-ui, sans-serif', fontSize: '34px', color: '#f2cc60', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setAlpha(0);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.over) this.restart();
      else this.targetX = p.x;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.targetX = p.x;
    });
    this.input.on('pointerup', () => {
      this.targetX = null;
    });
    kb.on('keydown-SPACE', () => {
      if (this.over) this.restart();
    });

    this.restart();
  }

  private restart(): void {
    this.stars.clear(true, true);
    this.score = 0;
    this.lives = LIVES;
    this.level = 1;
    this.over = false;
    this.message.setText('');
    this.player.x = WIDTH / 2;
    this.updateHud();
    this.spawnTimer?.remove();
    this.spawnTimer = this.time.addEvent({ delay: 700, loop: true, callback: () => this.spawn() });
    this.levelTimer?.remove();
    this.levelTimer = this.time.addEvent({ delay: LEVEL_MS, loop: true, callback: () => this.levelUp() });
    this.showBanner('Уровень 1');
  }

  private levelUp(): void {
    this.level += 1;
    const tint = this.starColor();
    for (const obj of this.stars.getChildren()) (obj as Phaser.GameObjects.Image).setTint(tint);
    this.updateHud();
    this.showBanner(`Уровень ${this.level}`);
  }

  private starColor(): number {
    return STAR_COLORS[(this.level - 1) % STAR_COLORS.length]!;
  }

  private showBanner(text: string): void {
    this.tweens.killTweensOf(this.banner);
    this.banner.setText(text).setColor(`#${this.starColor().toString(16).padStart(6, '0')}`).setAlpha(1);
    this.tweens.add({ targets: this.banner, alpha: 0, delay: 900, duration: 600 });
  }

  private spawn(): void {
    const star = this.add.image(Phaser.Math.Between(12, WIDTH - 12), -10, 'star').setTint(this.starColor());
    this.stars.add(star);
  }

  private updateHud(): void {
    $('score').textContent = String(this.score);
    $('lives').textContent = String(this.lives);
    $('level').textContent = String(this.level);
  }

  private async gameOver(): Promise<void> {
    this.over = true;
    this.spawnTimer?.remove();
    this.levelTimer?.remove();
    this.message.setText(`Игра окончена: ${this.score}, уровень ${this.level}\nКлик или пробел - ещё раз`);
    try {
      const r = await this.session.submitScore(this.score);
      $('best').textContent = String(r.best);
      if (r.isBest && this.score > 0) this.message.setText(`Новый рекорд: ${this.score}!\nКлик или пробел - ещё раз`);
    } catch (e) {
      console.warn('gf: очки не приняты', e);
    }
  }

  override update(_time: number, delta: number): void {
    if (this.over) return;
    const dt = delta / 1000;
    const speed = PADDLE_SPEED(this.level);
    const fall = STAR_SPEED(this.level) * dt;
    let dx = 0;
    if (this.keys.left.isDown || this.keys.a.isDown) dx -= speed * dt;
    if (this.keys.right.isDown || this.keys.d.isDown) dx += speed * dt;
    if (this.targetX !== null) dx = Phaser.Math.Clamp(this.targetX - this.player.x, -speed * dt, speed * dt);
    this.player.x = Phaser.Math.Clamp(this.player.x + dx, 40, WIDTH - 40);

    const paddle = this.player.getBounds();
    for (const obj of this.stars.getChildren().slice()) {
      const star = obj as Phaser.GameObjects.Image;
      star.y += fall;
      if (Phaser.Geom.Intersects.RectangleToRectangle(star.getBounds(), paddle)) {
        star.destroy();
        this.score += 1;
        this.updateHud();
      } else if (star.y > HEIGHT + 10) {
        star.destroy();
        this.lives -= 1;
        this.updateHud();
        if (this.lives <= 0) {
          void this.gameOver();
          return;
        }
      }
    }
  }
}

// Без top-level await: офлайн-сборка - классический скрипт (IIFE), там его нет.
async function main(): Promise<void> {
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });
  $('mode').textContent = session.mode === 'hub' ? 'в хабе' : 'без хаба';
  const best = await session.bestScore();
  $('best').textContent = best === null ? '-' : String(best);

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'stage',
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: '#161b22',
    // Баннер Phaser в консоли не нужен: консоль игры читают тесты.
    banner: false,
    scene: new StarfallScene(session),
    callbacks: {
      postBoot: () => session.ready(),
    },
  });
}

void main();
