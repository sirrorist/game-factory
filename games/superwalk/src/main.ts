import * as THREE from 'three';
import { GameFactory, type Session } from '@gf/game-sdk';
import { fillIcons, setIcon } from './icons.ts';
import { Input } from './input.ts';
import { stepPlayer, getTerrainHeight, getSurfaceHeight, DEFAULT_PLAYER_PARAMS, type PlayerState, type PlayerParams } from './core/movement.ts';
import { generateWorld, type WorldData } from './core/world.ts';
import {
  createInitialCombatState,
  stepCombat,
  spawnMobInRing,
  getWaveTargetCount,
  getAvailableMobTypes,
  type CombatState,
} from './core/combat.ts';
import {
  HERO_CONFIG,
  getRequiredExp,
  WEAPON_CONFIGS,
  TOME_CONFIGS,
  ITEM_CONFIGS,
  INITIAL_CHEST_COUNT,
  MAX_ACTIVE_CHESTS,
  type ItemId,
  type ItemConfig,
} from './core/content.ts';
import {
  createInitialChests,
  stepChests,
  checkChestPickup,
  rollChestItem,
  getItemStatBonuses,
  type ChestEntity,
} from './core/chests.ts';
import {
  createInitialInventory,
  rollUpgradeChoices,
  applyUpgrade,
  type PlayerInventory,
  type UpgradeOption,
} from './core/upgrades.ts';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Элемент #${id} не найден`);
  return el as T;
};

let toastTimeout: number | undefined;
function toast(message: string, durationMs = 2800, type: 'info' | 'ok' | 'err' = 'info'): void {
  const el = $('toast');
  el.textContent = message;
  el.className = 'gf-toast' + (type === 'ok' ? ' gf-toast--ok' : type === 'err' ? ' gf-toast--err' : '');
  el.hidden = false;
  if (toastTimeout !== undefined) clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    el.hidden = true;
  }, durationMs);
}

function createGemTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  const glow = ctx.createRadialGradient(32, 32, 8, 32, 32, 32);
  glow.addColorStop(0, 'rgba(72, 202, 228, 0.55)');
  glow.addColorStop(1, 'rgba(72, 202, 228, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);

  // Ограненный кристалл (ромб)
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(54, 26);
  ctx.lineTo(32, 58);
  ctx.lineTo(10, 26);
  ctx.closePath();
  ctx.fillStyle = '#48cae4';
  ctx.fill();

  // Грани
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(32, 30);
  ctx.lineTo(10, 26);
  ctx.closePath();
  ctx.fillStyle = '#caf0f8';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(54, 26);
  ctx.lineTo(32, 30);
  ctx.closePath();
  ctx.fillStyle = '#90e0ef';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(10, 26);
  ctx.lineTo(32, 30);
  ctx.lineTo(32, 58);
  ctx.closePath();
  ctx.fillStyle = '#0077b6';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(54, 26);
  ctx.lineTo(32, 58);
  ctx.lineTo(32, 30);
  ctx.closePath();
  ctx.fillStyle = '#023e8a';
  ctx.fill();

  // Блик
  ctx.beginPath();
  ctx.arc(28, 22, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  return new THREE.CanvasTexture(canvas);
}

function createBossStumpModel(): { group: THREE.Group; eyesMat: THREE.MeshBasicMaterial } {
  const group = new THREE.Group();

  const trunkGeo = new THREE.CylinderGeometry(1.6, 2.2, 2.2, 8);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3d2314, flatShading: true });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.1;
  group.add(trunk);

  const cutGeo = new THREE.CylinderGeometry(1.55, 1.55, 0.1, 8);
  const cutMat = new THREE.MeshLambertMaterial({ color: 0x8a6240, flatShading: true });
  const cut = new THREE.Mesh(cutGeo, cutMat);
  cut.position.y = 2.22;
  group.add(cut);

  const rootGeo = new THREE.BoxGeometry(0.8, 0.7, 1.6);
  const rootMat = new THREE.MeshLambertMaterial({ color: 0x2b180d, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5;
    const root = new THREE.Mesh(rootGeo, rootMat);
    root.position.set(Math.cos(angle) * 1.8, 0.35, Math.sin(angle) * 1.8);
    root.rotation.y = angle;
    root.rotation.x = 0.2;
    group.add(root);
  }

  const hollowGeo = new THREE.BoxGeometry(0.9, 0.6, 0.4);
  const hollowMat = new THREE.MeshBasicMaterial({ color: 0x0a0503 });
  const hollow = new THREE.Mesh(hollowGeo, hollowMat);
  hollow.position.set(0, 1.3, -1.9);
  group.add(hollow);

  const eyesMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 5), eyesMat);
  eyeL.position.set(-0.25, 1.32, -1.95);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 5), eyesMat);
  eyeR.position.set(0.25, 1.32, -1.95);
  group.add(eyeL, eyeR);

  group.visible = false;
  return { group, eyesMat };
}

interface ActiveDamageNumber {
  el: HTMLDivElement;
  worldX: number;
  worldY: number;
  worldZ: number;
  elapsed: number;
  duration: number;
  vy: number;
}

class SuperwalkApp {
  private session: Session;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private input: Input;
  private world: WorldData;
  private damageLayer: HTMLElement;
  private activeDamageNumbers: ActiveDamageNumber[] = [];

  private paused = false;
  private debug = false;

  private playerState: PlayerState = {
    x: 0,
    y: 0,
    z: 0,
    vy: 0,
    grounded: true,
    yaw: 0,
  };
  private playerParams: PlayerParams = { ...DEFAULT_PLAYER_PARAMS };
  private runTime = 0;

  // Инвентарь и карточки прокачки
  private inventory: PlayerInventory = createInitialInventory();
  private upgradeModalOpen = false;
  private upgradeModalOpenedAt = 0;
  private currentUpgradeChoices: UpgradeOption[] = [];

  // Окно Tab (единый 3-колоночный тактический обзор)
  private tabModalOpen = false;

  // Боевая система и мобы
  private combatState: CombatState;
  private spawnTimer = 0;
  private prngSeed = 42;
  private bossSpawned = false;

  // Сундуки и 14 предметов (DESIGN.md, раздел 5.3)
  private chests: ChestEntity[] = [];
  private lastChestMinute = 0;
  private ownedItems = new Map<ItemId, number>();
  private chestBaseMesh: THREE.InstancedMesh;
  private chestLidMesh: THREE.InstancedMesh;
  private chestLockMesh: THREE.InstancedMesh;
  private itemPopupTimeout?: number;

  // Меши мобов, снарядов и кристаллов (InstancedMesh)
  private mushletStemMesh: THREE.InstancedMesh;
  private mushletCapMesh: THREE.InstancedMesh;
  private beetleBodyMesh: THREE.InstancedMesh;
  private beetleHornMesh: THREE.InstancedMesh;
  private owlBodyMesh: THREE.InstancedMesh;
  private owlEyesMesh: THREE.InstancedMesh;
  private projMesh: THREE.InstancedMesh;
  private sparkProjMesh: THREE.InstancedMesh;
  private gemMesh: THREE.InstancedMesh;
  private beamMesh: THREE.InstancedMesh;

  // 3D-модель босса Старый Пень
  private bossGroup: THREE.Group;
  private bossEyesMat: THREE.MeshBasicMaterial;

  // Эффект взмаха хвостом (tail_blade)
  private slashMesh: THREE.Mesh;
  private slashMat: THREE.MeshBasicMaterial;
  private slashTimer = 0;

  // Эффект выстрела пращи (spark_sling)
  private sparkFlashMesh: THREE.Mesh;
  private sparkFlashMat: THREE.MeshBasicMaterial;
  private sparkFlashTimer = 0;

  // Эффект огненной волны (ninth_tail)
  private fireWaveMesh: THREE.Mesh;
  private fireWaveMat: THREE.MeshBasicMaterial;
  private fireWaveTimer = 0;

  private mobDummy = new THREE.Object3D();
  private tempDmgVec = new THREE.Vector3();
  private flashColor = new THREE.Color();
  private defaultBeetleColor = new THREE.Color(0x1d3557);

  private lastTime = performance.now();
  private frameCount = 0;
  private fps = 60;
  private fpsTimer = performance.now();
  private frameTimes: number[] = [];
  private worstFrameMs = 0;
  private slowFramesCount = 0;
  private perfAvgMs = 16.6;
  private perfWorstMs = 16.6;
  private perfSlowPerSec = 0;

  private heroGroup: THREE.Group;
  private tailPivot: THREE.Group;
  private shadowMesh: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;

  private fullscreenExitAt = -Infinity;
  private wasHostFullscreen = false;

  constructor(session: Session, best: number | null) {
    this.session = session;
    const touchDevice = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);

