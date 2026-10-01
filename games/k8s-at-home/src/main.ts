import { GameFactory, type Session } from '@gf/game-sdk';
import * as THREE from 'three';
import { Sound } from './audio.ts';
import { blockIcon, buildAtlas, FACE_TILES, TILE } from './atlas.ts';
import { B, BLOCKS, DEFAULT_HOTBAR, SOLID, type BlockId } from './blocks.ts';
import { BIOME_NAMES, CHUNK, HEIGHT, SEA } from './gen.ts';
import { fillIcons, setIcon } from './icons.ts';
import { Input } from './input.ts';
import { meshChunk, type MeshData } from './mesher.ts';
import { bodyCollides, EYE, makeBody, raycast, stepBody, type Body, type Hit } from './physics.ts';
import { decodeEdits, encodeEdits, fromBase64, parseMeta, SAVE_VERSION, splitParts, type WorldMeta } from './save.ts';
import { Sky } from './sky.ts';
import { WaterFlow } from './water.ts';
import { FallingBlocks } from './falling.ts';
import { chunkKey, meshInRange, meshVisible, PAD_VOLUME, World } from './world.ts';
import './style.css';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const DAY_SECONDS = 20 * 60;
const REACH = 6;
const REPEAT_MS = 230;
const AUTOSAVE_MS = 10_000;
const MAX_RD = 10;

const touchDevice = matchMedia('(pointer: coarse)').matches;

// Смещения чанков вокруг игрока по возрастанию расстояния: ближние грузятся первыми.
const OFFSETS: [number, number][] = [];
for (let dz = -MAX_RD - 2; dz <= MAX_RD + 2; dz++) {
  for (let dx = -MAX_RD - 2; dx <= MAX_RD + 2; dx++) OFFSETS.push([dx, dz]);
}
OFFSETS.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  color: THREE.Color;
}

