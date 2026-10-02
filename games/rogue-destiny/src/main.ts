/**
 * Главная точка входа Rogue Destiny.
 * Шаг 4: Полный UI-слой, анимации взаимодействия персонажа с миром/мобами/рюкзаком/картой,
 * живые удары посохом (охлаждение тепла), парирование и каст магии.
 */
import * as THREE from 'three';
import { GameFactory } from '@gf/game-sdk';
import './style.css';

import {
  createPlayer,
  performPhysicalAttack,
  castMagic,
  performParry,
  applyHealing,
  applyDamage,
  restAtAetherRift,
  forceVentHeat,
  calculateScore,
} from './core/player.ts';
import { createInventory, placeItem, canPlaceItem, calculateInventoryStats } from './core/inventory.ts';
import { generateFloor, enterRoom } from './core/dungeon.ts';
import type { InventoryItem, WeightClass } from './core/types.ts';

import { createCryptMaterials } from './render/materials.ts';
import { buildCryptWorld, type SporeMimic3D } from './render/environment.ts';
import { createPlayerCharacter, createSylvanEnemy, type EnemySylvan3D } from './render/character.ts';
import { createCombatTextManager } from './render/combatText.ts';
import { createHud, updateHud, drawMinimap, triggerDamageFlash, triggerFateFlash } from './ui/hud.ts';
import { createInventoryView } from './ui/inventoryView.ts';
import { createEncountersUI, type StealthChoice, type ScoreBreakdown } from './ui/encounters.ts';
import { createTouchControls, isMobileOrTouch } from './ui/touchControls.ts';

