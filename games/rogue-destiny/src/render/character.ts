/**
 * 3D-модели мага и противников Сильванов.
 * Включает ранец на спине, свиток карты в руках, боевые взмахи посохом,
 * парирование, каст заклинаний и реакцию монстров на удары (stagger/knockback).
 */
import * as THREE from 'three';
import { createWardenModel } from './warden.ts';
import type {EnemySenses} from '../core/perception.ts';
import { enemyProfile, type SylvanKind } from '../core/enemies.ts';
import { createCryptMaterials } from './materials.ts';

import { ARM_LENGTH, STAFF_LENGTH, STAFF_GRIP, attackPose } from '../core/attack-pose.ts';

const ATTACK_TIME = 0.32;
const BUCKLER_REST = { x: -0.16, y: -0.2, z: 0.08 };
const BUCKLER_REST_YAW = -1.2;

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

  // Тени от PointLight требуют шести проходов: посох только освещает окружение.
  const staffLight = new THREE.PointLight('#38bdf8', 2.0, 16, 1.8);
  staffLight.position.y = crystalMesh.position.y;
  staffLight.castShadow = false;
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
  kind: SylvanKind;
  name: string;
  coreDamage: number;
  isStaggered: boolean;
  navigationTarget: {x:number;z:number};
  isAlive: boolean;
  aiState: 'patrol' | 'chase' | 'windup' | 'attack' | 'recover';
  stealthAvailable: boolean;
  unblockable: boolean;
  markStealthUsed: () => void;
  distract: (offset: THREE.Vector3) => void;
  takeHit: (damage: number, knockbackDir: THREE.Vector3, react?: boolean) => void;
  update: (
    delta: number,
    playerPos: THREE.Vector3,
    detectionRadius: number,
    onAttack: (damage: number, attacker: EnemySylvan3D) => void,
    senses?: EnemySenses,
  ) => void;
}