interface ChunkMeshes {
  solid: THREE.Mesh | null;
  water: THREE.Mesh | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Перезапустить CSS-анимацию появления (gf-rise): элемент уже на экране, текст сменился. */
function replay(el: HTMLElement): void {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

let toastTimer = 0;
/** Тон - цвет пикселя слева (Toast системы): ok - успех, warn - предупреждение, err - ошибка. */
function toast(text: string, ms = 2200, tone: 'ok' | 'warn' | 'err' | null = null): void {
  const el = $('toast');
  el.textContent = text;
  el.className = tone ? `gf-toast gf-toast--${tone}` : 'gf-toast';
  el.hidden = false;
  replay(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}

async function loadSave(session: Session): Promise<{ meta: WorldMeta; parts: string[] } | null> {
  try {
    const meta = parseMeta(await session.load('world'));
    if (!meta) return null;
    const parts: string[] = [];
    for (let i = 0; i < meta.parts; i++) {
      const p = await session.load<string>(`edits.${i}`);
      if (typeof p !== 'string') return { meta: { ...meta, parts: 0 }, parts: [] }; // часть потеряна - мир без правок
      parts.push(p);
    }
    return { meta, parts };
  } catch (e) {
    console.warn('k8s: сохранение не прочиталось', e);
    return null;
  }
}

class Game {
  private readonly session: Session;
  private readonly sound = new Sound();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky: Sky;
  private readonly input: Input;
  private readonly solidMat: THREE.MeshBasicMaterial;
  private readonly waterMat: THREE.MeshBasicMaterial;
  private readonly highlight: THREE.LineSegments;
  private readonly particles: THREE.InstancedMesh;
  private readonly particleState: Particle[] = [];
  private readonly icons: string[] = [];
  private readonly tileColor: THREE.Color[] = [];
  private readonly meshes = new Map<number, ChunkMeshes>();
  private readonly padBuf = new Uint8Array(PAD_VOLUME);
  private readonly water = new WaterFlow();
  private lastFlow = 0;
  private readonly falling = new FallingBlocks();
  private lastFall = 0;

  private world!: World;
  private body!: Body;
  private time = 0.3;
  private hotbar: BlockId[] = [...DEFAULT_HOTBAR];
  private slot = 0;
  private mined = 0;
  private submitted = 0;
  private best: number | null = null;
  private renderDistance = touchDevice ? 4 : 6;
  /** Чанк игрока на последнем `unloadFar`: перешёл в другой - видимость сеток пересчитать сразу. */
  private viewChunk = -1;
  private target: Hit | null = null;
  private breaking = false;
  private lastBreak = 0;
  private lastPlace = 0;
  private dirty = false;
  private lastSave = 0;
  private saving = false;
  private savedParts: string[] = [];
  private stepDist = 0;
  private wasInWater = false;
  private debug = false;
  private frames = 0;
  private fps = 0;
  private fpsAt = 0;
  private frame = 0;
  private lastFrame = 0;
  // Замер для F3 за последнюю секунду: время кадра, рывки, подгрузка чанков.
  private perf = { at: 0, frames: 0, sum: 0, worst: 0, slow: 0, stream: 0 };
  private perfShown = { avg: 0, worst: 0, slow: 0, stream: 0, mouse: 0, step: 0, dropped: 0 };
  private started = false;
  private fullscreenExitAt = -Infinity;
  private wasHostFullscreen = false;

  constructor(session: Session, best: number | null) {
    this.session = session;
    this.best = best;

    this.renderer = new THREE.WebGLRenderer({ antialias: !touchDevice, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, touchDevice ? 1.5 : 2));
    $('stage').appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 600);
    this.camera.rotation.order = 'YXZ';
    this.sky = new Sky(this.scene);

    const atlas = buildAtlas();
    const tex = new THREE.CanvasTexture(atlas.canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.solidMat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5 });
    this.waterMat = new THREE.MeshBasicMaterial({
      map: tex, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
    });

    for (let id = 0; id < BLOCKS.length; id++) {
      this.icons[id] = id === B.AIR ? '' : blockIcon(atlas, id);
      // Средний цвет боковой плитки - для частиц при ломании.
      const t = atlas.tiles[FACE_TILES[id * 3 + 2]!]!.getContext('2d')!.getImageData(0, 0, TILE, TILE).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < t.length; i += 4) {
        if (t[i + 3]! < 128) continue;
        r += t[i]!; g += t[i + 1]!; b += t[i + 2]!; n++;
      }
      this.tileColor[id] = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
    }

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.particles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial(), 96);
    this.particles.count = 0;
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.input = new Input(this.renderer.domElement, {
      breakStart: () => {
        this.breaking = true;
        this.lastBreak = 0;
      },
      breakEnd: () => (this.breaking = false),
      place: () => {
        this.lastPlace = performance.now();
        this.place();
      },
      pick: () => this.pickTarget(),
      slot: (n) => this.selectSlot(n),
      scroll: (d) => this.selectSlot((this.slot + d + this.hotbar.length) % this.hotbar.length),
      toggleFly: () => {
        this.body.flying = !this.body.flying;
        this.body.vy = 0;
        $('btn-down').hidden = !this.body.flying;
        toast(this.body.flying ? 'Полёт: вкл' : 'Полёт: выкл', 1200);
      },
      togglePicker: () => this.togglePicker(),
      toggleDebug: () => {
        this.debug = !this.debug;
        $('debug').hidden = !this.debug;
      },
      pause: () => this.openMenu(),
      lockLost: () => {
        // Один Esc - одно действие: вышли из полного экрана - игра ждёт клика, без меню.
        if (performance.now() - this.fullscreenExitAt < 800) toast('Полный экран выключен - кликни по миру, чтобы играть дальше', 3000);
        else this.openMenu();
      },
      gesture: () => this.sound.unlock(),
    });
    if (touchDevice) this.input.enableTouch();

