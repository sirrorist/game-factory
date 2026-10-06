/**
 * 3D-модели мага и противников Сильванов.
 * Включает ранец на спине, свиток карты в руках, боевые взмахи посохом,
 * парирование, каст заклинаний и реакцию монстров на удары (stagger/knockback).
 */
import * as THREE from 'three';
import { createCryptMaterials } from './materials.ts';

export const ARM_LENGTH = 0.55;
export const STAFF_LENGTH = 2.0;
export const STAFF_GRIP = 0.35;
const ATTACK_TIME = 0.32;
const BUCKLER_REST = { x: -0.16, y: -0.2, z: 0.08 };
const BUCKLER_REST_YAW = -1.2;

/** Поза руки в момент t (0..1) удара посохом: плечо, наклон посоха в мире, увод к центру. */
export function attackPose(t: number): { shoulder: number; staff: number; inward: number } {
  const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
  if (t < 0.3) {
    // Замах: рука вверх, навершие уходит за плечо
    const p = t / 0.3;
    return { shoulder: lerp(-0.3, -2.6, p), staff: lerp(0, -0.6, p), inward: 0 };
  }
  if (t < 0.65) {
    // Удар: рубящая дуга сверху вниз перед собой, навершие - вперёд и вниз
    const p = (t - 0.3) / 0.35;
    const e = 1 - (1 - p) * (1 - p);
    return { shoulder: lerp(-2.6, -1.2, e), staff: lerp(-0.6, 1.9, e), inward: lerp(0, 0.3, e) };
  }
  // Возврат в стойку
  const p = (t - 0.65) / 0.35;
  return { shoulder: lerp(-1.2, -0.3, p), staff: lerp(1.9, 0, p), inward: lerp(0.3, 0, p) };
}

export interface Character3D {
  mesh: THREE.Group;
  staffLight: THREE.PointLight;
  crystalMesh: THREE.Mesh;
  mapMesh: THREE.Group;
  triggerAttack: () => void;
  triggerCast: () => void;
  setParry: (active: boolean) => void;
  setBrowsing: (browsing: boolean) => void;
  update: (delta: number, isMoving: boolean) => void;
  isAttacking: boolean;
  isParrying: boolean;
}

