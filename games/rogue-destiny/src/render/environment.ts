/**
 * Модуль построения 3D-окружения затопленных крипт в Cel-Shaded стиле.
 */
import * as THREE from 'three';
import type { DungeonFloor, DungeonRoom } from '../core/types.ts';
import { createCryptMaterials } from './materials.ts';

export interface AncientPortal3D {
  group: THREE.Group;
  ring: THREE.Mesh;
  worldPosition: THREE.Vector3;
}

export interface CryptWorld {
  group: THREE.Group;
  materials: ReturnType<typeof createCryptMaterials>;
  aetherRifts: THREE.Mesh[];
  roomLights: Map<string, THREE.PointLight>;
  torchLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[];
  waterPlane: THREE.Mesh;
  mimics: SporeMimic3D[];
  portals: AncientPortal3D[];
}

export function buildCryptWorld(scene: THREE.Scene, floor: DungeonFloor): CryptWorld {
  const materials = createCryptMaterials();
  const worldGroup = new THREE.Group();
  const aetherRifts: THREE.Mesh[] = [];
  const roomLights = new Map<string, THREE.PointLight>();
  const mimics: SporeMimic3D[] = [];
  const portals: AncientPortal3D[] = [];

  // Огромная водная гладь затопленного пола
  const waterGeo = new THREE.PlaneGeometry(300, 300);
  const waterPlane = new THREE.Mesh(waterGeo, materials.water);
  waterPlane.rotation.x = -Math.PI / 2;
  waterPlane.position.y = 0.05;
  worldGroup.add(waterPlane);

  for (const room of floor.rooms) {
    const roomGroup = new THREE.Group();
    roomGroup.position.set(room.x, 0, room.y);

    // Каменный пол комнаты (слегка притоплен под воду)
    const floorGeo = new THREE.BoxGeometry(room.width, 0.4, room.height);
    const floorMesh = new THREE.Mesh(floorGeo, materials.floor);
    floorMesh.position.y = -0.15;
    floorMesh.receiveShadow = true;
    roomGroup.add(floorMesh);

    // Колонны по углам и краям
    const colGeo = new THREE.CylinderGeometry(0.5, 0.6, 6, 8);
    const colPositions: [number, number][] = [
      [-room.width / 2 + 1, -room.height / 2 + 1],
      [room.width / 2 - 1, -room.height / 2 + 1],
      [-room.width / 2 + 1, room.height / 2 - 1],
      [room.width / 2 - 1, room.height / 2 - 1],
    ];

    for (const [cx, cz] of colPositions) {
      const col = new THREE.Mesh(colGeo, materials.stone);
      col.position.set(cx, 3, cz);
      col.castShadow = true;
      roomGroup.add(col);
    }

    // Арочные своды над комнатой
    const archGeo = new THREE.TorusGeometry(room.width / 2.5, 0.35, 6, 12, Math.PI);
    const archMesh = new THREE.Mesh(archGeo, materials.stone);
    archMesh.position.set(0, 5, 0);
    roomGroup.add(archMesh);

    // Вековые корни Древоточцев
    const rootPoints = [
      new THREE.Vector3(-room.width / 2 + 1, 6, -room.height / 2 + 1),
      new THREE.Vector3(-room.width / 4, 3, -room.height / 4),
      new THREE.Vector3(0, 0.2, 0),
      new THREE.Vector3(room.width / 4, 0.1, room.height / 4),
    ];
    const rootCurve = new THREE.CatmullRomCurve3(rootPoints);
    const rootGeo = new THREE.TubeGeometry(rootCurve, 16, 0.25, 6, false);
    const rootMesh = new THREE.Mesh(rootGeo, materials.roots);
    roomGroup.add(rootMesh);

    // Источник света комнаты (радиально зажигается при посещении)
    const roomLight = new THREE.PointLight('#f97316', room.isVisited ? 1.8 : 0.2, 22, 1.8);
    roomLight.position.set(0, 4, 0);
    roomGroup.add(roomLight);
    roomLights.set(room.id, roomLight);

    // Эфирный Разлом (если есть в комнате)
    if (room.hasAetherRift) {
      // Каменный постамент Разлома
      const altarGeo = new THREE.CylinderGeometry(0.8, 1.0, 0.5, 8);
      const altarMesh = new THREE.Mesh(altarGeo, materials.stone);
      altarMesh.position.set(0, 0.25, 4.5);
      altarMesh.castShadow = true;
      altarMesh.receiveShadow = true;
      roomGroup.add(altarMesh);

      const riftGeo = new THREE.OctahedronGeometry(0.65, 0);
      const riftMesh = new THREE.Mesh(riftGeo, materials.aetherCrystal);
      riftMesh.position.set(0, 1.8, 4.5);
      roomGroup.add(riftMesh);
      aetherRifts.push(riftMesh);

      // Дополнительный эфирный лазурный свет Разлома
      const riftLight = new THREE.PointLight('#38bdf8', 2.5, 18, 1.5);
      riftLight.position.set(0, 1.8, 4.5);
      roomGroup.add(riftLight);
    }

    // Споровый Мимик (если тип комнаты mimic_room)
    if (room.type === 'mimic_room') {
      const mimic = createSporeMimicChest(room.id, room.x, room.y, materials);
      worldGroup.add(mimic.mesh);
      mimics.push(mimic);
    }

    // Древний Портал в глубины крипт (если тип комнаты boss_gate)
    if (room.type === 'boss_gate') {
      const portalGroup = new THREE.Group();
      portalGroup.position.set(0, 0, 4.5);

      // Каменные колонны арки
      const pillarGeo = new THREE.CylinderGeometry(0.35, 0.45, 3.5, 6);
      const pillarL = new THREE.Mesh(pillarGeo, materials.stone);
      pillarL.position.set(-1.8, 1.75, 0);
      pillarL.castShadow = true;
      portalGroup.add(pillarL);

      const pillarR = new THREE.Mesh(pillarGeo, materials.stone);
      pillarR.position.set(1.8, 1.75, 0);
      pillarR.castShadow = true;
      portalGroup.add(pillarR);

      // Каменная перемычка арки
      const archGeo = new THREE.BoxGeometry(4.2, 0.5, 0.6);
      const archMesh = new THREE.Mesh(archGeo, materials.stone);
      archMesh.position.set(0, 3.6, 0);
      archMesh.castShadow = true;
      portalGroup.add(archMesh);

      // Вращающееся эфирное кольцо портала
      const ringGeo = new THREE.TorusGeometry(1.3, 0.15, 8, 24);
      const ringMesh = new THREE.Mesh(ringGeo, materials.aetherCrystal);
      ringMesh.position.set(0, 1.8, 0);
      portalGroup.add(ringMesh);

      // Вихрь внутри портала
      const vortexGeo = new THREE.CircleGeometry(1.2, 16);
      const vortexMat = new THREE.MeshBasicMaterial({
        color: '#a855f7',
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      });
      const vortexMesh = new THREE.Mesh(vortexGeo, vortexMat);
      vortexMesh.position.set(0, 1.8, 0.05);
      portalGroup.add(vortexMesh);

      // Пурпурно-лазурный свет портала
      const portalLight = new THREE.PointLight('#c084fc', 2.8, 16, 1.8);
      portalLight.position.set(0, 2.0, 0.5);
      portalGroup.add(portalLight);

      roomGroup.add(portalGroup);
      portals.push({
        group: portalGroup,
        ring: ringMesh,
        worldPosition: new THREE.Vector3(room.x, 0, room.y + 4.5),
      });
    }

    worldGroup.add(roomGroup);
  }

  const torchLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[] = [];

  // Общие геометрии и материалы для деревянных факелов
  const torchPoleGeo = new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6);
  const torchBracketGeo = new THREE.CylinderGeometry(0.12, 0.06, 0.22, 6);
  const torchFlameGeo = new THREE.SphereGeometry(0.11, 6, 6);
  const torchFlameMat = new THREE.MeshBasicMaterial({ color: '#f59e0b' });
  const torchTipGeo = new THREE.ConeGeometry(0.07, 0.22, 5);
  const torchTipMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });

  function createTorchPost(x: number, z: number, phase: number): THREE.Group {
    const torchGroup = new THREE.Group();
    torchGroup.position.set(x, 0, z);

    // Деревянная палка / шест факела
    const pole = new THREE.Mesh(torchPoleGeo, materials.sylvanBark);
    pole.position.y = 1.1;
    pole.castShadow = true;
    torchGroup.add(pole);

    // Каменная / железная чаша навершия
    const bracket = new THREE.Mesh(torchBracketGeo, materials.stone);
    bracket.position.y = 2.15;
    torchGroup.add(bracket);

    // Светящееся янтарное ядро пламени
    const flame = new THREE.Mesh(torchFlameGeo, torchFlameMat);
    flame.position.y = 2.3;
    torchGroup.add(flame);

    // Верхний язычок пламени
    const tip = new THREE.Mesh(torchTipGeo, torchTipMat);
    tip.position.y = 2.45;
    torchGroup.add(tip);

    // Теплый янтарный источник света для освещения пути
    const light = new THREE.PointLight('#f59e0b', 1.8, 14, 1.6);
    light.position.y = 2.35;
    torchGroup.add(light);

    torchLights.push({ light, baseIntensity: 1.8, phase });
    return torchGroup;
  }

  // Добавляем коридоры, соединяющие комнаты, и расставляем факелы вдоль маршрута
  for (const [rAId, rBId] of floor.connections) {
    const rA = floor.rooms.find((r) => r.id === rAId);
    const rB = floor.rooms.find((r) => r.id === rBId);
    if (!rA || !rB) continue;

    const midX = (rA.x + rB.x) / 2;
    const midZ = (rA.y + rB.y) / 2;
    const dist = Math.hypot(rB.x - rA.x, rB.y - rA.y);
    const angle = Math.atan2(rB.y - rA.y, rB.x - rA.x);

    const corrGeo = new THREE.BoxGeometry(dist, 0.35, 4);
    const corrMesh = new THREE.Mesh(corrGeo, materials.floor);
    corrMesh.position.set(midX, -0.15, midZ);
    corrMesh.rotation.y = -angle;
    worldGroup.add(corrMesh);

    // Расстановка факелов на палках по обочинам коридора
    const nx = -Math.sin(angle);
    const nz = Math.cos(angle);
    const numTorches = Math.max(2, Math.floor(dist / 6.5));

    for (let i = 1; i <= numTorches; i++) {
      const t = i / (numTorches + 1);
      const px = rA.x + (rB.x - rA.x) * t;
      const pz = rA.y + (rB.y - rA.y) * t;
      // Чередуем левую и правую обочину коридора (смещение 1.7 м от центра)
      const side = (i % 2 === 0 ? 1 : -1) * 1.75;
      const torchX = px + nx * side;
      const torchZ = pz + nz * side;

      const torch = createTorchPost(torchX, torchZ, i * 1.3);
      worldGroup.add(torch);
    }
  }

  scene.add(worldGroup);

  return {
    group: worldGroup,
    materials,
    aetherRifts,
    roomLights,
    torchLights,
    waterPlane,
    mimics,
    portals,
  };
}