    new ResizeObserver(() => this.resize()).observe($('app'));
    this.resize();
    this.bindUi();
  }

  // --- мир ---

  async start(): Promise<void> {
    const saved = await loadSave(this.session);
    const meta = saved?.meta;
    this.world = new World(meta?.seed ?? Math.floor(Math.random() * 2 ** 31));
    if (saved && saved.parts.length) {
      try {
        const chunks = saved.parts.map(fromBase64);
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let o = 0;
        for (const c of chunks) { all.set(c, o); o += c.length; }
        for (const [k, v] of decodeEdits(all)) this.world.edits.set(k, v);
        this.savedParts = [...saved.parts];
      } catch (e) {
        // Испорченная часть (не base64) - мир из сида без правок, но игра запускается.
        console.warn('k8s: правки мира не прочитались', e);
      }
    }
    if (meta) {
      this.time = meta.time;
      this.hotbar = meta.hotbar;
      this.slot = meta.slot;
      this.mined = meta.mined;
      this.submitted = meta.mined;
      if (meta.renderDistance) this.renderDistance = meta.renderDistance;
      this.sound.enabled = meta.sound;
    }
    const [px, py, pz, yaw, pitch] = meta?.player ?? [NaN, NaN, NaN, 0, 0];
    if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
      this.body = makeBody(px, py, pz);
      this.body.flying = meta?.flying ?? false;
    } else {
      this.body = this.findSpawn();
      this.dirty = true; // новый мир: сид надо сохранить, даже если игрок ничего не построил
    }
    this.input.yaw = yaw;
    this.input.pitch = pitch;
    $('btn-down').hidden = !this.body.flying;

    // Сначала мир вокруг игрока целиком - чтобы первый кадр был не пустым.
    this.stream(Infinity, 2);
    $('score').textContent = String(this.mined);
    this.renderHotbar();
    this.updateMenu();
    this.lastSave = performance.now();
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  private findSpawn(): Body {
    // Ближайшая к началу координат суша: спираль по колонкам.
    for (let r = 0; r < 400; r += 8) {
      for (let a = 0; a < Math.max(1, r); a += 4) {
        const ang = (a / Math.max(1, r)) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r);
        const z = Math.round(Math.sin(ang) * r);
        const c = this.world.gen.column(x, z);
        if (c.height > SEA + 1 && c.biome !== 'peaks') return makeBody(x + 0.5, c.height + 1, z + 0.5);
      }
    }
    return makeBody(0.5, HEIGHT - 10, 0.5);
  }

  /** Подгрузить и перестроить чанки в пределах бюджета времени (мс) на кадр. */
  private stream(budget: number, radius = this.renderDistance): void {
    const t0 = performance.now();
    const pcx = Math.floor(this.body.x) >> 4;
    const pcz = Math.floor(this.body.z) >> 4;
    const r2 = (radius + 0.5) ** 2;
    const load2 = (radius + 1.5) ** 2;
    let did = false;
    for (const [dx, dz] of OFFSETS) {
      const d2 = dx * dx + dz * dz;
      if (d2 > load2) break;
      if (did && performance.now() - t0 > budget) return;
      const cx = pcx + dx;
      const cz = pcz + dz;
      const c = this.world.chunk(cx, cz);
      if (!c) {
        this.world.load(cx, cz);
        did = true;
        continue;
      }
      if (d2 <= r2 && c.dirty && this.world.hasNeighbors(cx, cz)) {
        this.buildMesh(cx, cz);
        c.dirty = false;
        did = true;
      }
    }
    // Новый мир на старте: спавн мог попасть в пещеру - ставим на верхний твёрдый блок колонки.
    if (budget === Infinity && !this.started) this.settleSpawn();
  }

  private settleSpawn(): void {
    const b = this.body;
    if (!bodyCollides(b.x, b.y, b.z, (x, y, z) => SOLID[this.world.get(x, y, z)] === 1)) return;
    for (let y = HEIGHT - 2; y > 0; y--) {
      if (SOLID[this.world.get(Math.floor(b.x), y, Math.floor(b.z))]) {
        b.y = y + 1;
        return;
      }
    }
  }

  /**
   * Выгрузить чанки за запасом дальности, снять сетки за самой дальностью (`meshInRange`) и
   * спрятать сетки запаса (`meshVisible`). Зовётся раз в секунду, при переходе в другой чанк
   * и при смене дальности.
   */
  private unloadFar(): void {
    const pcx = Math.floor(this.body.x) >> 4;
    const pcz = Math.floor(this.body.z) >> 4;
    this.viewChunk = chunkKey(pcx, pcz);
    const keep = this.renderDistance + 2;
    for (const c of [...this.world.chunks.values()]) {
      const dx = c.cx - pcx;
      const dz = c.cz - pcz;
      const key = chunkKey(c.cx, c.cz);
      if (Math.abs(dx) > keep || Math.abs(dz) > keep) {
        this.dropMesh(key);
        this.world.unload(c.cx, c.cz);
      } else if (!meshInRange(dx, dz, this.renderDistance) && this.meshes.has(key)) {
        // Данные чанка остаются, сетку соберёт `stream`, когда игрок вернётся.
        this.dropMesh(key);
        c.dirty = true;
      } else {
        const m = this.meshes.get(key);
        const on = meshVisible(dx, dz, this.renderDistance);
        if (m?.solid) m.solid.visible = on;
        if (m?.water) m.water.visible = on;
      }
    }
  }

  private makeMesh(data: MeshData, mat: THREE.Material, cx: number, cz: number): THREE.Mesh | null {
    if (!data.indices.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3, true));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const half = (data.maxY - data.minY) / 2;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK / 2, data.minY + half, CHUNK / 2), Math.hypot(CHUNK / 2, CHUNK / 2, half));
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx * CHUNK, 0, cz * CHUNK);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.scene.add(m);
    return m;
  }

  private buildMesh(cx: number, cz: number): void {
    this.world.padded(cx, cz, this.padBuf);
    const data = meshChunk(this.padBuf, FACE_TILES);
    const key = chunkKey(cx, cz);
    this.dropMesh(key);
    const solid = this.makeMesh(data.solid, this.solidMat, cx, cz);
    const water = this.makeMesh(data.water, this.waterMat, cx, cz);
    if (water) water.renderOrder = 1;
    this.meshes.set(key, { solid, water });
  }

  private dropMesh(key: number): void {
    const m = this.meshes.get(key);
    if (!m) return;
    for (const mesh of [m.solid, m.water]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.delete(key);
  }

  // --- действия ---

  private canTarget = (x: number, y: number, z: number): boolean => {
    const id = this.world.get(x, y, z);
    return id !== B.AIR && id !== B.WATER;
  };

  private breakTarget(): void {
    const t = this.target;
    if (!t) return;
    const id = this.world.get(t.x, t.y, t.z);
    if (!BLOCKS[id]!.breakable) return;
    if (!this.world.set(t.x, t.y, t.z, B.AIR)) return;
    // Соседняя вода затекает в дыру и дальше по воздуху (water.ts).
    this.water.wake(this.world, t.x, t.y, t.z);
    // Песок и гравий над дырой осыпаются (falling.ts).
    this.falling.wake(this.world, t.x, t.y, t.z);
    this.mined++;
    $('score').textContent = String(this.mined);
    this.dirty = true;
    this.sound.dig(BLOCKS[id]!.pitch);
    this.burst(t.x + 0.5, t.y + 0.5, t.z + 0.5, id);
    if (id === B.SERVER) toast('kubectl drain: нода выведена из кластера');
    else if (id === B.CONTAINER) toast('Под удалён: OOMKilled');
  }

  private place(): void {
    const t = this.target;
    if (!t || !this.input.active) return;
    const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    const at = this.world.get(x, y, z);
    if (at !== B.AIR && at !== B.WATER) return;
    const id = this.hotbar[this.slot]!;
    const b = this.body;
    if (SOLID[id] && bodyCollides(b.x, b.y, b.z, (bx, by, bz) => bx === x && by === y && bz === z)) return;
    if (!this.world.set(x, y, z, id)) return;
    this.falling.wake(this.world, x, y, z);
    this.dirty = true;
    this.sound.place(BLOCKS[id]!.pitch);
    if (id === B.SERVER) toast('Нода добавлена в кластер');
    else if (id === B.CONTAINER) toast('Под запущен: Running');
  }

  private pickTarget(): void {
    const t = this.target;
    if (!t) return;
    const id = this.world.get(t.x, t.y, t.z);
    if (!BLOCKS[id]!.pickable) return;
    const have = this.hotbar.indexOf(id);
    if (have >= 0) this.selectSlot(have);
    else {
      this.hotbar[this.slot] = id;
      this.renderHotbar();
      this.showBlockName();
      this.dirty = true;
    }
  }

  private burst(x: number, y: number, z: number, id: BlockId): void {
    for (let i = 0; i < 10; i++) {
      if (this.particleState.length >= 96) this.particleState.shift();
      this.particleState.push({
        x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.6, z: z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4 + 1, vz: (Math.random() - 0.5) * 4,
        life: 0.5 + Math.random() * 0.4,
        color: this.tileColor[id]!,
      });
    }
  }

  private updateParticles(dt: number): void {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const p of this.particleState) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (SOLID[this.world.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))]) {
        p.vy = 0;
        p.vx *= 0.5;
        p.vz *= 0.5;
        p.y = Math.floor(p.y) + 1.07;
      }
      m.makeTranslation(p.x, p.y, p.z);
      this.particles.setMatrixAt(n, m);
      this.particles.setColorAt(n, p.color);
      n++;
    }
    for (let i = this.particleState.length - 1; i >= 0; i--) if (this.particleState[i]!.life <= 0) this.particleState.splice(i, 1);
    this.particles.count = n;
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  // --- кадр ---

  private tick(now: number): void {
    // Шаг ограничен: после свёрнутой вкладки игрок не должен пролететь сквозь мир.
    const frameMs = this.lastFrame ? now - this.lastFrame : 0;
    const dt = Math.min(frameMs / 1000, 0.05);
    this.lastFrame = now;
    this.measure(now, frameMs);
    this.frame++;
    this.frames++;
    if (now - this.fpsAt > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt || 1));
      this.frames = 0;
      this.fpsAt = now;
    }

    this.time = (this.time + dt / DAY_SECONDS) % 1;
    const b = this.body;
    const cx = Math.floor(b.x) >> 4;
    const cz = Math.floor(b.z) >> 4;
    // Физику считаем только над построенным чанком: иначе игрок провалится в незагруженный мир.
    if (this.world.chunk(cx, cz) && this.meshes.has(chunkKey(cx, cz))) {
      const mv = this.input.move();
      const flying = b.flying;
      stepBody(b, {
        forward: mv.forward,
        strafe: mv.strafe,
        jump: this.input.jump(),
        down: flying && this.input.down(),
        sprint: mv.sprint || (!flying && this.input.shift()),
        yaw: this.input.yaw,
        autoJump: this.input.touchMode,
      }, dt, (x, y, z) => SOLID[this.world.get(x, y, z)] === 1, (x, y, z) => this.world.get(x, y, z) === B.WATER);
      if (b.y < -20) {
        // Упали за край мира (дыра в коренной породе невозможна, но мало ли) - наверх.
        b.y = HEIGHT;
        b.vy = 0;
      }
      if (b.onGround && !b.flying) {
        this.stepDist += Math.hypot(b.vx, b.vz) * dt;
        if (this.stepDist > 1.7) {
          this.stepDist = 0;
          this.sound.step(BLOCKS[this.world.get(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z))]!.pitch);
        }
      }
      if (b.inWater && !this.wasInWater && b.vy < -4) this.sound.splash();
      this.wasInWater = b.inWater;
    }
    // Полёт выключается и сам - при приземлении; кнопка "вниз" следует за режимом.
    if ($('btn-down').hidden === b.flying) $('btn-down').hidden = !b.flying;

    const cam = this.camera;
    cam.position.set(b.x, b.y + EYE, b.z);
    cam.rotation.set(this.input.pitch, this.input.yaw, 0);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(cam.rotation);
    this.target = this.input.active
      ? raycast(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, REACH, this.canTarget)
      : null;
    if (this.target) {
      this.highlight.visible = true;
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else this.highlight.visible = false;

    if (this.breaking && this.input.active && now - this.lastBreak > REPEAT_MS) {
      this.lastBreak = now;
      this.breakTarget();
    }
    if (this.input.placeHeld && now - this.lastPlace > REPEAT_MS * 1.3) {
      this.lastPlace = now;
      this.place();
    }

    // Бюджет мал намеренно: долгий кадр ощущается как рывок мыши сильнее, чем поздний чанк.
    // Вода течёт шагами - видно, как она заполняет ход, и кадр не проседает на большой пещере.
    if (this.water.pending && now - this.lastFlow > 140) {
      this.lastFlow = now;
      if (this.water.step(this.world, 24)) this.dirty = true;
    }
    // Сыпучие падают быстрее, чем течёт вода: клетка за 60 мс.
    if (this.falling.pending && now - this.lastFall > 60) {
      this.lastFall = now;
      if (this.falling.step(this.world, 32)) this.dirty = true;
    }
    const s0 = performance.now();
    this.stream(touchDevice ? 3 : 4);
    this.perf.stream += performance.now() - s0;
    if (this.frame % 60 === 0 || chunkKey(Math.floor(b.x) >> 4, Math.floor(b.z) >> 4) !== this.viewChunk) this.unloadFar();

    const view = this.renderDistance * CHUNK;
    const { daylight } = this.sky.update(this.time, cam, view, b.headInWater, dt);
    this.solidMat.color.setScalar(daylight);
    this.waterMat.color.setScalar(daylight);
    $('water').hidden = !b.headInWater;
    this.updateParticles(dt);

    this.renderer.render(this.scene, cam);

    if (this.debug && this.frame % 15 === 0) this.updateDebug();
    if (this.dirty && now - this.lastSave > AUTOSAVE_MS) void this.save();
  }

  private measure(now: number, frameMs: number): void {
    const p = this.perf;
    if (frameMs > 0) {
      p.frames++;
      p.sum += frameMs;
      if (frameMs > p.worst) p.worst = frameMs;
      // Дольше двух кадров при 60 Гц - глаз и рука замечают рывок.
      if (frameMs > 34) p.slow++;
    }
    if (now - p.at < 1000) return;
    const m = this.input.mouseStats;
    this.perfShown = {
      avg: p.frames ? p.sum / p.frames : 0, worst: p.worst, slow: p.slow, stream: p.stream,
      mouse: m.events, step: m.maxStep, dropped: m.dropped,
    };
    this.perf = { at: now, frames: 0, sum: 0, worst: 0, slow: 0, stream: 0 };
    m.events = 0;
    m.maxStep = 0;
    m.dropped = 0;
  }

  private updateDebug(): void {
    const b = this.body;
    const q = this.perfShown;
    const raw = this.input.rawMouse === null ? '-' : this.input.rawMouse ? 'сырой' : 'обычный';
    const col = this.world.gen.column(Math.floor(b.x), Math.floor(b.z));
    const info = this.renderer.info.render;
    $('debug').textContent = [
      `fps ${this.fps} · кадр ${q.avg.toFixed(1)} мс, худший ${q.worst.toFixed(0)} мс · рывков ${q.slow}/с`,
      `чанки ${q.stream.toFixed(0)} мс/с · экран ${this.renderer.domElement.width}×${this.renderer.domElement.height}`,
      `мышь ${q.mouse} соб/с · макс шаг ${q.step} px · отсеяно ${q.dropped} · ввод ${raw}`,
      `xyz ${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.z.toFixed(1)}`,
      `чанк ${Math.floor(b.x) >> 4} ${Math.floor(b.z) >> 4} · биом ${BIOME_NAMES[col.biome]}`,
      `чанков ${this.world.chunks.size} · сеток ${this.meshes.size}`,
      `вызовов ${info.calls} · треугольников ${info.triangles}`,
      `сид ${this.world.seed}`,
    ].join('\n');
  }

  private resize(): void {
    const el = $('app');
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    // Полный экран хаба изнутри iframe виден только по размеру окна.
    const host = this.hostFullscreen();
    if (this.wasHostFullscreen && !host) this.fullscreenExitAt = performance.now();
    this.wasHostFullscreen = host;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.input?.touchMode && h > w * 1.1 && !document.fullscreenElement) {
      toast(document.fullscreenEnabled ? 'Удобнее боком: кнопка справа вверху - на весь экран с поворотом' : 'Поверни телефон боком - так удобнее', 3500);
    }
  }

  // --- сохранение ---

  private meta(parts: number): WorldMeta {
    const b = this.body;
    return {
      v: SAVE_VERSION,
      seed: this.world.seed,
      time: this.time,
      player: [b.x, b.y, b.z, this.input.yaw, this.input.pitch],
      flying: b.flying,
      hotbar: this.hotbar,
      slot: this.slot,
      mined: this.mined,
      parts,
      renderDistance: this.renderDistance,
      sound: this.sound.enabled,
    };
  }

  async save(): Promise<void> {
    if (this.saving || !this.world) return;
    this.saving = true;
    this.lastSave = performance.now();
    this.dirty = false;
    try {
      const parts = splitParts(encodeEdits(this.world.edits));
      if (!parts) {
        toast('Мир не влезает в сохранение: последние постройки не сохранятся', 4000, 'warn');
      } else {
        for (let i = 0; i < parts.length; i++) {
          if (this.savedParts[i] === parts[i]) continue;
          await this.session.save(`edits.${i}`, parts[i]);
          this.savedParts[i] = parts[i]!;
          // Мост хаба пропускает 20 сообщений в секунду на вкладку (D-050) - не упираемся в лимит.
          await sleep(60);
        }
        await this.session.save('world', this.meta(parts.length));
      }
      if (this.mined > this.submitted) {
        const r = await this.session.submitScore(this.mined);
        this.submitted = this.mined;
        this.best = r.best;
        $('best').textContent = String(r.best);
      }
    } catch (e) {
      this.dirty = true;
      console.warn('k8s: мир не сохранился', e);
    } finally {
      this.saving = false;
    }
  }

  // --- интерфейс ---

  private selectSlot(n: number): void {
    this.slot = n;
    this.renderHotbar();
    this.showBlockName();
  }

  /** Название блока над лотком: живёт в самом лотке, появляется при смене ячейки. */
  private readonly blockName = Object.assign(document.createElement('span'), { className: 'gf-hotbar__name', hidden: true });
  private nameTimer = 0;
  private showBlockName(): void {
    const el = this.blockName;
    el.textContent = BLOCKS[this.hotbar[this.slot]!]!.name;
    el.hidden = false;
    replay(el);
    clearTimeout(this.nameTimer);
    this.nameTimer = window.setTimeout(() => (el.hidden = true), 1200);
  }

  private renderHotbar(): void {
    const bar = $('hotbar');
    bar.replaceChildren(this.blockName, ...this.hotbar.map((id, i) => {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'gf-slot';
      s.setAttribute('aria-pressed', String(i === this.slot));
      s.setAttribute('aria-label', BLOCKS[id]!.name);
      s.title = BLOCKS[id]!.name;
      const img = document.createElement('img');
      img.src = this.icons[id]!;
      img.alt = '';
      const key = document.createElement('span');
      key.className = 'gf-slot__key';
      key.textContent = String(i + 1);
      // Номер клавиши на телефоне не нужен: клавиатуры нет.
      key.hidden = this.input.touchMode;
      s.append(img, key);
      s.addEventListener('click', () => this.selectSlot(i));
      return s;
    }));
  }

  private togglePicker(): void {
    const picker = $('picker');
    if (!picker.hidden) return this.closePicker();
    const grid = $('picker-grid');
    grid.replaceChildren(...BLOCKS.flatMap((b, id) => {
      if (!b.pickable) return [];
      const btn = document.createElement('button');
      btn.type = 'button';
      const img = document.createElement('img');
      img.src = this.icons[id]!;
      img.alt = '';
      const label = document.createElement('span');
      label.textContent = b.name;
      btn.append(img, label);
      btn.addEventListener('click', () => {
        this.hotbar[this.slot] = id;
        this.dirty = true;
        this.renderHotbar();
        this.closePicker();
        this.showBlockName();
      });
      return [btn];
    }));
    picker.hidden = false;
    this.input.active = false;
    this.input.releaseAll();
    this.input.unlock();
  }

  private closePicker(): void {
    $('picker').hidden = true;
    if ($('menu').hidden) {
      this.input.active = true;
      this.input.lock();
    }
  }

  private openMenu(): void {
    if (!$('picker').hidden) return;
    $('menu').hidden = false;
    this.input.active = false;
    this.input.releaseAll();
    this.input.unlock();
    this.updateMenu();
    if (this.dirty) void this.save();
  }

  private resume(): void {
    $('menu').hidden = true;
    $('new-world').classList.remove('armed');
    $('new-world').textContent = 'Новый мир';
    this.input.active = true;
    this.started = true;
    this.input.lock();
  }

  private updateMenu(): void {
    $('rd').textContent = String(this.renderDistance);
    $('sound-label').textContent = `Звук: ${this.sound.enabled ? 'вкл' : 'выкл'}`;
    setIcon($('sound'), this.sound.enabled ? 'sound-on' : 'sound-off');
    $('play-label').textContent = this.started ? 'Продолжить' : 'Играть';
    ($('play') as HTMLButtonElement).disabled = !this.world;
    $('status').textContent = this.started ? 'кластер работает · все поды Running' : 'кластер развёрнут: 1/1 нода готова';
    $('persist').textContent = this.session.persistent
      ? (this.session.mode === 'hub' ? 'Мир сохраняется в хабе.' : 'Мир сохраняется в этом браузере.')
      : 'Хранилище недоступно: мир проживёт до закрытия вкладки.';
  }

  /**
   * Похоже на полноэкранный режим, включённый не игрой, а страницей хаба (её кнопка
   * "На весь экран" разворачивает весь iframe): изнутри iframe его не видно и не выключить.
   */
  private hostFullscreen(): boolean {
    return !document.fullscreenElement && window.innerWidth >= screen.width - 2 && window.innerHeight >= screen.height - 2;
  }

  private syncFullscreenButtons(): void {
    const on = !!document.fullscreenElement;
    const name = on ? 'exit-fullscreen' : 'fullscreen';
    const btn = $('btn-fs');
    setIcon(btn, name);
    btn.title = on ? 'Выйти из полноэкранного режима' : 'На весь экран';
    btn.setAttribute('aria-label', btn.title);
    setIcon($('fs'), name);
    $('fs-label').textContent = on ? 'Выйти из полноэкранного' : 'На весь экран';
  }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      // Сначала снять разворот: на части Android выход с зафиксированной ориентацией залипает.
      try {
        screen.orientation.unlock();
      } catch {
        // нет разворота - нечего снимать
      }
      try {
        await document.exitFullscreen();
      } catch (e) {
        toast(`Не вышло выйти (${e instanceof Error ? e.name : 'ошибка'}): кнопка "Назад" или Esc`, 4000, 'err');
      }
      return;
    }
    if (this.hostFullscreen()) {
      toast('Полный экран включил хаб - выйти: кнопка "Назад" или Esc', 4000);
      return;
    }
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (this.input.touchMode) {
        // Разворот есть не везде (iOS - нет) и только в полноэкранном режиме - отказ не ошибка.
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        await o.lock?.('landscape').catch(() => undefined);
      }
    } catch {
      toast('Полноэкранный режим недоступен', 2200, 'err');
    }
  }

  private bindUi(): void {
    $('play').addEventListener('click', () => this.resume());
    $('btn-menu').addEventListener('click', () => ($('menu').hidden ? this.openMenu() : this.resume()));
    $('btn-picker').addEventListener('click', () => this.togglePicker());
    $('picker-close').addEventListener('click', () => this.closePicker());
    const setRd = (d: number): void => {
      this.renderDistance = Math.max(2, Math.min(MAX_RD, this.renderDistance + d));
      this.dirty = true;
      // Меньше дальность - сразу меньше сеток, а не через секунду в цикле.
      if (this.world) this.unloadFar();
      this.updateMenu();
    };
    $('rd-minus').addEventListener('click', () => setRd(-1));
    $('rd-plus').addEventListener('click', () => setRd(1));
    $('sound').addEventListener('click', () => {
      this.sound.enabled = !this.sound.enabled;
      this.dirty = true;
      this.updateMenu();
    });
    if (document.fullscreenEnabled) {
      $('btn-fs').hidden = false;
      $('fs').hidden = false;
      $('btn-fs').addEventListener('click', () => void this.toggleFullscreen());
      $('fs').addEventListener('click', () => void this.toggleFullscreen());
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) this.fullscreenExitAt = performance.now();
        this.syncFullscreenButtons();
      });
    }
    // Новый мир - в два нажатия: окна подтверждения в песочнице хаба нет (allow-modals закрыт).
    $('new-world').addEventListener('click', () => {
      const btn = $('new-world');
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed');
        btn.textContent = 'Точно? Текущий мир сотрётся';
        return;
      }
      void this.newWorld();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !$('picker').hidden) this.closePicker();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.dirty) void this.save();
    });
  }

  private async newWorld(): Promise<void> {
    for (const key of [...this.meshes.keys()]) this.dropMesh(key);
    this.water.clear();
    this.falling.clear();
    this.world = new World(Math.floor(Math.random() * 2 ** 31));
    this.body = this.findSpawn();
    this.time = 0.3;
    this.savedParts = [];
    this.started = false;
    this.stream(Infinity, 2);
    this.dirty = true;
    await this.save();
    this.resume();
    toast('Новый кластер развёрнут', 2200, 'ok');
  }
}

// Без top-level await: офлайн-сборка - классический скрипт (IIFE), там его нет.
async function main(): Promise<void> {
  fillIcons(document);
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });
  $('mode').textContent = session.mode === 'hub' ? 'в хабе' : 'без хаба';
  const best = await session.bestScore();
  $('best').textContent = best === null ? '-' : String(best);
  const game = new Game(session, best);
  await game.start();
  ($('play') as HTMLButtonElement).disabled = false;
  session.ready();
}

void main();