    // 1. WebGL рендерер с соблюдением бюджета (docs/GAME-TZ.md):
    // antialias отключен на тач-устройствах, dpr ограничен до 1.5 на таче и до 2 на ПК.
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: !touchDevice,
    });
    const maxDpr = touchDevice ? 1.5 : 2.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
    $('stage').appendChild(this.renderer.domElement);

    // 2. Сцена и камера
    this.scene = new THREE.Scene();
    const skyColor = 0xd8e8f8;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, 35, 110);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 150);
    this.camera.position.set(0, 3.8, 6.2);
    this.camera.lookAt(0, 1.0, 0);

    // 3. Освещение: одна направленная лампа (мягкие тени) и рассеянный свет
    const ambient = new THREE.AmbientLight(0xfff1de, 0.75);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffeed6, 1.3);
    sun.position.set(30, 45, 20);
    this.scene.add(sun);

    // 4. Локация: "Солнечные холмы" - мягкая low-poly поляна 140x140 м
    const groundGeo = new THREE.PlaneGeometry(140, 140, 36, 36);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes['position'];
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const h = getTerrainHeight(x, z);
        pos.setY(i, h);
      }
      groundGeo.computeVertexNormals();
    }
    const groundMat = new THREE.MeshLambertMaterial({
      color: 0x8ec968,
      flatShading: true,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.scene.add(groundMesh);

    // 5. Силуэт героя (Лис: лапки на земле y=0, рыжий low-poly лис, хвост с белым кончиком, шарф)
    // Стандарт Three.js: лис изначально смотрит вперёд вглубь экрана (-Z).
    // Мордочка и нос направлены в -Z, пушистый хвост - сзади на +Z.
    this.heroGroup = new THREE.Group();
    this.heroGroup.position.set(0, 0, 0);

    const foxOrange = new THREE.MeshLambertMaterial({ color: 0xff7a1a, flatShading: true });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const scarfMat = new THREE.MeshLambertMaterial({ color: 0x3d7cd8, flatShading: true });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x221a16, flatShading: true });

    // Лапки (опираются строго на землю y = 0: передние на -Z, задние на +Z)
    const legGeo = new THREE.BoxGeometry(0.12, 0.24, 0.14);
    const legPositions: [number, number, number][] = [
      [-0.15, 0.12, -0.14],
      [0.15, 0.12, -0.14],
      [-0.15, 0.12, 0.12],
      [0.15, 0.12, 0.12],
    ];
    for (const [lx, ly, lz] of legPositions) {
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(lx, ly, lz);
      this.heroGroup.add(leg);
    }

    // Тело (расположено над лапками: y от 0.22 до 0.77)
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.35, 0.55, 7);
    const bodyMesh = new THREE.Mesh(bodyGeo, foxOrange);
    bodyMesh.position.set(0, 0.48, 0);
    this.heroGroup.add(bodyMesh);

    // Голова (смещена вперёд к -Z)
    const headGeo = new THREE.BoxGeometry(0.42, 0.38, 0.44);
    const headMesh = new THREE.Mesh(headGeo, foxOrange);
    headMesh.position.set(0, 0.88, -0.08);
    this.heroGroup.add(headMesh);

    // Мордочка с белым кончиком (направлена вперёд по -Z)
    const muzzleGeo = new THREE.ConeGeometry(0.16, 0.3, 5);
    muzzleGeo.rotateX(-Math.PI / 2);
    const muzzleMesh = new THREE.Mesh(muzzleGeo, whiteMat);
    muzzleMesh.position.set(0, 0.82, -0.38);
    this.heroGroup.add(muzzleMesh);

    const noseMesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), darkMat);
    noseMesh.position.set(0, 0.82, -0.54);
    this.heroGroup.add(noseMesh);

    // Ушки
    const earGeo = new THREE.ConeGeometry(0.1, 0.24, 4);
    const leftEar = new THREE.Mesh(earGeo, foxOrange);
    leftEar.position.set(-0.16, 1.15, -0.05);
    leftEar.rotation.z = 0.2;
    const rightEar = new THREE.Mesh(earGeo, foxOrange);
    rightEar.position.set(0.16, 1.15, -0.05);
    rightEar.rotation.z = -0.2;
    this.heroGroup.add(leftEar, rightEar);

    // Шарф
    const scarfMesh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 5, 8), scarfMat);
    scarfMesh.rotation.x = Math.PI / 2;
    scarfMesh.position.set(0, 0.72, -0.06);
    this.heroGroup.add(scarfMesh);

    // Хвост (прикреплен сзади к телу на +Z)
    this.tailPivot = new THREE.Group();
    this.tailPivot.position.set(0, 0.36, 0.24);
    const tailMesh = new THREE.Group();
    const tailBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.08, 0.5, 6), foxOrange);
    tailBase.position.set(0, 0.25, 0);
    const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.28, 6), whiteMat);
    tailTip.position.set(0, 0.64, 0);
    tailMesh.add(tailBase, tailTip);
    tailMesh.rotation.x = 0.85;
    this.tailPivot.add(tailMesh);
    this.heroGroup.add(this.tailPivot);

    this.scene.add(this.heroGroup);

    // 6. Мягкая динамическая тень под лисом на траве (видна на земле даже при прыжке)
    const shadowGeo = new THREE.PlaneGeometry(1.3, 1.3);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const sctx = shadowCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(18, 38, 12, 0.65)');
    grad.addColorStop(0.55, 'rgba(18, 38, 12, 0.32)');
    grad.addColorStop(1, 'rgba(18, 38, 12, 0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadowMesh.position.y = 0.02;
    this.scene.add(this.shadowMesh);

    // 7. Окружение: процедурный мир "Солнечные холмы" через InstancedMesh (бюджет вызовов <= 300)
    this.world = generateWorld(1337);
    const dummy = new THREE.Object3D();

    // 7.1 Деревья: стволы (коричневые цилиндры) и кроны (пастельно-зеленые конусы)
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5032, flatShading: true });
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, this.world.trees.length);

    const lowerGeo = new THREE.ConeGeometry(1.6, 2.2, 6);
    const lowerMat = new THREE.MeshLambertMaterial({ color: 0x4d9642, flatShading: true });
    const lowerMesh = new THREE.InstancedMesh(lowerGeo, lowerMat, this.world.trees.length);

    const upperGeo = new THREE.ConeGeometry(1.2, 1.8, 6);
    const upperMat = new THREE.MeshLambertMaterial({ color: 0x5ea852, flatShading: true });
    const upperMesh = new THREE.InstancedMesh(upperGeo, upperMat, this.world.trees.length);

    for (let i = 0; i < this.world.trees.length; i++) {
      const t = this.world.trees[i]!;
      const y = getTerrainHeight(t.x, t.z);

      // Ствол
      dummy.position.set(t.x, y + 1.1 * t.scale, t.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.scale, t.scale, t.scale);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);

      // Нижний ярус хвои
      dummy.position.set(t.x, y + 2.5 * t.scale, t.z);
      dummy.updateMatrix();
      lowerMesh.setMatrixAt(i, dummy.matrix);

      // Верхний ярус хвои
      dummy.position.set(t.x, y + 3.8 * t.scale, t.z);
      dummy.updateMatrix();
      upperMesh.setMatrixAt(i, dummy.matrix);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    lowerMesh.instanceMatrix.needsUpdate = true;
    upperMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(trunkMesh, lowerMesh, upperMesh);

    // 7.2 Силовой барьер арены (Force Field в стиле Megabonk) на R = 60.0 м
    const barrierRadius = 60.0;
    const barrierHeight = 6.0;
    const barrierGeo = new THREE.CylinderGeometry(barrierRadius, barrierRadius, barrierHeight, 64, 1, true);
    const barrierMat = new THREE.MeshBasicMaterial({
      color: 0x48cae4,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const barrierMesh = new THREE.Mesh(barrierGeo, barrierMat);
    barrierMesh.position.set(0, barrierHeight * 0.5, 0);
    this.scene.add(barrierMesh);

    // Верхний и нижний неоновые световые контуры барьера
    const ringGeo = new THREE.TorusGeometry(barrierRadius, 0.08, 6, 64);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x90e0ef, transparent: true, opacity: 0.65 });
    const topRingMesh = new THREE.Mesh(ringGeo, ringMat);
    topRingMesh.position.set(0, barrierHeight, 0);
    const botRingMesh = new THREE.Mesh(ringGeo, ringMat);
    botRingMesh.position.set(0, 0.05, 0);
    this.scene.add(topRingMesh, botRingMesh);

    // 7.4 Декоративные пучки травы
    const grassGeo = new THREE.ConeGeometry(0.35, 0.6, 3);
    const grassMat = new THREE.MeshLambertMaterial({ color: 0xa2e055, flatShading: true });
    const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, this.world.grassClumps.length);
    for (let i = 0; i < this.world.grassClumps.length; i++) {
      const g = this.world.grassClumps[i]!;
      const y = getTerrainHeight(g.x, g.z);
      dummy.position.set(g.x, y + 0.25 * g.scale, g.z);
      dummy.rotation.set(0, g.rotY, 0);
      dummy.scale.set(g.scale, g.scale, g.scale);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(i, dummy.matrix);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(grassMesh);

    // 7.4b Сундуки на холмах (InstancedMesh, бюджет вызовов)
    this.chests = createInitialChests(
      this.world.obstacles,
      getTerrainHeight,
      () => Math.random(),
      INITIAL_CHEST_COUNT,
      65,
    );
    const chestBaseGeo = new THREE.BoxGeometry(0.72, 0.38, 0.52);
    const chestBaseMat = new THREE.MeshLambertMaterial({ color: 0x8a502c, flatShading: true });
    this.chestBaseMesh = new THREE.InstancedMesh(chestBaseGeo, chestBaseMat, MAX_ACTIVE_CHESTS);
    this.chestBaseMesh.count = 0;
    this.chestBaseMesh.frustumCulled = false;

    const chestLidGeo = new THREE.BoxGeometry(0.75, 0.20, 0.55);
    const chestLidMat = new THREE.MeshLambertMaterial({ color: 0x6e3c1d, flatShading: true });
    this.chestLidMesh = new THREE.InstancedMesh(chestLidGeo, chestLidMat, MAX_ACTIVE_CHESTS);
    this.chestLidMesh.count = 0;
    this.chestLidMesh.frustumCulled = false;

    const chestLockGeo = new THREE.BoxGeometry(0.14, 0.16, 0.10);
    const chestLockMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    this.chestLockMesh = new THREE.InstancedMesh(chestLockGeo, chestLockMat, MAX_ACTIVE_CHESTS);
    this.chestLockMesh.count = 0;
    this.chestLockMesh.frustumCulled = false;

    this.scene.add(this.chestBaseMesh, this.chestLidMesh, this.chestLockMesh);

    // 7.5 Мобы, снаряды, кристаллики опыта (InstancedMesh) и эффект взмаха хвостом
    this.combatState = createInitialCombatState();
    const maxMushlets = 160;
    const maxBeetles = 80;
    const maxOwls = 80;
    const maxProjs = 60;
    const maxGems = 250;

    // Грибыш (mushlet)
    const mStemGeo = new THREE.CylinderGeometry(0.14, 0.2, 0.4, 5);
    const mStemMat = new THREE.MeshLambertMaterial({ color: 0xf3eee3, flatShading: true });
    this.mushletStemMesh = new THREE.InstancedMesh(mStemGeo, mStemMat, maxMushlets);
    this.mushletStemMesh.count = 0;
    this.mushletStemMesh.frustumCulled = false;

    const mCapGeo = new THREE.ConeGeometry(0.46, 0.38, 6);
    const mCapMat = new THREE.MeshLambertMaterial({ color: 0xe63946, flatShading: true });
    this.mushletCapMesh = new THREE.InstancedMesh(mCapGeo, mCapMat, maxMushlets);
    this.mushletCapMesh.count = 0;
    this.mushletCapMesh.frustumCulled = false;

    // Жук-таран (ram_beetle)
    const bBodyGeo = new THREE.BoxGeometry(0.55, 0.32, 0.7);
    const bBodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.beetleBodyMesh = new THREE.InstancedMesh(bBodyGeo, bBodyMat, maxBeetles);
    this.beetleBodyMesh.count = 0;
    this.beetleBodyMesh.frustumCulled = false;
    for (let i = 0; i < maxBeetles; i++) {
      this.beetleBodyMesh.setColorAt(i, this.defaultBeetleColor);
    }
    if (this.beetleBodyMesh.instanceColor) this.beetleBodyMesh.instanceColor.needsUpdate = true;

    const bHornGeo = new THREE.ConeGeometry(0.12, 0.38, 4);
    bHornGeo.rotateX(-Math.PI / 2);
    const bHornMat = new THREE.MeshLambertMaterial({ color: 0x111c2e, flatShading: true });
    this.beetleHornMesh = new THREE.InstancedMesh(bHornGeo, bHornMat, maxBeetles);
    this.beetleHornMesh.count = 0;
    this.beetleHornMesh.frustumCulled = false;

    // Плевун-совёнок (spit_owl)
    const oBodyGeo = new THREE.CylinderGeometry(0.28, 0.22, 0.55, 6);
    const oBodyMat = new THREE.MeshLambertMaterial({ color: 0x7209b7, flatShading: true });
    this.owlBodyMesh = new THREE.InstancedMesh(oBodyGeo, oBodyMat, maxOwls);
    this.owlBodyMesh.count = 0;
    this.owlBodyMesh.frustumCulled = false;

    const oEyesGeo = new THREE.ConeGeometry(0.09, 0.2, 4);
    oEyesGeo.rotateX(-Math.PI / 2);
    const oEyesMat = new THREE.MeshLambertMaterial({ color: 0xffd166, flatShading: true });
    this.owlEyesMesh = new THREE.InstancedMesh(oEyesGeo, oEyesMat, maxOwls);
    this.owlEyesMesh.count = 0;
    this.owlEyesMesh.frustumCulled = false;

    // Снаряды совёнка
    const pGeo = new THREE.SphereGeometry(0.16, 5, 5);
    const pMat = new THREE.MeshLambertMaterial({ color: 0xff0054, emissive: 0x66001e });
    this.projMesh = new THREE.InstancedMesh(pGeo, pMat, maxProjs);
    this.projMesh.count = 0;
    this.projMesh.frustumCulled = false;

    // Снаряды искровой пращи лиса (spark_sling)
    const spGeo = new THREE.SphereGeometry(0.28, 6, 6);
    const spMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
    this.sparkProjMesh = new THREE.InstancedMesh(spGeo, spMat, 40);
    this.sparkProjMesh.count = 0;
    this.sparkProjMesh.frustumCulled = false;

    // Кристаллики опыта: 2D-спрайты (биллборды LEGO-стиль с процедурной текстурой кристалла)
    const gemTex = createGemTexture();
    const gGeo = new THREE.PlaneGeometry(0.48, 0.48);
    const gMat = new THREE.MeshBasicMaterial({
      map: gemTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.gemMesh = new THREE.InstancedMesh(gGeo, gMat, maxGems);
    this.gemMesh.count = 0;
    this.gemMesh.frustumCulled = false;

    // Телеграфные лучи хитскана совят
    const bBeamGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);
    bBeamGeo.rotateX(Math.PI / 2);
    const bBeamMat = new THREE.MeshBasicMaterial({ color: 0xff0055, transparent: true, opacity: 0.75, depthWrite: false });
    this.beamMesh = new THREE.InstancedMesh(bBeamGeo, bBeamMat, 20);
    this.beamMesh.count = 0;
    this.beamMesh.frustumCulled = false;

    // 3D-модель босса Старый Пень
    const bossModel = createBossStumpModel();
    this.bossGroup = bossModel.group;
    this.bossEyesMat = bossModel.eyesMat;
    this.bossGroup.visible = false;
    this.scene.add(this.bossGroup);

    this.scene.add(
      this.mushletStemMesh,
      this.mushletCapMesh,
      this.beetleBodyMesh,
      this.beetleHornMesh,
      this.owlBodyMesh,
      this.owlEyesMesh,
      this.projMesh,
      this.sparkProjMesh,
      this.gemMesh,
      this.beamMesh,
    );

    // Эффект удара tail_blade (дуга сзади лиса в сторону +Z, растет с уровнем до 360°)
    const initialArc = (120 * Math.PI) / 180;
    const initialThetaStart = -Math.PI / 2 - initialArc / 2;
    const slashGeo = new THREE.RingGeometry(1.6, 2.9, 28, 1, initialThetaStart, initialArc);
    slashGeo.rotateX(-Math.PI / 2);
    this.slashMat = new THREE.MeshBasicMaterial({
      color: 0xffa500,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.slashMesh = new THREE.Mesh(slashGeo, this.slashMat);
    this.slashMesh.visible = false;
    this.scene.add(this.slashMesh);

    // Вспышка выстрела spark_sling
    const sfGeo = new THREE.RingGeometry(0.15, 0.75, 12);
    sfGeo.rotateX(-Math.PI / 2);
    this.sparkFlashMat = new THREE.MeshBasicMaterial({
      color: 0xffea00,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sparkFlashMesh = new THREE.Mesh(sfGeo, this.sparkFlashMat);
    this.sparkFlashMesh.visible = false;
    this.scene.add(this.sparkFlashMesh);

    // Эффект огненной волны Девятого хвоста (ninth_tail)
    const fwGeo = new THREE.RingGeometry(0.3, 4.5, 32);
    fwGeo.rotateX(-Math.PI / 2);
    this.fireWaveMat = new THREE.MeshBasicMaterial({
      color: 0xff4d00,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.fireWaveMesh = new THREE.Mesh(fwGeo, this.fireWaveMat);
    this.fireWaveMesh.visible = false;
    this.scene.add(this.fireWaveMesh);

    this.damageLayer = $('damage-layer');

    // 8. Контроллер ввода (ПК и телефон)
    this.input = new Input(this.renderer.domElement, {
      pause: () => this.openMenu(),
      lockLost: () => {
        // Потеря Pointer Lock не открывает меню и не ставит игру на автопаузу (удобный альттаб)
        if (performance.now() - this.fullscreenExitAt < 700) {
          toast('Полный экран выключен — кликни, чтобы продолжить', 2500);
        }
      },
      gesture: () => undefined,
      toggleDebug: () => this.toggleDebug(),
    });
    if (touchDevice) this.input.enableTouch();

    fillIcons(document);

    $('mode').textContent = session.mode === 'hub' ? 'в хабе' : 'без хаба';
    $('best').textContent = best === null ? '-' : String(best);

    this.updateInventoryHud();

    new ResizeObserver(() => this.resize()).observe($('app'));
    this.resize();

    this.bindUi();

    requestAnimationFrame((t) => this.tick(t));
  }

  private bindUi(): void {
    $('btn-menu').addEventListener('click', () => this.toggleMenu());
    $('btn-resume').addEventListener('click', () => this.closeMenu());
    $('btn-debug-toggle').addEventListener('click', () => this.toggleDebug());

    $('btn-skip-upgrade').addEventListener('click', () => this.skipUpgrade());
    $('btn-tab').addEventListener('click', () => this.toggleTabModal());
    $('tab-btn-close').addEventListener('click', () => this.closeTabModal());

    // Защита от случайного закрытия вкладки во время забега (ERR-10)
    window.addEventListener('beforeunload', (e) => {
      if (this.combatState && this.combatState.heroHp > 0 && this.runTime > 5) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    if (document.fullscreenEnabled) {
      $('btn-fs').hidden = false;
      $('btn-menu-fs').hidden = false;
      $('btn-fs').addEventListener('click', () => void this.toggleFullscreen());
      $('btn-menu-fs').addEventListener('click', () => void this.toggleFullscreen());
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
          this.fullscreenExitAt = performance.now();
          const navKey = (navigator as unknown as { keyboard?: { unlock?: () => void } }).keyboard;
          if (navKey && typeof navKey.unlock === 'function') {
            navKey.unlock();
          }
        } else {
          // Keyboard Lock API при включении Fullscreen (ERR-10)
          const navKey = (navigator as unknown as { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard;
          if (navKey && typeof navKey.lock === 'function') {
            navKey.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape']).catch(() => {});
          }
        }
        this.syncFullscreenButtons();
      });
      this.syncFullscreenButtons();
    }

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.upgradeModalOpen) {
        if (e.code === 'Digit1' || e.code === 'Numpad1') {
          e.preventDefault();
          this.chooseUpgrade(0);
          return;
        }
        if (e.code === 'Digit2' || e.code === 'Numpad2') {
          e.preventDefault();
          this.chooseUpgrade(1);
          return;
        }
        if (e.code === 'Digit3' || e.code === 'Numpad3') {
          e.preventDefault();
          this.chooseUpgrade(2);
          return;
        }
        // ERR-11: убран Space, чтобы прыжок в момент появления окна не скипал улучшение!
        if (e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault();
          this.skipUpgrade();
          return;
        }
      }

      if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat && !this.tabModalOpen && !this.upgradeModalOpen) {
          this.openTabModal();
        }
        return;
      }

      if (e.code === 'KeyB' && !this.tabModalOpen && !this.upgradeModalOpen) {
        this.bossSpawned = true;
        spawnMobInRing(this.combatState, this.playerState.x, this.playerState.z, 'old_stump', this.runTime, () => 0.5);
        toast('БОСС призван клавишей B!', 2500, 'ok');
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.tabModalOpen) {
          this.closeTabModal();
          return;
        }
        if (performance.now() - this.fullscreenExitAt < 700) {
          toast('Полный экран выключен', 2000);
        } else {
          this.toggleMenu();
        }
      }
    });

    // Удержание Tab (Hold-to-open): при отпускании клавиши окно автоматически закрывается
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.tabModalOpen && !this.upgradeModalOpen) {
          this.closeTabModal();
        }
      }
    });

    this.recalculateHeroStats();
  }

  private applyUpgradeChoice(choice: UpgradeOption): void {
    applyUpgrade(this.inventory, choice.id);

    // Синхронизируем состояние боя
    this.combatState.hasteLevel = this.inventory.tomes.get('tome_haste') ?? 0;
    this.combatState.mightLevel = this.inventory.tomes.get('tome_might') ?? 0;

    for (const [wId, lvl] of this.inventory.weapons.entries()) {
      let existing = this.combatState.weapons.find((w) => w.id === wId);
      if (!existing) {
        existing = { id: wId, level: lvl, cooldownTimer: 0.1 };
        this.combatState.weapons.push(existing);
      } else {
        existing.level = lvl;
      }
    }

    if (choice.id === 'tail_blade') {
      this.updateSlashGeometry(this.inventory.weapons.get('tail_blade') ?? 1);
    }

    this.recalculateHeroStats();
    this.updateInventoryHud();

    this.combatState.pendingLevelUps = Math.max(0, this.combatState.pendingLevelUps - 1);
  }

  private openUpgradeModal(): void {
    if (this.upgradeModalOpen) return;

    this.currentUpgradeChoices = rollUpgradeChoices(this.inventory);

    // Если нет доступных улучшений (всё улучшено до капа)
    if (this.currentUpgradeChoices.length === 0) {
      this.combatState.pendingLevelUps = 0;
      return;
    }

    // Если доступен ровно 1 вариант улучшения: применяем в фоне без открытия модального окна и без паузы
    if (this.currentUpgradeChoices.length === 1) {
      const singleChoice = this.currentUpgradeChoices[0]!;
      this.applyUpgradeChoice(singleChoice);
      toast(`Авто-прокачка: ${singleChoice.name}`, 1800, 'ok');

      if (this.combatState.pendingLevelUps > 0) {
        this.openUpgradeModal();
      }
      return;
    }

    this.upgradeModalOpen = true;
    this.upgradeModalOpenedAt = performance.now();
    this.paused = true;
    if (this.tabModalOpen) {
      this.closeTabModal(false);
    }
    this.input.active = false;
    this.input.unlock();

    const container = $('upgrade-cards');
    container.innerHTML = '';

    for (let i = 0; i < this.currentUpgradeChoices.length; i++) {
      const choice = this.currentUpgradeChoices[i]!;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `gf-card gf-card--${choice.kind}`;

      const kindName = choice.kind === 'weapon' ? '⚔ Оружие' : choice.kind === 'tome' ? '📖 Фолиант' : '✨ Бонус';
      const levelText = choice.isNew
        ? '<span class="gf-card__level gf-card__level--new">НОВОЕ! (+ слот)</span>'
        : `<span class="gf-card__level">Ур. ${choice.currentLevel} → ${choice.nextLevel}</span>`;

      card.innerHTML = `
        <div class="gf-card__top">
          <span class="gf-card__badge">${kindName}</span>
          <span class="gf-card__key">[${i + 1}]</span>
        </div>
        <div class="gf-card__title">${choice.name}</div>
        ${levelText}
        <p class="gf-card__desc">${choice.description}</p>
      `;

      card.addEventListener('click', () => this.chooseUpgrade(i));
      container.appendChild(card);
    }

    $('upgrade-modal').hidden = false;
  }

  private chooseUpgrade(idx: number): void {
    if (!this.upgradeModalOpen) return;
    const choice = this.currentUpgradeChoices[idx];
    if (!choice) return;

    this.applyUpgradeChoice(choice);
    toast(`Выбрано: ${choice.name}`, 1800, 'ok');

    $('upgrade-modal').hidden = true;
    this.upgradeModalOpen = false;

    if (this.combatState.pendingLevelUps > 0) {
      this.openUpgradeModal();
    } else {
      this.paused = false;
      this.input.active = true;
      this.input.lock(); // Мгновенный возврат захвата мыши без лишнего клика
    }
  }

  private skipUpgrade(): void {
    if (!this.upgradeModalOpen) return;
    // Защита от случайного скипа при появлении окна прокачки (debounce 300 мс, ERR-11)
    if (performance.now() - this.upgradeModalOpenedAt < 300) return;

    this.combatState.pendingLevelUps = Math.max(0, this.combatState.pendingLevelUps - 1);
    toast('Прокачка пропущена', 1500);

    $('upgrade-modal').hidden = true;
    this.upgradeModalOpen = false;

    if (this.combatState.pendingLevelUps > 0) {
      this.openUpgradeModal();
    } else {
      this.paused = false;
      this.input.active = true;
      this.input.lock(); // Мгновенный возврат захвата мыши
    }
  }

  private toggleTabModal(): void {
    if (this.upgradeModalOpen) return;
    if (this.tabModalOpen) {
      this.closeTabModal();
    } else {
      this.openTabModal();
    }
  }

  private openTabModal(): void {
    if (this.upgradeModalOpen) return;
    this.tabModalOpen = true;
    $('tab-modal').hidden = false;
    // Игра НЕ встает на паузу, движение персонажа на WASD остается активным!
    this.input.unlock(); // Освобождаем мышь для работы с меню
    this.updateDashboard();
  }

  private closeTabModal(restorePointerLock = true): void {
    if (!this.tabModalOpen) return;
    this.tabModalOpen = false;
    $('tab-modal').hidden = true;
    if (restorePointerLock && !this.paused && !this.upgradeModalOpen) {
      this.input.lock(); // Возвращаем фокус мыши только если игра продолжается
    }
  }

  private renderInventoryItems(container: HTMLElement, isCompact = false): void {
    container.innerHTML = '';
    let hasAny = false;

    // 1. Активное оружие
    for (const [wId, lvl] of this.inventory.weapons.entries()) {
      const cfg = WEAPON_CONFIGS[wId];
      if (!cfg) continue;
      hasAny = true;
      const row = document.createElement('div');
      row.className = 'gf-item-row gf-item-row--weapon';
      row.innerHTML = `
        <div class="gf-item-row__head">
          <span class="gf-item-row__name">⚔ ${cfg.name}</span>
          <span class="gf-item-row__badge">Ур. ${lvl}/5</span>
        </div>
        ${!isCompact ? `<span class="gf-item-row__desc">${cfg.description}</span>` : ''}
      `;
      container.appendChild(row);
    }

    // 2. Фолианты
    for (const [tId, lvl] of this.inventory.tomes.entries()) {
      if (lvl <= 0) continue;
      const cfg = TOME_CONFIGS[tId];
      if (!cfg) continue;
      hasAny = true;
      const row = document.createElement('div');
      row.className = 'gf-item-row gf-item-row--tome';
      row.innerHTML = `
        <div class="gf-item-row__head">
          <span class="gf-item-row__name">📖 ${cfg.name}</span>
          <span class="gf-item-row__badge">Ур. ${lvl}/5</span>
        </div>
        ${!isCompact ? `<span class="gf-item-row__desc">${cfg.description}</span>` : ''}
      `;
      container.appendChild(row);
    }

    // 3. Предметы из сундуков
    for (const [itId, count] of this.ownedItems.entries()) {
      const cfg = ITEM_CONFIGS[itId];
      if (!cfg || count <= 0) continue;
      hasAny = true;
      const row = document.createElement('div');
      row.className = `gf-item-row gf-item-row--${cfg.rarity}`;
      row.innerHTML = `
        <div class="gf-item-row__head">
          <span class="gf-item-row__name">${cfg.icon} ${cfg.name}</span>
          <span class="gf-item-row__badge">×${count}</span>
        </div>
        <span class="gf-item-row__desc">${cfg.description}</span>
      `;
      container.appendChild(row);
    }

    if (!hasAny) {
      const empty = document.createElement('div');
      empty.className = 'gf-items-empty';
      empty.textContent = 'Снаряжение пока не собрано. Ищите золотые сундуки на холмах!';
      container.appendChild(empty);
    }
  }

  private renderHeroStats(container: HTMLElement, isCompact = false): void {
    container.innerHTML = '';
    const cs = this.combatState;
    const itemBonuses = getItemStatBonuses(this.ownedItems, cs.heroMaxHp, cs.heroHp);

    const stats: Array<{ label: string; val: string; sub: string }> = [
      { label: 'Здоровье лиса', val: `${Math.ceil(cs.heroHp)} / ${cs.heroMaxHp} HP`, sub: 'База 100 HP + чай + жёлуди' },
      { label: 'Скорость бега', val: `${this.playerParams.speed.toFixed(1)} м/с`, sub: `База 6.0 м/с (${Math.round(itemBonuses.speedMultiplier * 100)} %)` },
      { label: 'Высота прыжка', val: '1.6 м', sub: `Прыжков в воздухе: ${itemBonuses.airJumps}` },
      { label: 'Сила', val: `+${cs.mightLevel * 3} к урону`, sub: `Фолиант силы (Ур.${cs.mightLevel})` },
      { label: 'Спешка (скорость атаки)', val: `+${cs.hasteLevel * 12} %`, sub: `Фолиант быстроты (Ур.${cs.hasteLevel})` },
      { label: 'Радиус сбора', val: `${(HERO_CONFIG.pickupRadius * itemBonuses.pickupRadiusMultiplier).toFixed(1)} м`, sub: `Автомагнит (${Math.round(itemBonuses.pickupRadiusMultiplier * 100)} %)` },
      { label: 'Множитель урона', val: `×${itemBonuses.damageMultiplier.toFixed(2)}`, sub: 'Клыки и Тотем ярости' },
      {
        label: 'Шанс крита',
        val: `${Math.round(itemBonuses.critChance * 100)} %`,
        sub: itemBonuses.critChance > 1.0
          ? `Гарант крит ×2 + ${Math.round((itemBonuses.critChance - 1.0) * 100)}% оверкрит ×3`
          : 'Заячья лапка (крит ×2)',
      },
      { label: 'Регенерация HP', val: `+${itemBonuses.regenHpPerSec.toFixed(1)} HP/с`, sub: 'Лопух' },
      { label: 'Уровень героя', val: `Ур. ${cs.heroLevel}`, sub: `Опыт: ${cs.heroExp} / ${getRequiredExp(cs.heroLevel)}` },
      { label: 'Побеждено мобов', val: `${cs.kills}`, sub: 'Счётчик забега' },
      { label: 'Время забега', val: `${Math.floor(this.runTime / 60)}:${Math.floor(this.runTime % 60).toString().padStart(2, '0')}`, sub: 'Цель: 10:00+' },
    ];

    if (itemBonuses.hasMirrorBark) {
      stats.push({
        label: 'Зеркальная кора',
        val: `${itemBonuses.mirrorBarkCooldown.toFixed(1)} с`,
        sub: cs.mirrorBarkReady ? 'Щит готов' : `КД: ${cs.mirrorBarkCooldownSec.toFixed(1)} с`,
      });
    }

    if (cs.phoenixDownCharges > 0) {
      stats.push({
        label: 'Заряды феникса',
        val: `${cs.phoenixDownCharges}`,
        sub: 'Пух феникса (50% HP при гибели)',
      });
    }

    for (const st of stats) {
      const card = document.createElement('div');
      card.className = 'gf-stat-card';
      card.innerHTML = `
        <span class="gf-stat-card__label">${st.label}</span>
        <span class="gf-stat-card__val">${st.val}</span>
        ${!isCompact ? `<span class="gf-stat-card__sub">${st.sub}</span>` : ''}
      `;
      container.appendChild(card);
    }
  }

  private updateDashboard(): void {
    if (this.tabModalOpen) {
      const itemsContainer = document.getElementById('tab-items-list');
      const statsContainer = document.getElementById('tab-stats-grid');
      if (itemsContainer) this.renderInventoryItems(itemsContainer);
      if (statsContainer) this.renderHeroStats(statsContainer);

      // Радар карты: обновляем позицию лиса
      const foxMarker = document.getElementById('map-fox-marker');
      if (foxMarker) {
        const arenaR = 60.0;
        const radarR = 70.0;
        const normX = Math.max(-1, Math.min(1, this.playerState.x / arenaR));
        const normZ = Math.max(-1, Math.min(1, this.playerState.z / arenaR));
        foxMarker.style.transform = `translate(${normX * radarR}px, ${normZ * radarR}px)`;
      }
    }
    if (this.paused && !$('menu').hidden) {
      const itemsContainer = document.getElementById('menu-items-list');
      const statsContainer = document.getElementById('menu-stats-grid');
      if (itemsContainer) this.renderInventoryItems(itemsContainer, true);
      if (statsContainer) this.renderHeroStats(statsContainer, true);
    }
  }

  private updateSlashGeometry(level: number): void {
    const levelIdx = Math.max(0, Math.min(4, level - 1));
    const cfg = WEAPON_CONFIGS.tail_blade;
    const arc = cfg.sectorAngleByLevel ? (cfg.sectorAngleByLevel[levelIdx] ?? ((120 * Math.PI) / 180)) : ((120 * Math.PI) / 180);
    const range = cfg.rangeByLevel[levelIdx] ?? 2.8;
    const thetaStart = -Math.PI / 2 - arc / 2;

    this.slashMesh.geometry.dispose();
    this.slashMesh.geometry = new THREE.RingGeometry(1.6, range + 0.1, 28, 1, thetaStart, arc);
    this.slashMesh.geometry.rotateX(-Math.PI / 2);
  }

  private isHostFullscreen(): boolean {
    return !document.fullscreenElement && window.innerWidth >= screen.width - 2 && window.innerHeight >= screen.height - 2;
  }

  private syncFullscreenButtons(): void {
    const isFs = !!document.fullscreenElement;
    const name = isFs ? 'exit-fullscreen' : 'fullscreen';
    setIcon($('btn-fs'), name);
    setIcon($('btn-menu-fs'), name);
    $('fs-label').textContent = isFs ? 'Выйти из полноэкранного' : 'На весь экран';
    $('btn-fs').title = isFs ? 'Выйти из полноэкранного режима' : 'На весь экран';
  }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      try {
        screen.orientation?.unlock();
      } catch {
        // Игнорируем
      }
      try {
        await document.exitFullscreen();
      } catch (e) {
        toast(`Не удалось выйти (${e instanceof Error ? e.name : 'ошибка'})`, 3000, 'err');
      }
      return;
    }

    if (this.isHostFullscreen()) {
      toast('Полный экран уже включен хабом — выход: кнопка "Назад" или Esc', 3500);
      return;
    }

    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (this.input.touchMode) {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        try {
          await o.lock?.('landscape');
        } catch {
          // Игнорируем
        }
      }
    } catch (e) {
      toast(`Полный экран недоступен (${e instanceof Error ? e.name : 'ошибка'})`, 3500, 'err');
    }
  }

  private toggleMenu(): void {
    if (this.upgradeModalOpen) return;
    if (this.paused) this.closeMenu();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.upgradeModalOpen) return;
    this.paused = true;
    if (this.tabModalOpen) {
      this.closeTabModal(false);
    }
    this.input.active = false;
    this.input.unlock();
    $('menu').hidden = false;
    this.updateDashboard();
  }

  private closeMenu(): void {
    if (this.upgradeModalOpen) return;
    this.paused = false;
    this.input.active = true;
    $('menu').hidden = true;
  }

  private toggleDebug(): void {
    this.debug = !this.debug;
    $('debug').hidden = !this.debug;
    $('debug-label').textContent = `Показатели: ${this.debug ? 'вкл' : 'выкл'}`;
    toast(this.debug ? 'Показатели F3 включены' : 'Показатели F3 выключены', 1500);
    if (this.debug) this.updateDebug();
  }

  private resize(): void {
    const el = $('app');
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);

    const host = this.isHostFullscreen();
    if (this.wasHostFullscreen && !host) this.fullscreenExitAt = performance.now();
    this.wasHostFullscreen = host;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick(time: number): void {
    requestAnimationFrame((t) => this.tick(t));

    // Строго через dt с ограничением потолка 0.05 с (GAME-TZ.md)
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    const frameMs = time - this.lastTime;
    this.lastTime = time;

    this.frameCount++;
    this.frameTimes.push(frameMs);
    if (frameMs > this.worstFrameMs) this.worstFrameMs = frameMs;
    if (frameMs > 25) this.slowFramesCount++;

    if (time - this.fpsTimer >= 1000) {
      this.fps = this.frameCount;
      const sum = this.frameTimes.reduce((acc, v) => acc + v, 0);
      this.perfAvgMs = this.frameTimes.length > 0 ? sum / this.frameTimes.length : 16.6;
      this.perfWorstMs = this.worstFrameMs;
      this.perfSlowPerSec = this.slowFramesCount;

      this.frameCount = 0;
      this.worstFrameMs = 0;
      this.slowFramesCount = 0;
      this.frameTimes.length = 0;
      this.fpsTimer = time;
    }

    if (!this.paused) {
      // 1. Движение лиса через чистую функцию физики stepPlayer с учётом коллизий ROCKS и холмов
      const move = this.input.move();
      const jump = this.input.jump();
      this.playerState = stepPlayer(
        this.playerState,
        {
          forward: move.forward,
          strafe: move.strafe,
          jump,
          yaw: this.input.yaw,
        },
        dt,
        this.playerParams,
        this.world.obstacles,
        getTerrainHeight,
      );

      // 2. Позиция 3D-модели лиса
      this.heroGroup.position.set(this.playerState.x, this.playerState.y, this.playerState.z);

      // 3. Динамическая тень на земле (проекция на рельеф под ногами)
      this.shadowMesh.position.x = this.playerState.x;
      this.shadowMesh.position.z = this.playerState.z;
      const groundY = getTerrainHeight(this.playerState.x, this.playerState.z);
      this.shadowMesh.position.y = groundY + 0.02;
      const jumpDelta = Math.max(0, this.playerState.y - groundY);
      const shadowScale = Math.max(0.35, 1.0 - jumpDelta * 0.35);
      this.shadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
      this.shadowMat.opacity = Math.max(0.12, 0.65 - jumpDelta * 0.28);

      const moveLen = Math.hypot(move.strafe, move.forward);
      if (moveLen > 0.05) {
        // Направление бега в мире относительно взгляда камеры (-Z - вперёд, +X - вправо)
        const sin = Math.sin(this.input.yaw);
        const cos = Math.cos(this.input.yaw);
        const moveX = -move.forward * sin + move.strafe * cos;
        const moveZ = -move.forward * cos - move.strafe * sin;
        // В Three.js rotation.y вокруг +Y: (0, 0, -1) переходит в (-sin(θ), -cos(θ)).
        // Чтобы модель смотрела по (moveX, moveZ): sin(θ) = -moveX, cos(θ) = -moveZ.
        const targetAngle = Math.atan2(-moveX, -moveZ);

        let diff = targetAngle - this.heroGroup.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.heroGroup.rotation.y += diff * Math.min(1, dt * 14);

        // Анимация бега: покачивание тела и быстрое махание хвостом
        this.heroGroup.position.y = this.playerState.y + Math.abs(Math.sin(this.runTime * 14)) * 0.06;
        this.tailPivot.rotation.y = Math.sin(this.runTime * 16) * 0.45;
        this.tailPivot.rotation.z = Math.cos(this.runTime * 14) * 0.15;
      } else {
        this.heroGroup.position.y = this.playerState.y;
        this.tailPivot.rotation.y = Math.sin(time * 0.003) * 0.25;
        this.tailPivot.rotation.z = Math.cos(time * 0.002) * 0.08;
      }

      // 4. Камера от третьего лица (следит за лисом с расстояния 6.2 м сзади: +Z при yaw=0)
      const camDist = 6.2;
      const cy = this.playerState.y + 1.3 + Math.sin(this.input.pitch) * camDist;
      const cx = this.playerState.x + Math.sin(this.input.yaw) * Math.cos(this.input.pitch) * camDist;
      const cz = this.playerState.z + Math.cos(this.input.yaw) * Math.cos(this.input.pitch) * camDist;
      this.camera.position.set(cx, Math.max(0.5, cy), cz);
      this.camera.lookAt(this.playerState.x, this.playerState.y + 1.0, this.playerState.z);

      // 5. Спавн мобов волнами по расписанию (DESIGN.md)
      this.runTime += dt;

      // Автоматический спавн босса "Старый Пень" на 8-й минуте (480 сек)
      if (this.runTime >= 480 && !this.bossSpawned) {
        this.bossSpawned = true;
        spawnMobInRing(this.combatState, this.playerState.x, this.playerState.z, 'old_stump', this.runTime, () => 0.5);
        toast('ДРЕВНИЙ ПЕНЬ ПРОБУДИЛСЯ!', 3500, 'err');
      }

      const targetCount = getWaveTargetCount(this.runTime, this.input.touchMode);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.combatState.mobs.length < targetCount) {
        this.spawnTimer = this.combatState.mobs.length < 6 ? 0.08 : 0.25;
        const available = getAvailableMobTypes(this.runTime);
        this.prngSeed = (this.prngSeed * 16807) % 2147483647;
        const rnd1 = (this.prngSeed - 1) / 2147483646;
        this.prngSeed = (this.prngSeed * 16807) % 2147483647;
        const rnd2 = (this.prngSeed - 1) / 2147483646;
        const chosenType = available[Math.floor(rnd1 * available.length)] ?? 'mushlet';
        spawnMobInRing(this.combatState, this.playerState.x, this.playerState.z, chosenType, this.runTime, () => rnd2);
      }

      // 5.1 Сундуки: спавн +1 каждую полную минуту забега (до потолка 10 активных)
      const chestSpawnRes = stepChests(
        this.chests,
        this.runTime,
        this.lastChestMinute,
        this.world.obstacles,
        getTerrainHeight,
        () => Math.random(),
        65,
      );
      this.lastChestMinute = chestSpawnRes.nextSpawnMinute;

      // Проверка подбора сундука героем (честная 3D-проверка с учётом Y, MISTAKES.md ERR-01)
      const openedChest = checkChestPickup(
        this.chests,
        this.playerState.x,
        this.playerState.y,
        this.playerState.z,
        this.playerParams.radius,
      );
      if (openedChest) {
        this.handleChestOpened(openedChest);
      }

      // Синхронизация динамических бонусов предметов (включая Тотем ярости при HP < 50%)
      const bonuses = getItemStatBonuses(this.ownedItems, this.combatState.heroMaxHp, this.combatState.heroHp);
      this.combatState.itemDamageMultiplier = bonuses.damageMultiplier;
      this.combatState.critChance = bonuses.critChance;
      this.combatState.regenHpPerSec = bonuses.regenHpPerSec;
      this.combatState.healOnKill = bonuses.healOnKill;
      this.combatState.hasMirrorBark = bonuses.hasMirrorBark;
      this.combatState.mirrorBarkBaseCooldown = bonuses.mirrorBarkCooldown;
      this.combatState.hasNinthTail = bonuses.hasNinthTail;
      this.combatState.stormBeadCount = bonuses.stormBeadCount;
      const effectivePickupRadius = HERO_CONFIG.pickupRadius * bonuses.pickupRadiusMultiplier;

      // 6. Симуляция боя, автоатаки, снарядов и опыта (с честными коллизиями с препятствиями)
      const combatRes = stepCombat(
        this.combatState,
        this.playerState.x,
        this.playerState.y,
        this.playerState.z,
        dt,
        this.heroGroup.rotation.y,
        effectivePickupRadius,
        getTerrainHeight,
        Math.random,
        this.world.obstacles,
        60.0,
      );

      if (combatRes.heroPushX || combatRes.heroPushZ) {
        this.playerState.x += combatRes.heroPushX ?? 0;
        this.playerState.z += combatRes.heroPushZ ?? 0;
        if (this.playerState.grounded) {
          this.playerState.y = getSurfaceHeight(
            this.playerState.x,
            this.playerState.z,
            this.playerState.y,
            this.world.obstacles,
            this.playerParams.radius,
          );
        }
      }

      if (this.tabModalOpen) {
        this.updateDashboard();
      }

      if (combatRes.shieldBlocked) {
        toast('Кора-зеркало поглотила удар!', 2000, 'ok');
      }
      if (combatRes.revivedByPhoenix) {
        toast('Перо феникса воскресило лиса!', 3500, 'ok');
      }

      if ((combatRes.leveledUp || this.combatState.pendingLevelUps > 0) && !this.upgradeModalOpen) {
        this.openUpgradeModal();
      }

      for (const atk of combatRes.attacks) {
        if (atk.weaponId === 'tail_blade') {
          this.triggerSlash(atk.x, atk.z, atk.facingYaw);
        } else if (atk.weaponId === 'spark_sling') {
          this.triggerSparkFlash(atk.x, atk.z);
        } else if (atk.weaponId === 'ninth_tail') {
          this.triggerFireWave(atk.x, atk.z);
        }
      }

      // Всплывающие цифры урона над врагами и героем
      for (const popup of combatRes.damagePopups) {
        this.showDamageNumber(
          popup.x,
          popup.y,
          popup.z,
          popup.damage,
          popup.isCrit,
          popup.isHero,
          popup.isOvercrit ?? false,
        );
      }

      if (this.slashTimer > 0) {
        this.slashTimer -= dt;
        this.slashMat.opacity = Math.max(0, this.slashTimer / 0.16) * 0.9;
        if (this.slashTimer <= 0) {
          this.slashMesh.visible = false;
        }
      }

      if (this.sparkFlashTimer > 0) {
        this.sparkFlashTimer -= dt;
        this.sparkFlashMat.opacity = Math.max(0, this.sparkFlashTimer / 0.12) * 0.9;
        if (this.sparkFlashTimer <= 0) {
          this.sparkFlashMesh.visible = false;
        }
      }

      if (this.fireWaveTimer > 0) {
        this.fireWaveTimer -= dt;
        const progress = Math.max(0, 1.0 - this.fireWaveTimer / 0.28);
        const scale = 0.2 + progress * 0.8;
        this.fireWaveMesh.scale.set(scale, scale, scale);
        this.fireWaveMat.opacity = Math.max(0, this.fireWaveTimer / 0.28) * 0.9;
        if (this.fireWaveTimer <= 0) {
          this.fireWaveMesh.visible = false;
        }
      }

      // 7. Отрисовка мобов через InstancedMesh (бюджет вызовов)
      const dummy = this.mobDummy;
      let mushletCount = 0;
      let beetleCount = 0;
      let owlCount = 0;

      for (const mob of this.combatState.mobs) {
        const dx = this.playerState.x - mob.x;
        const dz = this.playerState.z - mob.z;

        if (mob.type === 'mushlet' && mushletCount < 160) {
          const hop = Math.abs(Math.sin((this.runTime * 8) + mob.id)) * 0.1;
          const rotY = Math.atan2(-dx, -dz);

          dummy.position.set(mob.x, mob.y + hop + 0.2, mob.z);
          dummy.rotation.set(0, rotY, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          this.mushletStemMesh.setMatrixAt(mushletCount, dummy.matrix);

          dummy.position.set(mob.x, mob.y + hop + 0.48, mob.z);
          dummy.updateMatrix();
          this.mushletCapMesh.setMatrixAt(mushletCount, dummy.matrix);

          mushletCount++;
        } else if (mob.type === 'ram_beetle' && beetleCount < 80) {
          const rotY = mob.state === 'charge'
            ? Math.atan2(-mob.chargeDirX, -mob.chargeDirZ)
            : Math.atan2(-dx, -dz);

          dummy.position.set(mob.x, mob.y + 0.18, mob.z);
          dummy.rotation.set(0, rotY, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          this.beetleBodyMesh.setMatrixAt(beetleCount, dummy.matrix);

          dummy.position.set(
            mob.x - Math.sin(rotY) * 0.42,
            mob.y + 0.2,
            mob.z - Math.cos(rotY) * 0.42,
          );
          dummy.updateMatrix();
          this.beetleHornMesh.setMatrixAt(beetleCount, dummy.matrix);

          // Мигание при подготовке к рывку
          if (mob.state === 'telegraph') {
            const flash = Math.floor(this.runTime * 14) % 2 === 0;
            this.flashColor.setHex(flash ? 0xff4d4d : 0x1d3557);
          } else if (mob.state === 'charge') {
            this.flashColor.setHex(0xd90429);
          } else {
            this.flashColor.setHex(0x1d3557);
          }
          this.beetleBodyMesh.setColorAt(beetleCount, this.flashColor);

          beetleCount++;
        } else if (mob.type === 'spit_owl' && owlCount < 80) {
          const rotY = Math.atan2(-dx, -dz);
          const hover = Math.sin((this.runTime * 4) + mob.id) * 0.12;

          dummy.position.set(mob.x, mob.y + 0.5 + hover, mob.z);
          dummy.rotation.set(0, rotY, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          this.owlBodyMesh.setMatrixAt(owlCount, dummy.matrix);

          dummy.position.set(
            mob.x - Math.sin(rotY) * 0.28,
            mob.y + 0.55 + hover,
            mob.z - Math.cos(rotY) * 0.28,
          );
          dummy.updateMatrix();
          this.owlEyesMesh.setMatrixAt(owlCount, dummy.matrix);

          owlCount++;
        }
      }

      this.mushletStemMesh.count = mushletCount;
      this.mushletCapMesh.count = mushletCount;
      this.mushletStemMesh.instanceMatrix.needsUpdate = true;
      this.mushletCapMesh.instanceMatrix.needsUpdate = true;

      this.beetleBodyMesh.count = beetleCount;
      this.beetleHornMesh.count = beetleCount;
      this.beetleBodyMesh.instanceMatrix.needsUpdate = true;
      this.beetleHornMesh.instanceMatrix.needsUpdate = true;
      if (this.beetleBodyMesh.instanceColor) this.beetleBodyMesh.instanceColor.needsUpdate = true;

      this.owlBodyMesh.count = owlCount;
      this.owlEyesMesh.count = owlCount;
      this.owlBodyMesh.instanceMatrix.needsUpdate = true;
      this.owlEyesMesh.instanceMatrix.needsUpdate = true;

      // Отрисовка босса Старый Пень и Boss HUD
      const bossMob = this.combatState.mobs.find((m) => m.type === 'old_stump');
      if (bossMob) {
        this.bossGroup.position.set(bossMob.x, bossMob.y, bossMob.z);
        const bdx = this.playerState.x - bossMob.x;
        const bdz = this.playerState.z - bossMob.z;
        this.bossGroup.rotation.y = Math.atan2(-bdx, -bdz);
        this.bossGroup.visible = true;

        const eyePulse = 0.6 + Math.sin(this.runTime * 6) * 0.4;
        this.bossEyesMat.color.setRGB(1.0, 0.1 * eyePulse, 0.1 * eyePulse);

        const bossHud = document.getElementById('boss-hud');
        if (bossHud) bossHud.hidden = false;
        const bHp = Math.max(0, bossMob.hp);
        const bPct = Math.max(0, Math.min(100, (bHp / bossMob.maxHp) * 100));
        const bossBar = document.getElementById('boss-hp-fill');
        if (bossBar) bossBar.style.width = `${bPct}%`;
        const bossHpText = document.getElementById('boss-hp-text');
        if (bossHpText) bossHpText.textContent = `${bHp} / ${bossMob.maxHp} HP`;
      } else {
        this.bossGroup.visible = false;
        const bossHud = document.getElementById('boss-hud');
        if (bossHud) bossHud.hidden = true;
      }

      // Отрисовка телеграфных лазерных лучей совят
      const beamCount = Math.min(this.combatState.beams.length, 20);
      for (let i = 0; i < beamCount; i++) {
        const b = this.combatState.beams[i]!;
        const halfLen = b.length * 0.5;
        const midX = b.startX + b.dirX * halfLen;
        const midY = b.startY + b.dirY * halfLen;
        const midZ = b.startZ + b.dirZ * halfLen;

        dummy.position.set(midX, midY, midZ);
        dummy.lookAt(b.startX + b.dirX * b.length, b.startY + b.dirY * b.length, b.startZ + b.dirZ * b.length);

        if (b.timer > 0.4) {
          // Фаза 1 (прицеливание): Тонкий пульсирующий прицельный лазер
          const aimPulse = 0.08 + Math.sin(this.runTime * 22) * 0.02;
          dummy.scale.set(aimPulse, aimPulse, b.length);
        } else {
          // Фаза 2 (фиксация и зарядка перед выстрелом):
          // Луч намертво зафиксирован в пространстве, резко утолщается и мерцает неоновым огнем
          const chargeProgress = Math.max(0, 1.0 - b.timer / 0.4);
          const flicker = Math.sin(this.runTime * 50) * 0.08;
          const thickness = 0.28 + chargeProgress * 0.42 + flicker;
          dummy.scale.set(thickness, thickness, b.length);
        }
        dummy.updateMatrix();
        this.beamMesh.setMatrixAt(i, dummy.matrix);
      }
      this.beamMesh.count = beamCount;
      this.beamMesh.instanceMatrix.needsUpdate = true;

      // Отрисовка снарядов врагов
      const projCount = Math.min(this.combatState.projectiles.length, 60);
      for (let i = 0; i < projCount; i++) {
        const p = this.combatState.projectiles[i]!;
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.projMesh.setMatrixAt(i, dummy.matrix);
      }
      this.projMesh.count = projCount;
      this.projMesh.instanceMatrix.needsUpdate = true;

      // Отрисовка искр героя (spark_sling)
      const heroProjCount = Math.min(this.combatState.heroProjectiles.length, 40);
      for (let i = 0; i < heroProjCount; i++) {
        const hp = this.combatState.heroProjectiles[i]!;
        dummy.position.set(hp.x, hp.y, hp.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.sparkProjMesh.setMatrixAt(i, dummy.matrix);
      }
      this.sparkProjMesh.count = heroProjCount;
      this.sparkProjMesh.instanceMatrix.needsUpdate = true;

      // Отрисовка кристалликов опыта (биллборд-спрайты)
      const gemCount = Math.min(this.combatState.gems.length, 250);
      for (let i = 0; i < gemCount; i++) {
        const g = this.combatState.gems[i]!;
        const bob = Math.sin((this.runTime * 4) + g.id) * 0.08;
        const scale = g.type === 'large' ? 1.6 : g.type === 'medium' ? 1.2 : 0.9;
        const colorHex = g.type === 'large' ? 0xffd166 : g.type === 'medium' ? 0x0077b6 : 0x48cae4;

        dummy.position.set(g.x, g.y + bob + 0.25, g.z);
        dummy.quaternion.copy(this.camera.quaternion);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        this.gemMesh.setMatrixAt(i, dummy.matrix);

        this.flashColor.setHex(colorHex);
        this.gemMesh.setColorAt(i, this.flashColor);
      }
      this.gemMesh.count = gemCount;
      this.gemMesh.instanceMatrix.needsUpdate = true;
      if (this.gemMesh.instanceColor) this.gemMesh.instanceColor.needsUpdate = true;

      // Отрисовка сундуков через InstancedMesh (бюджет вызовов)
      let activeChestCount = 0;
      for (const chest of this.chests) {
        if (chest.opened) continue;
        if (activeChestCount >= MAX_ACTIVE_CHESTS) break;

        dummy.position.set(chest.x, chest.y + 0.19, chest.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.chestBaseMesh.setMatrixAt(activeChestCount, dummy.matrix);

        dummy.position.set(chest.x, chest.y + 0.44, chest.z);
        dummy.updateMatrix();
        this.chestLidMesh.setMatrixAt(activeChestCount, dummy.matrix);

        dummy.position.set(chest.x, chest.y + 0.32, chest.z - 0.26);
        dummy.updateMatrix();
        this.chestLockMesh.setMatrixAt(activeChestCount, dummy.matrix);

        activeChestCount++;
      }
      this.chestBaseMesh.count = activeChestCount;
      this.chestLidMesh.count = activeChestCount;
      this.chestLockMesh.count = activeChestCount;
      this.chestBaseMesh.instanceMatrix.needsUpdate = true;
      this.chestLidMesh.instanceMatrix.needsUpdate = true;
      this.chestLockMesh.instanceMatrix.needsUpdate = true;

      // 8. Обновление интерфейса
      const mins = Math.floor(this.runTime / 60);
      const secs = Math.floor(this.runTime % 60);
      $('hud-timer').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      $('hud-level').textContent = String(this.combatState.heroLevel);
      $('hud-kills').textContent = String(this.combatState.kills);

      const hpPct = Math.max(0, Math.min(100, (this.combatState.heroHp / this.combatState.heroMaxHp) * 100));
      $('hp-bar-fill').style.width = `${hpPct}%`;
      $('hp-bar-text').textContent = `${Math.ceil(this.combatState.heroHp)} / ${this.combatState.heroMaxHp}`;

      const reqExp = getRequiredExp(this.combatState.heroLevel);
      const expPct = Math.max(0, Math.min(100, (this.combatState.heroExp / reqExp) * 100));
      $('exp-bar-fill').style.width = `${expPct}%`;

      if (this.tabModalOpen && this.frameCount % 8 === 0) {
        this.updateDashboard();
      }
    }

    // Покадровое обновление всплывающих цифр урона с привязкой к 3D-миру
    this.updateDamageNumbers(this.paused ? 0 : dt);

    this.renderer.render(this.scene, this.camera);

    if (this.debug && this.frameCount % 10 === 0) {
      this.updateDebug();
    }
  }

  private showDamageNumber(
    x: number,
    y: number,
    z: number,
    damage: number,
    isCrit = false,
    isHero = false,
    isOvercrit = false,
  ): void {
    if (this.activeDamageNumbers.length >= 45) {
      const oldest = this.activeDamageNumbers.shift();
      if (oldest) oldest.el.remove();
    }

    const el = document.createElement('div');
    const heroCls = isHero ? ' gf-damage-number--hero' : '';
    const critCls = isOvercrit
      ? ' gf-damage-number--overcrit'
      : (isCrit ? ' gf-damage-number--crit' : '');
    el.className = `gf-damage-number${heroCls}${critCls}`;
    const icon = isOvercrit ? '🔥 ' : (isCrit ? '💥 ' : '');
    el.textContent = `${icon}${damage}`;
    el.style.display = 'none'; // Будет спозиционирован в updateDamageNumbers
    this.damageLayer.appendChild(el);

    const worldX = x + (Math.random() - 0.5) * 0.45;
    const worldY = y + 0.35 + (Math.random() - 0.5) * 0.2;
    const worldZ = z + (Math.random() - 0.5) * 0.45;

    this.activeDamageNumbers.push({
      el,
      worldX,
      worldY,
      worldZ,
      elapsed: 0,
      duration: 0.8,
      vy: 1.25, // скорость всплытия в 3D мире (м/с)
    });
  }

  private updateDamageNumbers(dt: number): void {
    if (this.activeDamageNumbers.length === 0) return;

    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;

    for (let i = this.activeDamageNumbers.length - 1; i >= 0; i--) {
      const item = this.activeDamageNumbers[i]!;
      item.elapsed += dt;

      if (item.elapsed >= item.duration) {
        item.el.remove();
        this.activeDamageNumbers.splice(i, 1);
        continue;
      }

      // Физическое всплытие точки урона в 3D пространстве мира
      item.worldY += item.vy * dt;

      // Покадровая проекция на камеру Three.js
      this.tempDmgVec.set(item.worldX, item.worldY, item.worldZ);
      this.tempDmgVec.project(this.camera);

      // Если позади плоскости камеры (z > 1)
      if (this.tempDmgVec.z > 1.0) {
        item.el.style.display = 'none';
        continue;
      }

      const screenX = (this.tempDmgVec.x * halfW) + halfW;
      const screenY = -(this.tempDmgVec.y * halfH) + halfH;

      if (screenX < -50 || screenX > window.innerWidth + 50 || screenY < -50 || screenY > window.innerHeight + 50) {
        item.el.style.display = 'none';
        continue;
      }

      const progress = item.elapsed / item.duration;
      const opacity = progress > 0.65 ? Math.max(0, 1.0 - (progress - 0.65) / 0.35) : 1.0;
      const scale = progress < 0.2
        ? 0.75 + (progress / 0.2) * 0.45
        : Math.max(0.7, 1.2 - (progress - 0.2) * 0.35);

      item.el.style.display = 'block';
      item.el.style.left = `${screenX}px`;
      item.el.style.top = `${screenY}px`;
      item.el.style.opacity = `${opacity.toFixed(2)}`;
      item.el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    }
  }

  private triggerSlash(x: number, z: number, facingYaw: number): void {
    this.slashTimer = 0.16;
    const y = getTerrainHeight(x, z);
    this.slashMesh.position.set(x, y + 0.45, z);
    this.slashMesh.rotation.y = facingYaw;
    this.slashMesh.visible = true;
    this.slashMat.opacity = 0.9;
  }

  private triggerSparkFlash(x: number, z: number): void {
    this.sparkFlashTimer = 0.12;
    const y = getTerrainHeight(x, z);
    this.sparkFlashMesh.position.set(x, y + 0.45, z);
    this.sparkFlashMesh.visible = true;
    this.sparkFlashMat.opacity = 0.9;
  }

  private triggerFireWave(x: number, z: number): void {
    this.fireWaveTimer = 0.28;
    const y = getTerrainHeight(x, z);
    this.fireWaveMesh.position.set(x, y + 0.12, z);
    this.fireWaveMesh.scale.set(0.1, 0.1, 0.1);
    this.fireWaveMesh.visible = true;
    this.fireWaveMat.opacity = 0.9;
  }

  private handleChestOpened(chest: ChestEntity): void {
    const cloverCount = this.ownedItems.get('four_leaf') ?? 0;
    const item = rollChestItem(this.ownedItems, cloverCount, () => Math.random());
    const count = (this.ownedItems.get(item.id) ?? 0) + 1;
    this.ownedItems.set(item.id, count);

    if (item.id === 'phoenix_down') {
      this.combatState.phoenixDownCharges += 1;
    }

    this.recalculateHeroStats();
    this.showItemCardPopup(item, count);
    toast(`Найден предмет: ${item.icon} ${item.name}!`, 2500, 'ok');
    this.updateInventoryHud();
    if (this.tabModalOpen) {
      this.updateDashboard();
    }
  }

  private showItemCardPopup(item: ItemConfig, count: number): void {
    const container = $('item-card-popup');
    if (!container) return;

    if (this.itemPopupTimeout !== undefined) {
      window.clearTimeout(this.itemPopupTimeout);
      this.itemPopupTimeout = undefined;
    }

    const rarityLabels: Record<string, string> = {
      common: 'Обычный',
      rare: 'Редкий',
      epic: 'Эпический',
      legendary: 'Легендарный',
    };

    container.innerHTML = `
      <div class="gf-item-card gf-item-card--${item.rarity}">
        <div class="gf-item-card__header">
          <span class="gf-item-card__icon">${item.icon}</span>
          <span class="gf-item-card__rarity">${rarityLabels[item.rarity] ?? item.rarity}</span>
          ${count > 1 ? `<span class="gf-item-card__count">×${count}</span>` : ''}
        </div>
        <div class="gf-item-card__name">${item.name}</div>
        <p class="gf-item-card__desc">${item.description}</p>
      </div>
    `;

    container.hidden = false;

    this.itemPopupTimeout = window.setTimeout(() => {
      container.hidden = true;
      this.itemPopupTimeout = undefined;
    }, 3000);
  }

  private recalculateHeroStats(): void {
    const bonuses = getItemStatBonuses(this.ownedItems, this.combatState.heroMaxHp, this.combatState.heroHp);

    // Скорость движения героя (с учётом улучшений speed_bonus и Перьев стрижа)
    this.playerParams.speed = DEFAULT_PLAYER_PARAMS.speed * Math.pow(1.05, this.inventory.speedBonusCount) * bonuses.speedMultiplier;
    this.playerParams.maxAirJumps = bonuses.airJumps;

    // Здоровье героя (Жёлудь +10 HP за штуку + Лечебный чай +20 HP за штуку, ERR-07)
    const targetMaxHp = HERO_CONFIG.maxHp + bonuses.maxHpBonus + (this.inventory.healBonusCount * 20);
    if (targetMaxHp !== this.combatState.heroMaxHp) {
      const diff = targetMaxHp - this.combatState.heroMaxHp;
      this.combatState.heroMaxHp = targetMaxHp;
      if (diff > 0) {
        this.combatState.heroHp += diff;
      }
      this.combatState.heroHp = Math.min(this.combatState.heroHp, this.combatState.heroMaxHp);
    }

    // Боевые параметры предметов
    this.combatState.itemDamageMultiplier = bonuses.damageMultiplier;
    this.combatState.critChance = bonuses.critChance;
    this.combatState.regenHpPerSec = bonuses.regenHpPerSec;
    this.combatState.healOnKill = bonuses.healOnKill;
    this.combatState.hasMirrorBark = bonuses.hasMirrorBark;
    this.combatState.mirrorBarkBaseCooldown = bonuses.mirrorBarkCooldown;
    if (this.combatState.mirrorBarkCooldownSec > bonuses.mirrorBarkCooldown) {
      this.combatState.mirrorBarkCooldownSec = bonuses.mirrorBarkCooldown;
    }
    this.combatState.hasNinthTail = bonuses.hasNinthTail;
    this.combatState.stormBeadCount = bonuses.stormBeadCount;
    if (bonuses.hasMirrorBark && !this.combatState.mirrorBarkReady && this.combatState.mirrorBarkCooldownSec <= 0) {
      this.combatState.mirrorBarkReady = true;
    }
  }

  private updateInventoryHud(): void {
    const container = $('inv-slots');
    container.innerHTML = '';

    for (const [wId, lvl] of this.inventory.weapons.entries()) {
      const cfg = WEAPON_CONFIGS[wId];
      const badge = document.createElement('span');
      badge.className = 'gf-inv-badge gf-inv-badge--weapon';
      badge.innerHTML = `⚔ ${cfg.name} <b>Ур.${lvl}</b>`;
      badge.title = `${cfg.name} (Ур.${lvl}): ${cfg.description}`;
      container.appendChild(badge);
    }

    for (const [tId, lvl] of this.inventory.tomes.entries()) {
      const cfg = TOME_CONFIGS[tId];
      const badge = document.createElement('span');
      badge.className = 'gf-inv-badge gf-inv-badge--tome';
      badge.innerHTML = `📖 ${cfg.name} <b>Ур.${lvl}</b>`;
      badge.title = `${cfg.name} (Ур.${lvl}): ${cfg.description}`;
      container.appendChild(badge);
    }

    for (const [itemId, count] of this.ownedItems.entries()) {
      const cfg = ITEM_CONFIGS[itemId];
      if (!cfg) continue;
      const badge = document.createElement('span');
      badge.className = `gf-inv-badge gf-inv-badge--item gf-inv-badge--${cfg.rarity}`;
      badge.innerHTML = `${cfg.icon} ${cfg.name}${count > 1 ? ` <b>×${count}</b>` : ''}`;
      badge.title = `${cfg.name} (${cfg.rarity}): ${cfg.description}`;
      container.appendChild(badge);
    }
  }

  private updateDebug(): void {
    const info = this.renderer.info.render;
    const mem = this.renderer.info.memory;
    const el = this.renderer.domElement;
    const p = this.playerState;
    const cs = this.combatState;
    const wpList = cs.weapons.map((w) => `${w.id}:${w.level}`).join(', ');
    const activeChests = this.chests.filter((c) => !c.opened).length;
    const totalItems = Array.from(this.ownedItems.values()).reduce((a, b) => a + b, 0);
    $('debug').textContent = [
      `fps ${this.fps} · кадр ${this.perfAvgMs.toFixed(1)} мс, худший ${this.perfWorstMs.toFixed(0)} мс · рывков ${this.perfSlowPerSec}/с`,
      `экран ${el.width}×${el.height} · dpr ${this.renderer.getPixelRatio().toFixed(2)} · тач ${this.input.touchMode ? 'да' : 'нет'}`,
      `вызовов ${info.calls} · треугольников ${info.triangles} · геометрий ${mem.geometries}`,
      `xyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · vy ${p.vy.toFixed(1)} · земля ${p.grounded ? 'да' : 'нет'} · прыжков ${p.airJumpsLeft ?? 0}`,
      `мобов ${cs.mobs.length} · крист ${cs.gems.length} · снарядов ${cs.projectiles.length}+${cs.heroProjectiles.length} · ур ${cs.heroLevel} · hp ${cs.heroHp}/${cs.heroMaxHp}`,
      `оружие [${wpList}] · сила ${cs.mightLevel} · ускор ${cs.hasteLevel} · скор ${this.playerParams.speed.toFixed(1)}`,
      `сундуки ${activeChests}/${this.chests.length} · предметов ${totalItems} · клевер ${this.ownedItems.get('four_leaf') ?? 0}`,
      `мышь ${this.input.mouseStats.events} соб/с · макс шаг ${this.input.mouseStats.maxStep} px`,
    ].join('\n');
  }
}

// Запуск без top-level await (офлайн-режим IIFE)
async function main(): Promise<void> {
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });
  const best = await session.bestScore();

  new SuperwalkApp(session, best);

  // session.ready() вызывается ТОЛЬКО когда сцена, интерфейс и обработчики полностью готовы к вводу
  session.ready();
}

void main();
