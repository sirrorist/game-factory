import { GameFactory, type Session } from '@gf/game-sdk';
import * as THREE from 'three';
import './style.css';

const WIDTH = 480;
const HEIGHT = 480;
const LANES = [-2, 0, 2] as const;
const SPAWN_Z = -60;
const ROAD_HALF = 3.4;
// Цвета - как на обложке (public/cover.svg): закат, неоновая дорога, красные блоки, зелёный шар.
const NEON = 0x58a6ff;
const HORIZON = 0x2a2a63;

const $ = (id: string): HTMLElement => document.getElementById(id)!;

interface Block {
  mesh: THREE.Mesh;
  lane: number;
}

/** Небо - вертикальный градиент на холсте: текстура кодом, в архиве нет файлов (П-019). */
function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0b1026');
  g.addColorStop(0.6, '#2a2a63');
  g.addColorStop(1, '#6b3f78');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Солнце в полоску: жёлто-красный круг, нижняя половина порезана полосами цвета горизонта. */
function sunTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#f2cc60');
  g.addColorStop(1, '#ff7b72');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 124, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) {
    const y = 140 + i * 20;
    ctx.fillRect(0, y, 256, 4 + i * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function startGame(session: Session): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Размер холста задаёт CSS (квадрат по .stage), буфер рисования - под него: без размытия
  // при растяжении на полный экран. Камера квадратная, aspect не меняется.
  renderer.setSize(WIDTH, HEIGHT, false);
  $('stage').appendChild(renderer.domElement);
  new ResizeObserver(() => {
    const el = renderer.domElement;
    if (el.clientWidth > 0) renderer.setSize(el.clientWidth, el.clientHeight, false);
  }).observe(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  // Туман цвета горизонта: блоки выплывают из закатной дымки.
  scene.fog = new THREE.Fog(HORIZON, 24, 62);

  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 200);
  camera.position.set(0, 4, 7);
  camera.lookAt(0, 0, -6);

  scene.add(new THREE.HemisphereLight(0xb9b4ff, 0x1a1030, 1.1));
  const sunLight = new THREE.DirectionalLight(0xffc89a, 1.6);
  sunLight.position.set(0, 6, -10);
  scene.add(sunLight);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(3, 8, 6);
  scene.add(fill);

  // Солнце и звёзды - за туманом, им он не нужен.
  const sun = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({ map: sunTexture(), transparent: true, fog: false, depthWrite: false }),
  );
  sun.position.set(0, 4, -110);
  scene.add(sun);
  const starPos: number[] = [];
  for (let i = 0; i < 160; i++) starPos.push((Math.random() - 0.5) * 220, 12 + Math.random() * 60, -120 - Math.random() * 20);
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75 }),
  );
  scene.add(stars);

  // Земля с неоновой сеткой; сетка едет навстречу - видно скорость.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 160), new THREE.MeshBasicMaterial({ color: 0x0d1117 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, -60);
  scene.add(ground);
  const grid = new THREE.GridHelper(240, 60, NEON, NEON);
  const gridMat = grid.material as THREE.LineBasicMaterial;
  gridMat.transparent = true;
  gridMat.opacity = 0.22;
  grid.position.set(0, -0.01, -60);
  scene.add(grid);
  const GRID_CELL = 240 / 60;

  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 160), new THREE.MeshBasicMaterial({ color: 0x161b2a }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = -60;
  scene.add(road);
  const neon = new THREE.MeshBasicMaterial({ color: NEON });
  for (const x of [-ROAD_HALF, ROAD_HALF]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 160), neon);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(x, 0.01, -60);
    scene.add(edge);
  }
  // Пунктир между полосами - отрезки, которые едут вместе с миром.
  const DASH_STEP = 4;
  const dashGeo = new THREE.PlaneGeometry(0.08, 1.8);
  const dashMat = new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.8 });
  const dashes: THREE.Mesh[] = [];
  for (const x of [-1, 1]) {
    for (let z = 4; z > -100; z -= DASH_STEP) {
      const d = new THREE.Mesh(dashGeo, dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0.01, z);
      scene.add(d);
      dashes.push(d);
    }
  }

  const player = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0x7ee787, emissive: 0x1f6f2a, emissiveIntensity: 0.6, roughness: 0.35 }),
  );
  player.position.y = 0.5;
  scene.add(player);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.2, 0.6, 1);
  shadow.position.y = 0.02;
  scene.add(shadow);

  const blockGeometry = new THREE.BoxGeometry(1.4, 1, 1);
  // Грань сверху светлее - как на обложке: верх #ffa198, бока #ff7b72.
  const blockMaterial = new THREE.MeshStandardMaterial({ color: 0xff7b72, emissive: 0x5a1410, emissiveIntensity: 0.5, roughness: 0.6 });
  let blocks: Block[] = [];

  let lane = 1;
  let running = false;
  let score = 0;
  let distance = 0;
  let speed = 14;
  let untilSpawn = 0;

  const setLane = (next: number): void => {
    lane = Math.max(0, Math.min(LANES.length - 1, next));
  };

  const reset = (): void => {
    for (const b of blocks) scene.remove(b.mesh);
    blocks = [];
    lane = 1;
    player.position.x = LANES[1];
    score = 0;
    distance = 0;
    speed = 14;
    untilSpawn = 0;
    $('score').textContent = '0';
    $('message').textContent = 'Уворачивайся! ← → или касание слева / справа.';
    running = true;
  };

  const gameOver = async (): Promise<void> => {
    running = false;
    $('message').textContent = `Игра окончена: ${score}. Пробел или касание - ещё раз.`;
    try {
      const r = await session.submitScore(score);
      $('best').textContent = String(r.best);
      if (r.isBest && score > 0) $('message').textContent = `Новый рекорд: ${score}! Пробел или касание - ещё раз.`;
    } catch (e) {
      console.warn('gf: очки не приняты', e);
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') setLane(lane - 1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') setLane(lane + 1);
    else if (e.code === 'Space' && !running) reset();
    else return;
    e.preventDefault();
  });
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!running) return reset();
    const rect = renderer.domElement.getBoundingClientRect();
    setLane(lane + (e.clientX - rect.left < rect.width / 2 ? -1 : 1));
  });

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    // Шаг ограничен: после сворачивания вкладки блоки не должны "телепортироваться".
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const targetX = LANES[lane]!;
    player.position.x += (targetX - player.position.x) * Math.min(1, dt * 14);
    player.rotation.x -= dt * speed * 0.8;
    shadow.position.x = player.position.x;

    // Дорога едет всегда - и в меню, чтобы сцена жила; в игре - со скоростью игры.
    const flow = (running ? speed : 6) * dt;
    for (const d of dashes) {
      d.position.z += flow;
      if (d.position.z > 6) d.position.z -= DASH_STEP * Math.ceil(104 / DASH_STEP);
    }
    grid.position.z = -60 + ((grid.position.z + 60 + flow) % GRID_CELL);

    if (running) {
      distance += speed * dt;
      speed += dt * 0.4;
      untilSpawn -= dt;
      if (untilSpawn <= 0) {
        // Всегда оставляем хотя бы одну свободную полосу.
        const free = Math.floor(Math.random() * LANES.length);
        for (let i = 0; i < LANES.length; i++) {
          if (i === free || Math.random() < 0.55) continue;
          const mesh = new THREE.Mesh(blockGeometry, blockMaterial);
          mesh.position.set(LANES[i]!, 0.5, SPAWN_Z);
          scene.add(mesh);
          blocks.push({ mesh, lane: i });
        }
        untilSpawn = Math.max(0.45, 1.1 - distance / 800);
      }

      for (const b of blocks) b.mesh.position.z += speed * dt;
      const hit = blocks.some((b) => Math.abs(b.mesh.position.z) < 0.9 && Math.abs(b.mesh.position.x - player.position.x) < 1.1);
      const passed = blocks.filter((b) => b.mesh.position.z > 3);
      for (const b of passed) scene.remove(b.mesh);
      blocks = blocks.filter((b) => b.mesh.position.z <= 3);
      score = Math.floor(distance / 10);
      $('score').textContent = String(score);
      if (hit) void gameOver();
    }

    renderer.render(scene, camera);
  });
}

// Без top-level await: офлайн-сборка - классический скрипт (IIFE), там его нет.
async function main(): Promise<void> {
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });
  $('mode').textContent = session.mode === 'hub' ? 'в хабе' : 'без хаба';
  const best = await session.bestScore();
  $('best').textContent = best === null ? '-' : String(best);
  startGame(session);
  session.ready();
}

void main();