export interface SporeMimic3D {
  mesh: THREE.Group;
  roomId: string;
  worldPosition: THREE.Vector3;
  isOpened: boolean;
  isAwakened: boolean;
  triggerQteAvailable: boolean;
  openChest: () => void;
  awakenMimic: () => void;
  update: (delta: number) => void;
}

export function createSporeMimicChest(
  roomId: string,
  worldX: number,
  worldZ: number,
  materials: ReturnType<typeof createCryptMaterials>,
): SporeMimic3D {
  const group = new THREE.Group();
  group.position.set(worldX, 0, worldZ);
  const worldPosition = new THREE.Vector3(worldX, 0, worldZ);

  // 1. Корпус сундука
  const chestBaseGeo = new THREE.BoxGeometry(1.3, 0.7, 0.9);
  const chestBase = new THREE.Mesh(chestBaseGeo, materials.sylvanBark);
  chestBase.position.y = 0.35;
  chestBase.castShadow = true;
  chestBase.receiveShadow = true;
  group.add(chestBase);

  // Стальные полосы
  const bandGeo = new THREE.BoxGeometry(1.32, 0.72, 0.12);
  const bandL = new THREE.Mesh(bandGeo, materials.stone);
  bandL.position.set(0, 0.35, -0.25);
  group.add(bandL);
  const bandR = new THREE.Mesh(bandGeo, materials.stone);
  bandR.position.set(0, 0.35, 0.25);
  group.add(bandR);

  // 2. Откидная верхняя крышка (шарнир у заднего края)
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.7, -0.45);
  group.add(lidPivot);

  const lidGeo = new THREE.BoxGeometry(1.34, 0.35, 0.94);
  const lidMesh = new THREE.Mesh(lidGeo, materials.sylvanBark);
  lidMesh.position.set(0, 0.175, 0.47);
  lidMesh.castShadow = true;
  lidPivot.add(lidMesh);

  // Стальные полосы крышки
  const lidBandGeo = new THREE.BoxGeometry(1.36, 0.37, 0.12);
  const lidBandL = new THREE.Mesh(lidBandGeo, materials.stone);
  lidBandL.position.set(0, 0.175, 0.22);
  lidPivot.add(lidBandL);
  const lidBandR = new THREE.Mesh(lidBandGeo, materials.stone);
  lidBandR.position.set(0, 0.175, 0.72);
  lidPivot.add(lidBandR);

  // Крышка слегка приоткрыта в покое
  lidPivot.rotation.x = -0.22;

  // 3. Глаза в щели сундука (изумрудные в покое, алые при пробуждении)
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#10b981' });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
  eyeL.position.set(-0.25, 0.73, 0.0);
  group.add(eyeL);

  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
  eyeR.position.set(0.25, 0.73, 0.0);
  group.add(eyeR);

  // 4. Споровые усики-щупальца, торчащие наружу
  const tendrilMat = new THREE.MeshBasicMaterial({ color: '#10b981' });
  const tendrilGeo = new THREE.CylinderGeometry(0.025, 0.04, 0.5, 4);
  tendrilGeo.translate(0, 0.25, 0);

  const tendrils: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(tendrilGeo, tendrilMat);
    t.position.set(-0.28 + i * 0.28, 0.68, 0.1);
    t.rotation.x = 0.5;
    t.rotation.z = (i - 1) * 0.25;
    group.add(t);
    tendrils.push(t);
  }

  // 5. Изумрудное споровое свечение
  const sporeLight = new THREE.PointLight('#10b981', 1.8, 6, 2.0);
  sporeLight.position.set(0, 0.75, 0.1);
  group.add(sporeLight);

  // Внутренний кристалл-артефакт
  const relicGeo = new THREE.DodecahedronGeometry(0.22, 0);
  const relicMesh = new THREE.Mesh(relicGeo, materials.aetherCrystal);
  relicMesh.position.set(0, 0.55, 0);
  relicMesh.visible = false;
  group.add(relicMesh);

  let isOpened = false;
  let isAwakened = false;
  let triggerQteAvailable = true;
  let animTime = 0;

  return {
    mesh: group,
    roomId,
    worldPosition,
    get isOpened() {
      return isOpened;
    },
    get isAwakened() {
      return isAwakened;
    },
    get triggerQteAvailable() {
      return triggerQteAvailable && !isOpened && !isAwakened;
    },
    openChest: () => {
      isOpened = true;
      triggerQteAvailable = false;
      lidPivot.rotation.x = -1.4; // Распахнутая крышка
      eyeMat.color.set('#334155'); // Глаза гаснут
      sporeLight.color.set('#38bdf8'); // Лазурное сияние реликта
      sporeLight.intensity = 2.4;
      relicMesh.visible = true;
      for (const t of tendrils) t.visible = false;
    },
    awakenMimic: () => {
      isAwakened = true;
      triggerQteAvailable = false;
      lidPivot.rotation.x = -0.55;
      eyeMat.color.set('#dc2626');
      sporeLight.color.set('#ef4444');
      sporeLight.intensity = 3.5;
    },
    update: (delta: number) => {
      animTime += delta;
      if (!isOpened && !isAwakened) {
        // Дыхание мимика в покое
        lidPivot.rotation.x = -0.22 + Math.sin(animTime * 3) * 0.05;
        tendrils.forEach((t, i) => {
          t.rotation.x = 0.5 + Math.sin(animTime * 4 + i) * 0.15;
          t.rotation.z = (i - 1) * 0.25 + Math.cos(animTime * 3.5 + i) * 0.1;
        });
      } else if (isOpened) {
        // Вращение реликта внутри
        relicMesh.rotation.y += delta * 1.5;
        relicMesh.rotation.x += delta * 0.8;
      }
    },
  };
}