export function createSylvanEnemy(
  id: string,
  startX: number,
  startZ: number,
  materials: ReturnType<typeof createCryptMaterials>,
  isWarden = false,
  level = 1,
): EnemySylvan3D {
  const group = new THREE.Group();
  group.position.set(startX, 0, startZ);

  const profile=enemyProfile(id,level,isWarden);
  const idleEyes=profile.kind==='stalker'?'#95b8bf':'#f59e0b';

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
  const eyeMat = new THREE.MeshBasicMaterial({ color: idleEyes });
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

  const balance = profile;
  if(profile.kind==='stalker') {
    group.scale.set(0.82,1.12,0.82);
    const sporeGeo=new THREE.IcosahedronGeometry(0.18,0),sporeMaterial=new THREE.MeshToonMaterial({color:'#7c9f9e',gradientMap:materials.gradientMap});
    for(let i=0;i<5;i++){const spore=new THREE.Mesh(sporeGeo,sporeMaterial);spore.position.set(Math.sin(i*2.4)*0.35,1.35+(i%2)*0.22,-0.25);group.add(spore);}
    hornL.scale.y=hornR.scale.y=1.45;
  } else if(profile.kind==='thorn') {
    group.scale.set(1.12,1.1,1.12);
    const plateGeo=new THREE.BoxGeometry(0.45,0.8,0.18),thornGeo=new THREE.ConeGeometry(0.1,0.65,5);
    for(const side of [-1,1]) {
      const plate=new THREE.Mesh(plateGeo,materials.roots);plate.position.set(side*0.23,1,0.34);plate.rotation.z=side*0.15;group.add(plate);
      for(let i=0;i<3;i++){const thorn=new THREE.Mesh(thornGeo,materials.roots);thorn.position.set(side*(0.3+i*0.13),1.5+i*0.08,-0.1);thorn.rotation.z=side*(-0.4-i*0.25);group.add(thorn);}
    }
  }
  const maxHp = balance.hp;
  let hp = maxHp;
  const warden = isWarden ? createWardenModel(materials) : null;
  if (warden) {
    group.scale.setScalar(1.65);
    body.visible = head.visible = armLMesh.visible = armRMesh.visible = clawLMesh.visible = clawRMesh.visible = false;
    hornL.position.y = hornR.position.y = 2.4;
    group.add(warden.model);
    const crest = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), materials.aetherCrystal);
    crest.position.set(0, 2.4, 0); group.add(crest);
  }
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
  const lastKnownPlayer=new THREE.Vector3(startX,0,startZ);
  const navigationTarget=new THREE.Vector3(startX,0,startZ);

  let stealthAvailable = !isWarden;
  let strikeCount = 0;
  let slam = false;
  const warning = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 2.45, 40),
    new THREE.MeshBasicMaterial({ color: isWarden?'#f05252':'#c5a569', transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false }),
  );
  warning.rotation.x = -Math.PI / 2;
  warning.position.y = 0.12;
  warning.visible = false;
  if (isWarden || profile.kind==='thorn') group.add(warning);

  const self: EnemySylvan3D = {
    mesh: group,
    id,
    kind:profile.kind, name:profile.name, coreDamage:profile.coreDamage,
    get hp() {
      return hp;
    },
    get maxHp() {
      return maxHp;
    },
    get navigationTarget() {return navigationTarget;},
    get isStaggered() { return staggerTimer>0; },
    get isAlive() {
      return isAlive;
    },
    get aiState() {
      return aiState;
    },
    get unblockable() { return isWarden && slam; },
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
    takeHit: (damage: number, knockbackDir: THREE.Vector3, react = true) => {
      if (!isAlive) return;
      hp -= damage;
      if (!react && hp > 0) return;
      if(react&&knockbackDir.lengthSq()>0)lastKnownPlayer.copy(group.position).addScaledVector(knockbackDir,-2);
      // Тяжёлый замах босса нельзя бесконечно сбивать частыми ударами.
      const interrupt = !profile.resistsWindup || aiState !== 'windup';
      staggerTimer = interrupt ? (isWarden ? 0.12 : 0.28) : 0;
      if (interrupt) { aiState = 'chase'; warning.visible = false; }
      stealthAvailable = false;
      knockbackVel.copy(knockbackDir).multiplyScalar(profile.knockback);

      // Вспышка урона на коре и отскок рук назад
      body.scale.set(1.25, 0.85, 1.25);
      armLGroup.rotation.x = -1.2;
      armRGroup.rotation.x = -1.2;

      if (hp <= 0) {
        isAlive = false;
        warning.visible = false;
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
      senses?: EnemySenses,
    ) => {
      if (!isAlive || senses?.active===false) return;
      if (warden) {
        warden.left.rotation.x = armLGroup.rotation.x;
        warden.right.rotation.x = armRGroup.rotation.x;
        warden.model.position.y = warden.baseY + (body.position.y - 0.9);
      }

      // 1. Обработка стаггера / нокдауна
      if (staggerTimer > 0) {
        staggerTimer -= delta;
        group.position.addScaledVector(knockbackVel, delta);
        knockbackVel.multiplyScalar(0.82);
        body.scale.lerp(new THREE.Vector3(1, 1, 1), delta * 8);
        return;
      }

      const dist = group.position.distanceTo(playerPos);
      if(!senses||senses.see||senses.hear)lastKnownPlayer.copy(playerPos);
      const chaseTarget=senses&&!senses.see&&!senses.hear?lastKnownPlayer:playerPos;

      // 2. Фаза подготовки удара (Windup / Телеграф)
      if (aiState === 'windup') {
        windupTimer -= delta;
        warning.visible = isWarden && slam || profile.kind==='thorn';
        if (warning.visible) {
          const material = warning.material as THREE.MeshBasicMaterial;
          material.opacity = 0.35 + 0.3 * Math.abs(Math.sin(windupTimer * 12));
        }
        group.lookAt(chaseTarget.x, 0, chaseTarget.z);
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
        if (dist <= (isWarden ? slam ? 4.0 : 3.2 : profile.reach)) {
          onAttack(slam ? balance.slam : balance.claw, self);
        }
        warning.visible = false;
        aiState = 'recover';
        recoverTimer = isWarden ? slam ? 1.2 : 0.65 : profile.recover; // Восстановление после атаки
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

        if ((!senses||senses.see) && dist <= (isWarden ? 3.1 : profile.reach-0.5)) {
          // Игрок в зоне досягаемости: запуск телеграфа атаки
          aiState = 'windup';
          slam = isWarden && strikeCount++ % 2 === 1;
          windupTimer = isWarden ? (slam ? 1.1 : 0.65) * (hp < maxHp / 2 ? 0.8 : 1) : profile.windup;
          return;
        }

        if (group.position.distanceTo(chaseTarget) <= Math.max(detectionRadius*1.6,senses?.hear?14:0) && (!senses||senses.see||senses.hear||group.position.distanceTo(chaseTarget)>0.6)) {
          navigationTarget.copy(chaseTarget);
          // Бег к магу
          group.lookAt(chaseTarget.x, 0, chaseTarget.z);
          const dir = new THREE.Vector3().subVectors(chaseTarget, group.position).normalize();
          group.position.addScaledVector(dir, delta * (isWarden ? hp < maxHp / 2 ? 3.1 : 2.2 : profile.speed));

          // Анимация шага руками
          const step = Math.sin(performance.now() * 0.009);
          armLGroup.rotation.x = step * 0.6;
          armRGroup.rotation.x = -step * 0.6;
          body.position.y = 0.9 + Math.abs(step) * 0.05;
        } else {
          // Игрок оторвался: возврат к патрулированию
          aiState = 'patrol';
          eyeMat.color.set(idleEyes);
        }
        return;
      }

      // 6. Фаза патрулирования (Patrol)
      if (aiState === 'patrol') {
        eyeMat.color.set(idleEyes); // Спокойный янтарный взор

        // Вектор от Сильвана к магу
        const toPlayer = new THREE.Vector3().subVectors(playerPos, group.position);
        toPlayer.y = 0;
        toPlayer.normalize();

        const forward = new THREE.Vector3();
        group.getWorldDirection(forward);
        const dot = forward.dot(toPlayer);

        // Тяжёлый доспех грохочет во все стороны. При лёгком/среднем весе со спины враг не видит
        const isHeard = senses?.hear ?? (detectionRadius > 12.0 && dist <= detectionRadius);
        const isSeenInFront = senses?.see ?? (dist <= detectionRadius && dot > 0.05);
        const isTooClose = (senses?.see??true) && dist <= 1.0; // Вплотную нельзя не заметить

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
        const targetPos = new THREE.Vector3(targetX, 0, targetZ);navigationTarget.copy(targetPos);

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