async function main(): Promise<void> {
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });

  // Мета-прогресс и рекорды игрока в Game Factory SDK
  interface MetaProgress {
    highScore: number;
    totalRuns: number;
    victories: number;
    highestFloor: number;
    totalElites: number;
  }

  const savedMeta = await session.load<MetaProgress>('meta_progress').catch(() => null);
  const meta: MetaProgress = savedMeta ?? {
    highScore: 0,
    totalRuns: 0,
    victories: 0,
    highestFloor: 1,
    totalElites: 0,
  };

  const initialBest = await session.bestScore().catch(() => null);
  if (initialBest && initialBest > meta.highScore) {
    meta.highScore = initialBest;
  }

  // Снимок состояния текущего активного забега
  interface SavedRunProgress {
    floor: number;
    hp: number;
    greyHp: number;
    threadsOfFate: number;
    score: number;
    injuriesCount: number;
    elitesDefeated: number;
    lightSupply: number;
    aetherHeat: number;
    fatigue: number;
    inventoryItems: InventoryItem[];
    quickSlots: (string | null)[];
  }

  // 1. Инициализация состояния
  const player = createPlayer();
  const inventory = createInventory(5, 4);

  // Стартовые предметы боевого мага
  const starterStaff: InventoryItem = {
    id: 'starter_staff',
    name: 'Боевой посох',
    category: 'weapon',
    rarity: 'common',
    element: 'physical',
    shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    weight: 2.5,
    rotation: 0,
    damage: 18,
  };
  const fireStone: InventoryItem = {
    id: 'fire_stone_starter',
    name: 'Огненный камень',
    category: 'rune',
    rarity: 'rare',
    element: 'fire',
    shape: [{ x: 0, y: 0 }],
    weight: 1.0,
    rotation: 0,
  };
  const bandage: InventoryItem = {
    id: 'bandage_starter',
    name: 'Чистый бинт',
    category: 'potion',
    rarity: 'common',
    element: 'physical',
    shape: [{ x: 0, y: 0 }],
    weight: 0.3,
    rotation: 0,
    healAmount: 30,
  };

  function setupDefaultStarterItems(): void {
    inventory.items.clear();
    for (const slot of inventory.slots) {
      slot.itemId = null;
    }
    inventory.quickSlots = [null, null, null, null];
    placeItem(inventory, { ...starterStaff }, 0, 0);
    placeItem(inventory, { ...fireStone }, 1, 1);
    placeItem(inventory, { ...bandage }, 3, 0);
  }

  // Проверка сохранённого активного забега в SDK
  const savedRun = await session.load<SavedRunProgress>('run_progress').catch(() => null);
  let isRunRestored = false;

  if (savedRun && savedRun.floor && savedRun.floor >= 1) {
    player.currentFloor = savedRun.floor;
    player.hp = savedRun.hp ?? 100;
    player.greyHp = savedRun.greyHp ?? 0;
    player.threadsOfFate = savedRun.threadsOfFate ?? 2;
    player.score = savedRun.score ?? 0;
    player.injuriesCount = savedRun.injuriesCount ?? 0;
    player.elitesDefeated = savedRun.elitesDefeated ?? 0;
    player.lightSupply = savedRun.lightSupply ?? 100;
    player.aetherHeat = savedRun.aetherHeat ?? 0;
    player.fatigue = savedRun.fatigue ?? 0;

    if (savedRun.inventoryItems && savedRun.inventoryItems.length > 0) {
      for (const item of savedRun.inventoryItems) {
        if (item.gridX !== undefined && item.gridY !== undefined) {
          placeItem(inventory, item, item.gridX, item.gridY);
        }
      }
    } else {
      setupDefaultStarterItems();
    }

    if (savedRun.quickSlots) {
      for (let i = 0; i < 4; i++) {
        inventory.quickSlots[i] = savedRun.quickSlots[i] ?? null;
      }
    }
    isRunRestored = true;
  } else {
    setupDefaultStarterItems();
  }

  let floor = generateFloor(player.currentFloor);

  async function saveCurrentRun(): Promise<void> {
    if (player.isDead) {
      await session.save('run_progress', null).catch(() => {});
      await session.save('progress', null).catch(() => {});
      return;
    }
    const runData: SavedRunProgress = {
      floor: player.currentFloor,
      hp: player.hp,
      greyHp: player.greyHp,
      threadsOfFate: player.threadsOfFate,
      score: player.score,
      injuriesCount: player.injuriesCount,
      elitesDefeated: player.elitesDefeated,
      lightSupply: player.lightSupply,
      aetherHeat: player.aetherHeat,
      fatigue: player.fatigue,
      inventoryItems: Array.from(inventory.items.values()),
      quickSlots: [...inventory.quickSlots],
    };
    await session.save('run_progress', runData).catch(() => {});
    await session.save('progress', {
      floor: player.currentFloor,
      score: player.score,
      hp: player.hp,
      threads: player.threadsOfFate,
    }).catch(() => {});
  }

  // 2. Инициализация Three.js
  const canvas = document.getElementById('app-canvas') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#080b10');
  scene.fog = new THREE.FogExp2('#080b10', 0.038);

  const ambientLight = new THREE.AmbientLight('#1a2634', 0.6);
  scene.add(ambientLight);

  const materials = createCryptMaterials();
  let world = buildCryptWorld(scene, floor);

  // 3. Создание персонажа и врагов
  const playerChar = createPlayerCharacter(materials);
  scene.add(playerChar.mesh);
  playerChar.mesh.position.set(0, 0, 0);

  const enemies: EnemySylvan3D[] = [
    createSylvanEnemy(`sylvan_f${floor.floorNumber}_1`, 34, -6, materials),
    createSylvanEnemy(`sylvan_f${floor.floorNumber}_2`, 36, -8, materials),
  ];
  for (const enemy of enemies) {
    scene.add(enemy.mesh);
  }

  // 4. Настройка камеры от 3-го лица over-the-shoulder
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 150);
  let cameraYaw = 0;
  let cameraPitch = 0.15;

  // 5. Инициализация UI-слоя и боевого 3D-текста
  const hud = createHud();
  const invView = createInventoryView(inventory);
  const encountersUI = createEncountersUI();
  const combatText = createCombatTextManager();

  updateHud(hud, player, floor);
  drawMinimap(hud.minimapCanvas, floor);
  if (isRunRestored) {
    encountersUI.showNotification(`📜 Загружен сохранённый забег: Этаж ${player.currentFloor}!`);
  }

  function clearWorld(): void {
    scene.remove(world.group);
    combatText.clear();
    for (const enemy of enemies) {
      scene.remove(enemy.mesh);
    }
    enemies.length = 0;
  }

  function buildWorldForFloor(): void {
    world = buildCryptWorld(scene, floor);
    enemies.push(
      createSylvanEnemy(`sylvan_f${floor.floorNumber}_1`, 34, -6, materials),
      createSylvanEnemy(`sylvan_f${floor.floorNumber}_2`, 36, -8, materials),
    );
    for (const enemy of enemies) {
      scene.add(enemy.mesh);
    }
  }

  async function triggerDeath(): Promise<void> {
    isTacticalPause = true;
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
    document.exitPointerLock();

    const totalScore = calculateScore(player);
    let isNewRecord = false;
    try {
      const scoreRes = await session.submitScore(totalScore);
      if (scoreRes && scoreRes.isBest) isNewRecord = true;
    } catch {
      // safe fallback for standalone
    }

    meta.totalRuns += 1;
    meta.totalElites += player.elitesDefeated;
    if (totalScore > meta.highScore) {
      meta.highScore = totalScore;
      isNewRecord = true;
    }
    await session.save('meta_progress', meta).catch(() => {});
    // При окончательной смерти сохранённый забег стирается
    await session.save('run_progress', null).catch(() => {});
    await session.save('progress', null).catch(() => {});

    const breakdown: ScoreBreakdown = {
      floor: player.currentFloor,
      floorPoints: player.currentFloor * 100,
      elites: player.elitesDefeated,
      elitesPoints: player.elitesDefeated * 25,
      threads: player.threadsOfFate,
      threadsPoints: player.threadsOfFate * 50,
      injuries: player.injuriesCount,
      injuriesPenalty: player.injuriesCount * 5,
      discoveryPoints: player.score,
      totalScore,
      isNewRecord,
      bestScore: meta.highScore,
    };

    encountersUI.showDeathModal(breakdown, () => {
      restartGame();
    });
  }

  async function triggerVictory(): Promise<void> {
    isTacticalPause = true;
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
    document.exitPointerLock();

    const totalScore = calculateScore(player);
    let isNewRecord = false;
    try {
      const scoreRes = await session.submitScore(totalScore);
      if (scoreRes && scoreRes.isBest) isNewRecord = true;
    } catch {
      // safe fallback for standalone
    }

    meta.victories += 1;
    meta.totalElites += player.elitesDefeated;
    meta.highestFloor = Math.max(meta.highestFloor, player.currentFloor + 1);
    if (totalScore > meta.highScore) {
      meta.highScore = totalScore;
      isNewRecord = true;
    }
    await session.save('meta_progress', meta).catch(() => {});

    const breakdown: ScoreBreakdown = {
      floor: player.currentFloor,
      floorPoints: player.currentFloor * 100,
      elites: player.elitesDefeated,
      elitesPoints: player.elitesDefeated * 25,
      threads: player.threadsOfFate,
      threadsPoints: player.threadsOfFate * 50,
      injuries: player.injuriesCount,
      injuriesPenalty: player.injuriesCount * 5,
      discoveryPoints: player.score,
      totalScore,
      isNewRecord,
      bestScore: meta.highScore,
    };

    encountersUI.showVictoryModal(
      breakdown,
      () => {
        advanceToNextFloor();
      },
      () => {
        restartGame();
      },
    );
  }

  function restartGame(): void {
    clearWorld();
    player.currentFloor = 1;
    player.hp = player.maxHp = 100;
    player.greyHp = 0;
    player.aetherHeat = 0;
    player.fatigue = 0;
    player.temporaryMana = 0;
    player.threadsOfFate = 2;
    player.lightSupply = 100;
    player.score = 0;
    player.injuriesCount = 0;
    player.elitesDefeated = 0;
    player.isDead = false;

    setupDefaultStarterItems();
    invView.render();

    floor = generateFloor(1);
    buildWorldForFloor();

    playerChar.mesh.position.set(0, 0, 0);
    cameraYaw = 0;
    cameraPitch = 0.15;

    // Сброс сохранения забега для нового прохождения
    void session.save('run_progress', null).catch(() => {});
    void session.save('progress', null).catch(() => {});

    updateHud(hud, player, floor);
    drawMinimap(hud.minimapCanvas, floor);
    isTacticalPause = false;
    canvas.requestPointerLock();
    encountersUI.showNotification('✨ Новое перерождение мага в Затопленных Криптах!');
  }

  async function advanceToNextFloor(): Promise<void> {
    clearWorld();
    player.currentFloor += 1;
    player.lightSupply = 100;
    player.fatigue = 0;
    player.aetherHeat = 0;

    meta.highestFloor = Math.max(meta.highestFloor, player.currentFloor);
    await session.save('meta_progress', meta).catch(() => {});

    floor = generateFloor(player.currentFloor);
    buildWorldForFloor();

    playerChar.mesh.position.set(0, 0, 0);
    cameraYaw = 0;
    cameraPitch = 0.15;

    // Автосохранение забега на новом этаже
    await saveCurrentRun();

    updateHud(hud, player, floor);
    drawMinimap(hud.minimapCanvas, floor);
    isTacticalPause = false;
    canvas.requestPointerLock();
    encountersUI.showNotification(`🌀 Спуск на Этаж ${player.currentFloor}: древняя магия сгущается!`);
  }

  let lastQuickSlotTime = 0;

  function activateQuickSlot(slotNum: number): void {
    const now = performance.now();
    if (now - lastQuickSlotTime < 320) return;
    lastQuickSlotTime = now;

    const slotEl = hud.quickSlotElements[slotNum - 1];
    if (slotEl) {
      slotEl.classList.add('active');
      setTimeout(() => slotEl.classList.remove('active'), 220);
    }

    if (slotNum === 1) {
      // Посох: боевой замах и охлаждение тепла
      playerChar.triggerAttack();
      const coolRes = performPhysicalAttack(player, 4);
      updateHud(hud, player, floor);

      // Проверка попадания по Сильванам перед персонажем
      const playerPos = playerChar.mesh.position;
      const forward = new THREE.Vector3(
        Math.sin(playerChar.mesh.rotation.y),
        0,
        Math.cos(playerChar.mesh.rotation.y),
      );

      for (const enemy of enemies) {
        if (!enemy.isAlive) continue;
        const toEnemy = new THREE.Vector3().subVectors(enemy.mesh.position, playerPos);
        const dist = toEnemy.length();
        if (dist < 3.2) {
          toEnemy.normalize();
          const dot = forward.dot(toEnemy);
          if (dot > 0.35) {
            const stats = calculateInventoryStats(inventory);
            const dmg = 18 + stats.bonusFireDamage + stats.bonusPoisonDamage;
            enemy.takeHit(dmg, toEnemy);

            const isFire = stats.bonusFireDamage > 0;
            combatText.spawn(
              enemy.mesh.position,
              isFire ? `🔥 -${dmg}` : `-${dmg}`,
              isFire ? 'crit' : 'damage_enemy',
            );

            encountersUI.showNotification(
              `💥 Удар посохом: -${dmg} HP (Охлаждение тепла -${coolRes.cooledHeat}%)`,
            );
            if (!enemy.isAlive) {
              player.elitesDefeated += 1;
              player.score += 25;
              updateHud(hud, player, floor);
              encountersUI.showNotification('💀 Сильван повержен! Получены трофеи.');
            }
          }
        }
      }
    } else if (slotNum === 2) {
      // Ветхий щит: стойка магического парирования
      const nextParry = !playerChar.isParrying;
      playerChar.setParry(nextParry);
      if (nextParry) {
        encountersUI.showNotification('🛡️ Поднята стойка парирования (поглощение и отражение магии)');
      } else {
        encountersUI.showNotification('🛡️ Стойка парирования опущена');
      }
    } else if (slotNum === 3) {
      // Бинт: исцеление плоти на ходу
      if (player.hp < player.maxHp - player.greyHp) {
        const healed = applyHealing(player, 30);
        updateHud(hud, player, floor);
        combatText.spawn(playerChar.mesh.position, `+${healed} HP`, 'heal');
        encountersUI.showNotification(`🩹 Наложена повязка: +${healed} HP`);
      } else {
        encountersUI.showNotification('⚠️ Здоровье полно (или ограничено серой травмой)');
      }
    } else if (slotNum === 4) {
      // Свиток: истинное видение залов и свет
      playerChar.triggerCast();
      player.lightSupply = Math.min(100, player.lightSupply + 35);
      combatText.spawn(playerChar.mesh.position, '💡 +35% СВЕТ', 'vent');

      // Раскрытие смежных комнат на миникарте
      for (const [rAId, rBId] of floor.connections) {
        if (rAId === floor.activeRoomId) {
          const neighbor = floor.rooms.find((r) => r.id === rBId);
          if (neighbor) neighbor.isRevealed = true;
        } else if (rBId === floor.activeRoomId) {
          const neighbor = floor.rooms.find((r) => r.id === rAId);
          if (neighbor) neighbor.isRevealed = true;
        }
      }

      updateHud(hud, player, floor);
      drawMinimap(hud.minimapCanvas, floor);
      encountersUI.showNotification('📜 Свиток истинного видения: свет пополнен (+35%), залы открыты!');
    }
  }

  // Привязка клика мыши по быстрым слотам
  hud.quickSlotElements.forEach((el, index) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      activateQuickSlot(index + 1);
    });
  });

  // 6. Управление: WASD + мышь (PointerLock)
  let isTacticalPause = false;
  const keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    shift: false,
  };

  // Сброс клавиш при потере фокуса окна (защита от залипания)
  window.addEventListener('blur', () => {
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
  });

  window.addEventListener('keydown', (e) => {
    // Закрытие открытого инвентаря или окна Разлома по Escape
    if (e.code === 'Escape') {
      if (invView.isOpen) {
        e.preventDefault();
        invView.close();
        playerChar.setBrowsing(false);
        canvas.requestPointerLock();
        return;
      }
      const overlay = document.getElementById('encounter-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        const riftCard = overlay.querySelector('.rift-card');
        if (riftCard) {
          e.preventDefault();
          overlay.classList.add('hidden');
          isTacticalPause = false;
          canvas.requestPointerLock();
          return;
        }
      }
    }

    if (isTacticalPause) return;

    // Открытие/закрытие инвентаря на TAB или I (персонаж достаёт карту, бег на WASD не блокируется!)
    if (e.code === 'Tab' || e.code === 'KeyI') {
      e.preventDefault();
      invView.toggle();
      playerChar.setBrowsing(invView.isOpen);
      if (invView.isOpen) {
        document.exitPointerLock();
        setTimeout(() => {
          if (document.pointerLockElement) {
            document.exitPointerLock();
          }
        }, 20);
      } else {
        canvas.requestPointerLock();
      }
      return;
    }

    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.forward = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.backward = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;

    // Быстрые слоты пояса (клавиши 1..4) с защитой от спама при зажатии
    if (
      e.code === 'Digit1' ||
      e.code === 'Numpad1' ||
      e.code === 'Digit2' ||
      e.code === 'Numpad2' ||
      e.code === 'Digit3' ||
      e.code === 'Numpad3' ||
      e.code === 'Digit4' ||
      e.code === 'Numpad4'
    ) {
      if (e.repeat) return; // Игнорируем автоповтор ОС
      if (e.code === 'Digit1' || e.code === 'Numpad1') activateQuickSlot(1);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') activateQuickSlot(2);
      else if (e.code === 'Digit3' || e.code === 'Numpad3') activateQuickSlot(3);
      else if (e.code === 'Digit4' || e.code === 'Numpad4') activateQuickSlot(4);
    }

    // Сброс тепла клавишей [V] (ценой ожога плоти в серое HP)
    if (e.code === 'KeyV') {
      if (player.aetherHeat > 15) {
        const vent = forceVentHeat(player);
        updateHud(hud, player, floor);
        combatText.spawn(playerChar.mesh.position, `⚡ -${vent.heatVented}%`, 'vent');
        combatText.spawn(playerChar.mesh.position, `-${vent.healthBurned}`, 'damage_player');
        encountersUI.showNotification(`⚠️ Сброс тепла (-${vent.heatVented}%): ожог каналов (-${vent.healthBurned} HP)`);
      }
    }

    // Каст боевого заклинания на клавишу [Q]
    if (e.code === 'KeyQ') {
      triggerMagicCast();
    }

    // Взаимодействие [E]: Споровый Мимик / Эфирный Разлом / Портал
    if (e.code === 'KeyE') {
      triggerNearbyInteraction();
    }
  });

  function triggerMagicCast(): void {
    const castRes = castMagic(player, 25);
    if (castRes.success) {
      playerChar.triggerCast();
      updateHud(hud, player, floor);

      // Поиск врага в зоне действия магии (до 7.5 метров)
      for (const enemy of enemies) {
        if (!enemy.isAlive) continue;
        const dist = playerChar.mesh.position.distanceTo(enemy.mesh.position);
        if (dist <= 7.5) {
          const spellDmg = castRes.inRedline ? 38 : 25;
          const push = new THREE.Vector3().subVectors(enemy.mesh.position, playerChar.mesh.position).normalize();
          enemy.takeHit(spellDmg, push);
          combatText.spawn(
            enemy.mesh.position,
            castRes.inRedline ? `💥 КРИТ! -${spellDmg}` : `⚡ -${spellDmg}`,
            castRes.inRedline ? 'crit' : 'damage_enemy',
          );
          if (!enemy.isAlive) {
            player.elitesDefeated += 1;
            player.score += 25;
            updateHud(hud, player, floor);
            encountersUI.showNotification('💀 Сильван испепелён эфирной магией!');
          }
          break;
        }
      }

      if (castRes.inRedline) {
        encountersUI.showNotification('🔥 КРАСНАЯ ЗОНА: Заклинания усилены на +50%!');
      }
    }
  }

  function triggerNearbyInteraction(): void {
    for (const mimic of world.mimics) {
      if (mimic.triggerQteAvailable) {
        const dist = playerChar.mesh.position.distanceTo(mimic.worldPosition);
        if (dist <= 3.2) {
          triggerMimicEncounter(mimic);
          return;
        }
      }
    }

    // Взаимодействие с Древним Порталом (Завершение этажа / Победа)
    for (const p of world.portals) {
      const distToPortal = playerChar.mesh.position.distanceTo(p.worldPosition);
      if (distToPortal <= 4.2) {
        triggerVictory();
        return;
      }
    }

    const activeRoom = floor.rooms.find((r) => r.id === floor.activeRoomId);
    if (activeRoom && activeRoom.hasAetherRift) {
      let isNearRift = false;
      for (const rift of world.aetherRifts) {
        const riftWorldPos = new THREE.Vector3();
        rift.getWorldPosition(riftWorldPos);
        if (
          Math.hypot(
            playerChar.mesh.position.x - riftWorldPos.x,
            playerChar.mesh.position.z - riftWorldPos.z,
          ) <= 4.8
        ) {
          isNearRift = true;
          break;
        }
      }
      if (!isNearRift) return;

      isTacticalPause = true;
      keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
      document.exitPointerLock();
      setTimeout(() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }, 20);

      encountersUI.showAetherRiftModal(
        async () => {
          // Отдых у Разлома
          isTacticalPause = false;
          canvas.requestPointerLock();
          player.greyHp = 0;
          player.hp = player.maxHp;
          player.aetherHeat = 0;
          player.fatigue = 0;
          player.lightSupply = 100;
          await saveCurrentRun();
          updateHud(hud, player, floor);
          combatText.spawn(playerChar.mesh.position, '✨ ОТДЫХ: HP ПОЛНО!', 'heal');
          encountersUI.showNotification('✨ Силы восстановлены и сохранены в Разломе!');
        },
        async () => {
          // Сохранение через SDK
          isTacticalPause = false;
          canvas.requestPointerLock();
          await saveCurrentRun();
          encountersUI.showNotification('💾 Прогресс забега сохранён в кристалле Разлома!');
        },
        () => {
          // Выход из диалога Разлома
          isTacticalPause = false;
          canvas.requestPointerLock();
        },
      );
    }
  }

  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.forward = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.backward = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
  });

  // Захват курсора мыши и боевые удары
  canvas.addEventListener('mousedown', (e) => {
    if (invView.isOpen || isTacticalPause) return;

    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
      return;
    }

    // ЛКМ: Физический удар посохом (быстрый слот 1)
    if (e.button === 0) {
      activateQuickSlot(1);
    }

    // ПКМ: Парирование (лазурный барьер / быстрый слот 2)
    if (e.button === 2) {
      playerChar.setParry(true);
      const slotEl = hud.quickSlotElements[1];
      if (slotEl) slotEl.classList.add('active');
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      playerChar.setParry(false);
      const slotEl = hud.quickSlotElements[1];
      if (slotEl) slotEl.classList.remove('active');
    }
  });

  window.addEventListener('contextmenu', (e) => {
    if (!invView.isOpen) {
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      cameraYaw -= e.movementX * 0.0025;
      cameraPitch = Math.max(-0.45, Math.min(0.65, cameraPitch + e.movementY * 0.0025));
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  // Автоматический сброс PointerLock при открытых окнах (защита для Wayland/Chromium)
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement && (invView.isOpen || isTacticalPause)) {
      document.exitPointerLock();
    }
  });

  // Экранное сенсорное управление (джойстик + кнопки) для смартфонов и планшетов
  if (isMobileOrTouch()) {
    document.body.classList.add('touch-enabled');
    createTouchControls({
      onMove: (dx, dy, isSprint) => {
        keys.forward = dy < -0.22;
        keys.backward = dy > 0.22;
        keys.left = dx < -0.22;
        keys.right = dx > 0.22;
        keys.shift = isSprint;
      },
      onLook: (deltaYaw, deltaPitch) => {
        cameraYaw -= deltaYaw;
        cameraPitch = Math.max(-0.45, Math.min(0.65, cameraPitch + deltaPitch));
      },
      onAttack: () => activateQuickSlot(1),
      onParry: (active) => {
        playerChar.setParry(active);
        const slotEl = hud.quickSlotElements[1];
        if (slotEl) slotEl.classList.toggle('active', active);
      },
      onMagic: () => triggerMagicCast(),
      onInteract: () => triggerNearbyInteraction(),
      onInventory: () => {
        invView.toggle();
        playerChar.setBrowsing(invView.isOpen);
        if (invView.isOpen) document.exitPointerLock();
      },
      onHeal: () => activateQuickSlot(3),
    });
  }

  // Вспомогательная функция размещения предмета в рюкзаке
  function tryAddItem(item: InventoryItem): boolean {
    for (let y = 0; y < inventory.height; y++) {
      for (let x = 0; x < inventory.width; x++) {
        if (canPlaceItem(inventory, item, x, y)) {
          placeItem(inventory, item, x, y);
          invView.render();
          return true;
        }
      }
    }
    return false;
  }

  // Запуск тактической стелс-паузы и сценарного выбора
  function triggerStealthScenario(enemy: EnemySylvan3D, weightClass: WeightClass): void {
    isTacticalPause = true;
    document.exitPointerLock();

    const isLight = weightClass === 'light';
    const assassinateChance = isLight ? 0.88 : 0.72;
    const harvestChance = isLight ? 0.95 : 0.85;

    const choices: StealthChoice[] = [
      {
        text: `🗡️ Скрытный раскол в сочленение ветвей (${Math.round(assassinateChance * 100)}% шанс)`,
        risk: isLight ? 'low' : 'medium',
        reward: '+50 очков и Руна древнего мха',
        action: () => {
          isTacticalPause = false;
          canvas.requestPointerLock();

          if (Math.random() <= assassinateChance) {
            player.score += 50;
            const pushDir = new THREE.Vector3()
              .subVectors(enemy.mesh.position, playerChar.mesh.position)
              .normalize();
            enemy.takeHit(999, pushDir);
            combatText.spawn(enemy.mesh.position, '💥 КРИТИЧЕСКИЙ УДАР! 999', 'crit');
            player.elitesDefeated += 1;

            const mossRune: InventoryItem = {
              id: `moss_rune_${Date.now()}`,
              name: 'Руна Древнего Мха',
              category: 'rune',
              rarity: 'rare',
              element: 'poison',
              shape: [{ x: 0, y: 0 }],
              weight: 0.5,
              rotation: 0,
            };
            const added = tryAddItem(mossRune);
            updateHud(hud, player, floor);

            encountersUI.showNotification(
              added
                ? '🗡️ БЕСШУМНОЕ УСТРАНЕНИЕ: Страж сражён! (+50 очков, Руна мха получена в рюкзак)'
                : '🗡️ БЕСШУМНОЕ УСТРАНЕНИЕ: Страж сражён! (+50 очков, рюкзак полон — руна оставлена)',
            );
          } else {
            const dmgRes = applyDamage(player, 12);
            triggerDamageFlash(hud);
            updateHud(hud, player, floor);
            combatText.spawn(playerChar.mesh.position, `-${dmgRes.actualDamage}`, 'damage_player');

            if (player.isDead) {
              triggerDeath();
              return;
            }

            const pushDir = new THREE.Vector3()
              .subVectors(enemy.mesh.position, playerChar.mesh.position)
              .normalize();
            enemy.takeHit(5, pushDir);

            encountersUI.showNotification(
              `⚠️ ПРОВАЛ СКРЫТНОСТИ: Страж парировал удар когтями (-${dmgRes.actualDamage} HP)!`,
            );
          }
        },
      },
      {
        text: `🌿 Срезать люминесцентный лишайник (${Math.round(harvestChance * 100)}% шанс)`,
        risk: 'low',
        reward: '+35 очков и сохранение скрытности',
        action: () => {
          isTacticalPause = false;
          canvas.requestPointerLock();

          if (Math.random() <= harvestChance) {
            player.score += 35;
            updateHud(hud, player, floor);
            encountersUI.showNotification('🌿 ЛИШАЙНИК СОБРАН: Ценный мох срезан без шума (+35 очков)!');
          } else {
            const pushDir = new THREE.Vector3()
              .subVectors(enemy.mesh.position, playerChar.mesh.position)
              .normalize();
            enemy.takeHit(0, pushDir);
            encountersUI.showNotification('⚠️ ТРЕВОГА: Хруст коры выдал ваше присутствие!');
          }
        },
      },
      {
        text: '🪨 Бросить звуковой камень в угол зала (100% успех)',
        risk: 'low',
        reward: 'Отвлечение стража на 6 метров',
        action: () => {
          isTacticalPause = false;
          canvas.requestPointerLock();

          const forward = new THREE.Vector3();
          enemy.mesh.getWorldDirection(forward);
          const distractOffset = forward.clone().multiplyScalar(6.0);
          enemy.distract(distractOffset);

          player.score += 15;
          updateHud(hud, player, floor);
          encountersUI.showNotification('🪨 ОТВЛЕЧЕНИЕ: Страж пошёл на шум камня (+15 очков)!');
        },
      },
    ];

    encountersUI.showStealthModal('Вы бесшумно подкрались за спину Древесного Стража Сильвана', choices);
  }

  // Запуск QTE-взлома Спорового Мимика
  function triggerMimicEncounter(mimic: SporeMimic3D): void {
    if (!mimic.triggerQteAvailable || isTacticalPause) return;

    isTacticalPause = true;
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
    document.exitPointerLock();

    encountersUI.showMimicQte(
      () => {
        // Успех взлома
        isTacticalPause = false;
        canvas.requestPointerLock();
        mimic.openChest();

        player.score += 75;
        const relicScroll: InventoryItem = {
          id: `relic_scroll_${Date.now()}`,
          name: 'Свиток Чумного Пламени',
          category: 'scroll',
          rarity: 'rare',
          element: 'fire',
          shape: [
            { x: 0, y: 0 },
            { x: 0, y: 1 },
          ],
          weight: 1.2,
          rotation: 0,
          damage: 35,
          heatCost: 30,
        };
        const added = tryAddItem(relicScroll);
        updateHud(hud, player, floor);

        encountersUI.showNotification(
          added
            ? '✨ РЕЛИКВАРИЙ ВСКРЫТ: Свиток Чумного Пламени получен в ранец (+75 очков)!'
            : '✨ РЕЛИКВАРИЙ ВСКРЫТ: Споры уснули! Ранец полон (+75 очков)',
        );
      },
      () => {
        // Провал: пробуждение и яростный укус мимика
        isTacticalPause = false;
        canvas.requestPointerLock();
        mimic.awakenMimic();

        const dmgRes = applyDamage(player, 22);
        player.fatigue = Math.min(100, player.fatigue + 35); // Споровый шок
        triggerDamageFlash(hud);
        updateHud(hud, player, floor);
        combatText.spawn(playerChar.mesh.position, `-${dmgRes.actualDamage}`, 'damage_player');

        if (dmgRes.survivedByFate) {
          triggerFateFlash(hud);
          encountersUI.showNotification('✨ НИТЬ СУДЬБЫ: Челюсти мимика сокрушены эфирным импульсом!');
        } else if (player.isDead) {
          triggerDeath();
          return;
        } else {
          encountersUI.showNotification(
            `💥 ЛОВУШКА МИМИКА: Зубы сомкнулись на руках (-${dmgRes.actualDamage} HP, шок усталости +35%)!`,
          );
        }
      },
    );
  }

  // 7. Игровой цикл (requestAnimationFrame)
  let lastTime = performance.now();
  const tempMoveDir = new THREE.Vector3();

  function animate(now: number) {
    requestAnimationFrame(animate);

    if (isTacticalPause) {
      renderer.render(scene, camera);
      return;
    }

    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Вектор перемещения (A — влево на экране (+X в Three.js при Z-forward), D — вправо (-X))
    tempMoveDir.set(0, 0, 0);
    if (keys.forward) tempMoveDir.z += 1;
    if (keys.backward) tempMoveDir.z -= 1;
    if (keys.left) tempMoveDir.x += 1;
    if (keys.right) tempMoveDir.x -= 1;

    const isMoving = tempMoveDir.lengthSq() > 0;
    const invStats = calculateInventoryStats(inventory);

    // Модуляция скорости весом рюкзака
    let baseSpeed = 4.4;
    let sprintSpeed = 7.2;
    if (invStats.weightClass === 'heavy') {
      baseSpeed = 3.5;
      sprintSpeed = 5.2;
    } else if (invStats.weightClass === 'medium') {
      baseSpeed = 4.0;
      sprintSpeed = 6.4;
    }

    if (isMoving) {
      tempMoveDir.normalize();

      // Направление движения относительно угла камеры
      const moveAngle = Math.atan2(tempMoveDir.x, tempMoveDir.z) + cameraYaw;
      const speed = keys.shift && player.fatigue < 80 ? sprintSpeed : baseSpeed;

      playerChar.mesh.position.x += Math.sin(moveAngle) * speed * delta;
      playerChar.mesh.position.z += Math.cos(moveAngle) * speed * delta;

      // Плавная интерполяция поворота мага
      const currentRot = playerChar.mesh.rotation.y;
      const angleDiff = Math.atan2(Math.sin(moveAngle - currentRot), Math.cos(moveAngle - currentRot));
      playerChar.mesh.rotation.y += angleDiff * Math.min(1, delta * 12);
    }

    // Регенерация и расход усталости
    if (keys.shift && isMoving && player.fatigue < 80) {
      player.fatigue = Math.min(100, player.fatigue + delta * 3.5);
      updateHud(hud, player, floor);
    } else {
      if (player.fatigue > 0) {
        player.fatigue = Math.max(0, player.fatigue - delta * (isMoving ? 1.5 : 4.5));
        updateHud(hud, player, floor);
      }
    }

    playerChar.update(delta, isMoving);

    // Позиционирование камеры Over-The-Shoulder (камера за правым плечом, герой чуть левее центра)
    const camDistance = 3.6;
    const camHeight = 2.1 + Math.sin(cameraPitch) * 1.5;
    const camRightOffset = 0.9;

    const camX =
      playerChar.mesh.position.x -
      Math.sin(cameraYaw) * camDistance -
      Math.cos(cameraYaw) * camRightOffset;
    const camZ =
      playerChar.mesh.position.z -
      Math.cos(cameraYaw) * camDistance +
      Math.sin(cameraYaw) * camRightOffset;

    camera.position.set(camX, camHeight, camZ);

    const lookTargetY = 1.6 - Math.tan(cameraPitch) * 4.5;
    camera.lookAt(
      playerChar.mesh.position.x + Math.sin(cameraYaw) * 6,
      lookTargetY,
      playerChar.mesh.position.z + Math.cos(cameraYaw) * 6,
    );

    // Проверка текущей комнаты игрока и расход света по прогрессу
    for (const room of floor.rooms) {
      const halfW = room.width / 2;
      const halfH = room.height / 2;
      const inRoom =
        Math.abs(playerChar.mesh.position.x - room.x) <= halfW &&
        Math.abs(playerChar.mesh.position.z - room.y) <= halfH;

      if (inRoom) {
        if (floor.activeRoomId !== room.id) {
          const res = enterRoom(floor, room.id, player);
          updateHud(hud, player, floor);
          drawMinimap(hud.minimapCanvas, floor);

          if (res.newlyRevealed) {
            encountersUI.showNotification(`🏛️ Открыт новый зал: ${room.type.toUpperCase()}`);
            const light = world.roomLights.get(room.id);
            if (light) light.intensity = 1.8;
          }
        }

        break;
      }
    }

    // Проверка подсказок у дверей неисследованных смежных залов (Eavesdropping)
    let nearbyCue: string | null = null;
    const activeRoom = floor.rooms.find((r) => r.id === floor.activeRoomId);
    if (activeRoom) {
      for (const [rAId, rBId] of floor.connections) {
        let neighborId: string | null = null;
        if (rAId === activeRoom.id) neighborId = rBId;
        else if (rBId === activeRoom.id) neighborId = rAId;

        if (!neighborId) continue;
        const neighbor = floor.rooms.find((r) => r.id === neighborId);
        if (neighbor && !neighbor.isVisited && neighbor.cue) {
          const doorX = (activeRoom.x + neighbor.x) / 2;
          const doorZ = (activeRoom.y + neighbor.y) / 2;
          const distToDoor = Math.hypot(
            playerChar.mesh.position.x - doorX,
            playerChar.mesh.position.z - doorZ,
          );
          if (distToDoor < 6.5) {
            nearbyCue = neighbor.cue.message;
            break;
          }
        }
      }
    }

    // Проверка близости к Споровому Мимику
    for (const mimic of world.mimics) {
      if (mimic.triggerQteAvailable) {
        const dist = playerChar.mesh.position.distanceTo(mimic.worldPosition);
        if (dist <= 3.2) {
          nearbyCue = '📦 [E] — Осторожно взломать споровый реликварий';
          if (dist <= 1.4 && !isTacticalPause && !invView.isOpen) {
            triggerMimicEncounter(mimic);
          }
          break;
        }
      }
    }

    // Проверка близости к Эфирному Разлому
    if (!nearbyCue && activeRoom && activeRoom.hasAetherRift) {
      for (const rift of world.aetherRifts) {
        const riftWorldPos = new THREE.Vector3();
        rift.getWorldPosition(riftWorldPos);
        const distToRift = Math.hypot(
          playerChar.mesh.position.x - riftWorldPos.x,
          playerChar.mesh.position.z - riftWorldPos.z,
        );
        if (distToRift <= 4.8) {
          nearbyCue = '⚡ [E] — Коснуться Эфирного Разлома (Отдых и Сохранение)';
          break;
        }
      }
    }

    // Проверка близости к Древнему Порталу (Завершение этажа / Победа)
    if (!nearbyCue) {
      for (const p of world.portals) {
        const distToPortal = playerChar.mesh.position.distanceTo(p.worldPosition);
        if (distToPortal <= 4.2) {
          nearbyCue = '🌀 [E] — Активировать Древний Портал (Завершить этаж)';
          break;
        }
      }
    }

    if (nearbyCue) {
      hud.cueBanner.classList.remove('hidden');
      hud.cueText.textContent = nearbyCue;
    } else {
      hud.cueBanner.classList.add('hidden');
    }

    // Радиус обнаружения зависит от веса поклажи (Тарков-механика шума)
    let detectionRadius = 9.0;
    if (invStats.weightClass === 'light') {
      detectionRadius = 6.5; // Скрытный тихий шаг
    } else if (invStats.weightClass === 'heavy') {
      detectionRadius = 14.0; // Звон доспехов привлекает врагов издалека
    }

    // Проверка сценарного стелса (подкрадывание со спины к патрульному Сильвану)
    if (!isTacticalPause && !invView.isOpen && invStats.weightClass !== 'heavy') {
      for (const enemy of enemies) {
        if (enemy.isAlive && enemy.stealthAvailable && enemy.aiState === 'patrol') {
          const toPlayer = new THREE.Vector3()
            .subVectors(playerChar.mesh.position, enemy.mesh.position);
          toPlayer.y = 0;
          const dist = toPlayer.length();

          if (dist <= 2.5) {
            toPlayer.normalize();
            const forward = new THREE.Vector3();
            enemy.mesh.getWorldDirection(forward);
            const dot = forward.dot(toPlayer);

            // Игрок находится со стороны спины Сильвана (dot < -0.15)
            if (dot < -0.15) {
              enemy.markStealthUsed();
              keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
              triggerStealthScenario(enemy, invStats.weightClass);
              break;
            }
          }
        }
      }
    }

    // Обновление врагов Сильванов и обработка входящего урона
    for (const enemy of enemies) {
      if (enemy.isAlive) {
        enemy.update(delta, playerChar.mesh.position, detectionRadius, (dmg, attacker) => {
          if (player.isDead) return;

          // Проверка стойки парирования
          if (playerChar.isParrying) {
            const parryRes = performParry(player, dmg, 'both');
            const toAttacker = new THREE.Vector3()
              .subVectors(attacker.mesh.position, playerChar.mesh.position)
              .normalize();
            attacker.takeHit(parryRes.reflectedDamage, toAttacker);
            updateHud(hud, player, floor);
            combatText.spawn(playerChar.mesh.position, `🛡️ ${parryRes.reflectedDamage}`, 'parry');
            combatText.spawn(attacker.mesh.position, `-${parryRes.reflectedDamage}`, 'damage_enemy');
            encountersUI.showNotification(
              `🛡️ ПАРИРОВАНИЕ! Отражено ${parryRes.reflectedDamage} урона, получено +${parryRes.manaGained} эссенции!`,
            );
          } else {
            // Пропущенный удар когтей Сильвана
            const dmgRes = applyDamage(player, dmg);
            triggerDamageFlash(hud);
            updateHud(hud, player, floor);
            combatText.spawn(playerChar.mesh.position, `-${dmgRes.actualDamage}`, 'damage_player');

            if (dmgRes.survivedByFate) {
              triggerFateFlash(hud);
              encountersUI.showNotification(
                '✨ НИТЬ СУДЬБЫ РАЗОРВАНА: Вы спасены от смертельного удара!',
              );
              // Импульс судьбы отбрасывает всех врагов
              for (const other of enemies) {
                if (other.isAlive) {
                  const push = new THREE.Vector3()
                    .subVectors(other.mesh.position, playerChar.mesh.position)
                    .normalize();
                  other.takeHit(12, push);
                }
              }
            } else if (player.isDead) {
              encountersUI.showNotification('💀 ВЫ ПОГИБЛИ: плоть мага разорвана когтями Сильванов.');
              triggerDeath();
            } else {
              encountersUI.showNotification(
                `🩸 Удар Сильвана: -${dmgRes.actualDamage} HP (глубокая серая травма: ${player.greyHp} HP)`,
              );
            }
          }
        });
      }
    }

    // Вращение кристаллов Разлома
    for (const rift of world.aetherRifts) {
      rift.rotation.y += delta * 1.5;
      rift.rotation.x += delta * 0.8;
    }

    // Вращение колец Древних Порталов
    for (const p of world.portals) {
      p.ring.rotation.z += delta * 1.5;
    }

    // Анимация Споровых Мимиков (шевеление усиков и дыхание крышки)
    for (const mimic of world.mimics) {
      mimic.update(delta);
    }

    // Мерцание пламени деревянных факелов в коридорах
    for (const torch of world.torchLights) {
      torch.light.intensity = torch.baseIntensity * (0.86 + 0.14 * Math.sin(now * 0.007 + torch.phase));
    }

    // Обновление всплывающих 3D-чисел урона и лечения в пространстве камеры
    combatText.update(camera, now);

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);

  (window as unknown as Record<string, unknown>).__ROGUE_DEBUG__ = {
    session,
    meta,
    player,
    playerChar,
    enemies,
    floor,
    inventory,
    hud,
    encountersUI,
    world,
    mimics: world.mimics,
    portals: world.portals,
    triggerStealthScenario,
    triggerMimicEncounter,
    triggerVictory,
    triggerDeath,
    advanceToNextFloor,
    restartGame,
  };

  session.ready();
}

void main();