export function createPlayerCharacter(
  materials: ReturnType<typeof createCryptMaterials>,
  lowPower = false,
): Character3D {
  const group = new THREE.Group();

  // Торс и роба
  const bodyGeo = new THREE.CylinderGeometry(0.35, 0.45, 1.4, 8);
  const body = new THREE.Mesh(bodyGeo, materials.mageCloth);
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);

  // Капюшон
  const hoodGeo = new THREE.SphereGeometry(0.3, 8, 8);
  const hood = new THREE.Mesh(hoodGeo, materials.mageCloth);
  hood.position.y = 1.85;
  hood.castShadow = true;
  group.add(hood);

  // Лицо во тьме капюшона
  const faceVoidGeo = new THREE.SphereGeometry(0.18, 6, 6);
  const faceVoidMat = new THREE.MeshBasicMaterial({ color: '#05070a' });
  const faceVoid = new THREE.Mesh(faceVoidGeo, faceVoidMat);
  faceVoid.position.set(0, 1.85, 0.16);
  group.add(faceVoid);

  // Походный Тарков-ранец за спиной
  const backpackMat = new THREE.MeshToonMaterial({
    color: '#382b1f',
    gradientMap: materials.gradientMap,
  });
  const backpackGeo = new THREE.BoxGeometry(0.55, 0.7, 0.3);
  const backpack = new THREE.Mesh(backpackGeo, backpackMat);
  backpack.position.set(0, 1.15, -0.42);
  backpack.castShadow = true;
  group.add(backpack);

  // Навесные подсумки на ранце
  const pouchGeo = new THREE.BoxGeometry(0.2, 0.25, 0.15);
  const pouchL = new THREE.Mesh(pouchGeo, backpackMat);
  pouchL.position.set(-0.2, 0.95, -0.5);
  const pouchR = new THREE.Mesh(pouchGeo, backpackMat);
  pouchR.position.set(0.2, 0.95, -0.5);
  group.add(pouchL);
  group.add(pouchR);

  // Плащ за спиной
  const capeGeo = new THREE.PlaneGeometry(0.7, 1.3);
  const cape = new THREE.Mesh(capeGeo, materials.mageCloth);
  cape.position.set(0, 1.1, -0.48);
  cape.rotation.x = 0.1;
  group.add(cape);

  // Правая рука - от плеча: удар идёт поворотом плеча, а посох держится в кисти.
  // Раньше посох вращался вокруг своей середины отдельно от руки, и нижний конец
  // при ударе проходил сквозь мага (приёмка владельца, пункт 5).
  const shoulderR = new THREE.Group();
  shoulderR.position.set(0.4, 1.42, 0.05);
  const rightArmGeo = new THREE.CylinderGeometry(0.09, 0.12, ARM_LENGTH, 6);
  const rightArm = new THREE.Mesh(rightArmGeo, materials.mageCloth);
  rightArm.position.y = -ARM_LENGTH / 2;
  shoulderR.add(rightArm);
  group.add(shoulderR);

  // Посох в кисти: хват на 0.35 м от нижнего конца, ось поворота - кисть
  const staffGroup = new THREE.Group();
  staffGroup.position.y = -ARM_LENGTH;
  shoulderR.add(staffGroup);

  const staffShaftGeo = new THREE.CylinderGeometry(0.04, 0.05, STAFF_LENGTH, 6);
  const staffShaft = new THREE.Mesh(staffShaftGeo, materials.staffWood);
  staffShaft.position.y = STAFF_LENGTH / 2 - STAFF_GRIP;
  staffGroup.add(staffShaft);

  // Лазурный кристалл навершия
  const crystalGeo = new THREE.OctahedronGeometry(0.14, 0);
  const crystalMesh = new THREE.Mesh(crystalGeo, materials.aetherCrystal);
  crystalMesh.position.y = STAFF_LENGTH - STAFF_GRIP + 0.05;
  staffGroup.add(crystalMesh);

  // Динамический свет посоха. Тень от точечного света - шесть проходов рендера за кадр:
  // на телефоне это ощутимо, поэтому тень - только на ПК.
  const staffLight = new THREE.PointLight('#38bdf8', 2.0, 16, 1.8);
  staffLight.position.y = crystalMesh.position.y;
  staffLight.castShadow = !lowPower;
  staffGroup.add(staffLight);

  /** Поза руки: угол плеча (минус - рука вперёд), наклон посоха в мире и увод к центру. */
  function pose(shoulder: number, staffWorld: number, inward = 0): void {
    shoulderR.rotation.set(shoulder, 0, -inward);
    staffGroup.rotation.set(staffWorld - shoulder, 0, inward);
  }

  // Левая рука персонажа
  const leftArmGroup = new THREE.Group();
  leftArmGroup.position.set(-0.38, 1.12, 0.05);

  const leftArmGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.55, 6);
  const leftArm = new THREE.Mesh(leftArmGeo, materials.mageCloth);
  leftArm.position.set(0, -0.15, 0.08);
  leftArm.rotation.x = 0.35;
  leftArmGroup.add(leftArm);

  // Щит-баклер на внешней стороне предплечья, лицом наружу: камера стоит сзади-сбоку, и щит,
  // смотревший вперёд, наполовину уходил в робу - со спины его было не видно (приёмка, пункт 9).
  const bucklerGroup = new THREE.Group();
  bucklerGroup.position.set(BUCKLER_REST.x, BUCKLER_REST.y, BUCKLER_REST.z);
  bucklerGroup.rotation.set(0, BUCKLER_REST_YAW, 0);

  // Деревянный диск щита
  const bucklerGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12);
  const buckler = new THREE.Mesh(bucklerGeo, materials.sylvanBark);
  buckler.rotation.x = Math.PI / 2;
  buckler.castShadow = true;
  bucklerGroup.add(buckler);

  // Стальной кант щита
  const bucklerRimGeo = new THREE.TorusGeometry(0.32, 0.035, 6, 14);
  const bucklerRim = new THREE.Mesh(bucklerRimGeo, materials.stone);
  bucklerGroup.add(bucklerRim);

  // Лазурный умбон-кристалл в центре щита
  const bucklerBossGeo = new THREE.OctahedronGeometry(0.09, 0);
  const bucklerBoss = new THREE.Mesh(bucklerBossGeo, materials.aetherCrystal);
  bucklerBoss.position.z = 0.04;
  bucklerGroup.add(bucklerBoss);

  leftArmGroup.add(bucklerGroup);
  group.add(leftArmGroup);

  function restLeftArm(isMoving: boolean): void {
    leftArmGroup.position.set(-0.38, 1.12 + (isMoving ? -Math.sin(walkCycle * 0.5) * 0.06 : 0), 0.05);
    bucklerGroup.position.set(BUCKLER_REST.x, BUCKLER_REST.y, BUCKLER_REST.z);
    bucklerGroup.rotation.set(0, BUCKLER_REST_YAW, 0);
  }

  // Эфирный энергетический барьер парирования (активируется при поднятии щита)
  const parryShieldGeo = new THREE.RingGeometry(0.2, 0.85, 16);
  const parryShieldMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.0,
  });
  const parryShield = new THREE.Mesh(parryShieldGeo, parryShieldMat);
  parryShield.position.set(-0.15, 1.25, 0.65);
  parryShield.visible = false;
  group.add(parryShield);

  // Свиток карты в левой руке (виден при открытии TAB)
  const mapGroup = new THREE.Group();
  mapGroup.position.set(-0.35, 1.25, 0.45);
  mapGroup.rotation.set(-0.3, 0.3, 0);
  mapGroup.visible = false;

  const mapPaperGeo = new THREE.PlaneGeometry(0.45, 0.35);
  const mapPaperMat = new THREE.MeshBasicMaterial({
    color: '#fef08a',
    side: THREE.DoubleSide,
  });
  const mapPaper = new THREE.Mesh(mapPaperGeo, mapPaperMat);
  mapGroup.add(mapPaper);
  group.add(mapGroup);

  let walkCycle = 0;
  let attackTimer = 0;
  let castTimer = 0;
  let isBrowsing = false;
  let isParrying = false;

  return {
    mesh: group,
    staffLight,
    crystalMesh,
    mapMesh: mapGroup,
    get isAttacking() {
      return attackTimer > 0;
    },
    get isParrying() {
      return isParrying;
    },
    triggerAttack: () => {
      if (attackTimer <= 0) attackTimer = ATTACK_TIME;
    },
    triggerCast: () => {
      if (castTimer <= 0) castTimer = 0.4;
    },
    setParry: (active: boolean) => {
      isParrying = active;
      parryShield.visible = active;
      parryShieldMat.opacity = active ? 0.7 : 0.0;
    },
    setBrowsing: (browsing: boolean) => {
      isBrowsing = browsing;
      mapGroup.visible = browsing;
    },
    update: (delta: number, isMoving: boolean) => {
      // Пульсация кристалла посоха
      crystalMesh.rotation.y += delta * 2;
      crystalMesh.rotation.x += delta * 1.2;

      // Анимация ходьбы
      if (isMoving) {
        walkCycle += delta * 9;
        body.position.y = 1.0 + Math.sin(walkCycle) * 0.06;
        backpack.position.y = 1.15 + Math.sin(walkCycle) * 0.06;
        cape.rotation.x = 0.1 + Math.sin(walkCycle) * 0.18;
      } else {
        body.position.y = 1.0;
        backpack.position.y = 1.15;
        cape.rotation.x = 0.1;
      }

      // 1. Состояние: Атака посохом - рубящий удар от плеча перед собой
      if (attackTimer > 0) {
        attackTimer -= delta;
        const a = attackPose(Math.min(1, 1 - attackTimer / ATTACK_TIME));
        pose(a.shoulder, a.staff, a.inward);
        restLeftArm(isMoving);
      }
      // 2. Состояние: Каст магии - посох вскинут над головой
      else if (castTimer > 0) {
        castTimer -= delta;
        pose(-2.2, -0.1);
        staffLight.intensity = 4.5;
        restLeftArm(isMoving);
      }
      // 3. Состояние: Парирование щитом (щит выносится перед грудью)
      else if (isParrying) {
        pose(-0.5, 0.2);
        staffLight.intensity = 3.0;

        leftArmGroup.position.set(-0.18, 1.25, 0.32);
        bucklerGroup.position.set(0, 0, 0.2);
        bucklerGroup.rotation.set(0, 0, 0);
      }
      // 4. Состояние: Осмотр рюкзака / карты на ходу (TAB)
      else if (isBrowsing) {
        pose(-0.1, 0.4);
        mapGroup.position.y = 1.25 + Math.sin(walkCycle * 0.5) * 0.04;

        leftArmGroup.position.set(-0.38, 1.0, 0.0);
        bucklerGroup.rotation.set(0, -1.2, 0);
      }
      // 5. Стандартный покой / шаг
      else {
        pose(-0.3 + (isMoving ? Math.sin(walkCycle * 0.5) * 0.12 : 0), 0);
        staffLight.intensity = 2.0;
        restLeftArm(isMoving);
      }
    },
  };
}

