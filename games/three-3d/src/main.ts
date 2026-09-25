import { GameFactory, type Session } from '@gf/game-sdk';
import * as THREE from 'three';
import './style.css';

const WIDTH = 480;
const HEIGHT = 480;
const LANES = [-2, 0, 2] as const;
const SPAWN_Z = -60;

const $ = (id: string): HTMLElement => document.getElementById(id)!;

interface Block {
  mesh: THREE.Mesh;
  lane: number;
}

function startGame(session: Session): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(WIDTH, HEIGHT);
  $('stage').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);
  scene.fog = new THREE.Fog(0x0d1117, 20, 60);

  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 100);
  camera.position.set(0, 4, 7);
  camera.lookAt(0, 0, -6);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(3, 8, 5);
  scene.add(sun);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 140), new THREE.MeshStandardMaterial({ color: 0x161b22 }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = -50;
  scene.add(road);
  for (const x of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 140), new THREE.MeshBasicMaterial({ color: 0x30363d }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.01, -50);
    scene.add(line);
  }

  const player = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), new THREE.MeshStandardMaterial({ color: 0x7ee787 }));
  player.position.y = 0.5;
  scene.add(player);

  const blockGeometry = new THREE.BoxGeometry(1.4, 1, 1);
  const blockMaterial = new THREE.MeshStandardMaterial({ color: 0xff7b72 });
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
    $('message').textContent = `Игра окончена: ${score}. Пробел или касание — ещё раз.`;
    try {
      const r = await session.submitScore(score);
      $('best').textContent = String(r.best);
      if (r.isBest && score > 0) $('message').textContent = `Новый рекорд: ${score}! Пробел или касание — ещё раз.`;
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
    // Шаг ограничен: после сворачивания вкладки блоки не должны «телепортироваться».
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const targetX = LANES[lane]!;
    player.position.x += (targetX - player.position.x) * Math.min(1, dt * 14);
    player.rotation.x -= dt * speed * 0.8;

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

// Без top-level await: офлайн-сборка — классический скрипт (IIFE), там его нет.
async function main(): Promise<void> {
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });
  $('mode').textContent = session.mode === 'hub' ? 'в хабе' : 'без хаба';
  const best = await session.bestScore();
  $('best').textContent = best === null ? '—' : String(best);
  startGame(session);
  session.ready();
}

void main();