export interface EnemySylvan3D {
  mesh: THREE.Group;
  id: string;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  aiState: 'patrol' | 'chase' | 'windup' | 'attack' | 'recover';
  stealthAvailable: boolean;
  markStealthUsed: () => void;
  distract: (offset: THREE.Vector3) => void;
  takeHit: (damage: number, knockbackDir: THREE.Vector3) => void;
  update: (
    delta: number,
    playerPos: THREE.Vector3,
    detectionRadius: number,
    onAttack: (damage: number, attacker: EnemySylvan3D) => void,
  ) => void;
}

export function createSylvanEnemy(
  id: string,
  startX: number,
  startZ: number,
  materials: ReturnType<typeof createCryptMaterials>,
): EnemySylvan3D {
  const group = new THREE.Group();
  group.position.set(startX, 0, startZ);

  // Древесный торс
  const bodyGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.3, 6);
  const body = new THREE.Mesh(bodyGeo, materials.sylvanBark);
  body.position.y = 0.9;
  group.add(body);

  // Голова с рогами из корней
  const headGeo = new THREE.BoxGeometry(0.35, 0.4, 0.35);
  const head = new THREE.Mesh(headGeo, materials.sylvanBark);
  head.position.y = 1.7;
  group.add(head);

  // Корневые наросты/рога
  const hornLGeo = new THREE.ConeGeometry(0.08, 0.45, 4);
  const hornL = new THREE.Mesh(hornLGeo, materials.roots);
  hornL.position.set(-0.16, 2.0, 0);
  hornL.rotation.z = 0.35;
  group.add(hornL);

  const hornR = new THREE.Mesh(hornLGeo, materials.roots);
  hornR.position.set(0.16, 2.0, 0);
  hornR.rotation.z = -0.35;
  group.add(hornR);

  // Светящиеся глаза (янтарные в покое, алые при агро/атаке)
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#f59e0b' });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), eyeMat);
  eyeL.position.set(-0.1, 1.75, 0.18);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), eyeMat);
  eyeR.position.set(0.1, 1.75, 0.18);
  group.add(eyeL);
  group.add(eyeR);

  // Когтистые руки-ветви Сильвана (с вращением в плече)
  const armGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.8, 5);
  armGeo.translate(0, -0.35, 0); // Центр вращения в плече
  const clawGeo = new THREE.ConeGeometry(0.08, 0.35, 4);
  clawGeo.rotateX(Math.PI);
  clawGeo.translate(0, -0.85, 0.05);

  const armLGroup = new THREE.Group();
  armLGroup.position.set(-0.4, 1.4, 0);
  const armLMesh = new THREE.Mesh(armGeo, materials.sylvanBark);
  const clawLMesh = new THREE.Mesh(clawGeo, materials.roots);
  armLGroup.add(armLMesh);
  armLGroup.add(clawLMesh);
  group.add(armLGroup);

  const armRGroup = new THREE.Group();
  armRGroup.position.set(0.4, 1.4, 0);
  const armRMesh = new THREE.Mesh(armGeo, materials.sylvanBark);
  const clawRMesh = new THREE.Mesh(clawGeo, materials.roots);
  armRGroup.add(armRMesh);
  armRGroup.add(clawRMesh);
  group.add(armRGroup);

  let hp = 40;
  const maxHp = 40;
  let isAlive = true;
  let staggerTimer = 0;
  const knockbackVel = new THREE.Vector3();

  // Состояния ИИ Сильвана
  type SylvanAiState = 'patrol' | 'chase' | 'windup' | 'attack' | 'recover';
  let aiState: SylvanAiState = 'patrol';
  let windupTimer = 0;
  let recoverTimer = 0;
  let patrolAngle = Math.random() * Math.PI * 2;
  const patrolCenter = new THREE.Vector3(startX, 0, startZ);

  let stealthAvailable = true;

  const self: EnemySylvan3D = {
    mesh: group,
    id,
    get hp() {
      return hp;
    },
    get maxHp() {
      return maxHp;
    },
    get isAlive() {
      return isAlive;
    },
    get aiState() {
      return aiState;
    },
    get stealthAvailable() {
      return stealthAvailable && isAlive && aiState === 'patrol';
    },
    markStealthUsed: () => {
      stealthAvailable = false;
    },
    distract: (offset: THREE.Vector3) => {
      group.position.add(offset);
      aiState = 'patrol';
      stealthAvailable = false;
      patrolCenter.copy(group.position);
    },
    takeHit: (damage: number, knockbackDir: THREE.Vector3) => {
      if (!isAlive) return;
      hp -= damage;
      staggerTimer = 0.28; // Стан / отшатывание
      aiState = 'chase';
      stealthAvailable = false;
      knockbackVel.copy(knockbackDir).multiplyScalar(7.0);

      // Вспышка урона на коре и отскок рук назад
      body.scale.set(1.25, 0.85, 1.25);
      armLGroup.rotation.x = -1.2;
      armRGroup.rotation.x = -1.2;

      if (hp <= 0) {
        isAlive = false;
        eyeMat.color.set('#1e293b'); // Глаза гаснут
        // Анимация падения побежденного Сильвана
        group.rotation.x = Math.PI / 2;
        group.position.y = -0.3;
      }
    },
    update: (
      delta: number,
      playerPos: THREE.Vector3,
      detectionRadius: number,
      onAttack: (damage: number, attacker: EnemySylvan3D) => void,
    ) => {
      if (!isAlive) return;

      // 1. Обработка стаггера / нокдауна
      if (staggerTimer > 0) {
        staggerTimer -= delta;
        group.position.addScaledVector(knockbackVel, delta);
        knockbackVel.multiplyScalar(0.82);
        body.scale.lerp(new THREE.Vector3(1, 1, 1), delta * 8);
        return;
      }

      const dist = group.position.distanceTo(playerPos);

      // 2. Фаза подготовки удара (Windup / Телеграф)
      if (aiState === 'windup') {
        windupTimer -= delta;
        group.lookAt(playerPos.x, 0, playerPos.z);
        // Замах обеими когтистыми руками высоко над головой
        armLGroup.rotation.x = THREE.MathUtils.lerp(armLGroup.rotation.x, -2.2, delta * 12);
        armRGroup.rotation.x = THREE.MathUtils.lerp(armRGroup.rotation.x, -2.2, delta * 12);
        body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, -0.2, delta * 10);
        eyeMat.color.set('#ef4444');

        // Пульсация когтей (визуальный телеграф замаха)
        const clawPulse = 1.0 + Math.sin((0.45 - windupTimer) * 25) * 0.35;
        clawLMesh.scale.set(clawPulse, clawPulse, clawPulse);
        clawRMesh.scale.set(clawPulse, clawPulse, clawPulse);

        if (windupTimer <= 0) {
          // Переход к удару
          clawLMesh.scale.set(1, 1, 1);
          clawRMesh.scale.set(1, 1, 1);
          aiState = 'attack';
        }
        return;
      }

      // 3. Фаза удара (Attack / Выпад)
      if (aiState === 'attack') {
        clawLMesh.scale.set(1, 1, 1);
        clawRMesh.scale.set(1, 1, 1);
        // Резкий выпад когтями вперёд и вниз
        armLGroup.rotation.x = 0.9;
        armRGroup.rotation.x = 0.9;
        body.rotation.x = 0.25;

        // Проверка попадания по игроку
        if (dist <= 2.6) {
          onAttack(16, self);
        }

        aiState = 'recover';
        recoverTimer = 0.55; // Восстановление после атаки
        return;
      }

      // 4. Фаза восстановления (Recover)
      if (aiState === 'recover') {
        recoverTimer -= delta;
        armLGroup.rotation.x = THREE.MathUtils.lerp(armLGroup.rotation.x, 0, delta * 6);
        armRGroup.rotation.x = THREE.MathUtils.lerp(armRGroup.rotation.x, 0, delta * 6);
        body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, 0, delta * 6);

        if (recoverTimer <= 0) {
          aiState = 'chase';
        }
        return;
      }

      // 5. Фаза преследования (Chase)
      if (aiState === 'chase') {
        eyeMat.color.set('#ef4444'); // Глаза горят алым

        if (dist <= 2.1) {
          // Игрок в зоне досягаемости: запуск телеграфа атаки
          aiState = 'windup';
          windupTimer = 0.45; // 450 мс на реакцию и парирование игроком!
          return;
        }

        if (dist <= detectionRadius * 1.6) {
          // Бег к магу
          group.lookAt(playerPos.x, 0, playerPos.z);
          const dir = new THREE.Vector3().subVectors(playerPos, group.position).normalize();
          group.position.addScaledVector(dir, delta * 2.6);

          // Анимация шага руками
          const step = Math.sin(performance.now() * 0.009);
          armLGroup.rotation.x = step * 0.6;
          armRGroup.rotation.x = -step * 0.6;
          body.position.y = 0.9 + Math.abs(step) * 0.05;
        } else {
          // Игрок оторвался: возврат к патрулированию
          aiState = 'patrol';
          eyeMat.color.set('#f59e0b');
        }
        return;
      }

      // 6. Фаза патрулирования (Patrol)
      if (aiState === 'patrol') {
        eyeMat.color.set('#f59e0b'); // Спокойный янтарный взор

        // Вектор от Сильвана к магу
        const toPlayer = new THREE.Vector3().subVectors(playerPos, group.position);
        toPlayer.y = 0;
        toPlayer.normalize();

        const forward = new THREE.Vector3();
        group.getWorldDirection(forward);
        const dot = forward.dot(toPlayer);

        // Тяжёлый доспех грохочет во все стороны. При лёгком/среднем весе со спины враг не видит
        const isHeard = detectionRadius > 12.0 && dist <= detectionRadius;
        const isSeenInFront = dist <= detectionRadius && dot > 0.05;
        const isTooClose = dist <= 1.0; // Вплотную нельзя не заметить

        if (isHeard || isSeenInFront || isTooClose) {
          // Маг обнаружен!
          aiState = 'chase';
          eyeMat.color.set('#ef4444');
          stealthAvailable = false;
          return;
        }

        // Плавное блуждание по залу вокруг точки появления
        patrolAngle += delta * 0.5;
        const targetX = patrolCenter.x + Math.cos(patrolAngle) * 3.0;
        const targetZ = patrolCenter.z + Math.sin(patrolAngle) * 3.0;
        const targetPos = new THREE.Vector3(targetX, 0, targetZ);

        group.lookAt(targetPos.x, 0, targetPos.z);
        const dir = new THREE.Vector3().subVectors(targetPos, group.position);
        if (dir.length() > 0.4) {
          dir.normalize();
          group.position.addScaledVector(dir, delta * 1.1);
        }

        const sway = Math.sin(performance.now() * 0.003);
        armLGroup.rotation.x = sway * 0.2;
        armRGroup.rotation.x = -sway * 0.2;
        body.position.y = 0.9 + Math.abs(sway) * 0.03;
      }
    },
  };

  return self;
}
