/**
 * Главная точка входа Rogue Destiny.
 * Шаг 4: Полный UI-слой, анимации взаимодействия персонажа с миром/мобами/рюкзаком/картой,
 * живые удары посохом (охлаждение тепла), парирование и каст магии.
 */
import * as THREE from 'three';
import {awardFate,weaveFate,fateReserves,fateScoutTargets,scoutWithFate,attemptWithFate} from './core/fate.ts';
import {enemySenses} from './core/perception.ts';
import {parseRunReceipt,legacyRunId,resultEntries} from './core/run-results.ts';
import { claimDefeat } from './core/rewards.ts';
import { createSaveWriter } from './core/save-writer.ts';
import { aimedTarget } from './core/targeting.ts';
import { createCombatEffects, type ImpactKind } from './render/impact.ts';
import { createCameraImpulse,kickCamera,tickCameraImpulse } from './core/impact.ts';
import { selectCombatTarget } from './core/enemies.ts';
import { chapterObjective } from './core/objective.ts';
import { fatigueModifiers } from './core/fatigue.ts';
import { meltdown, meltdownRoom, insideRoom } from './core/meltdown.ts';
import { createSteamState, coolIntoItem, coolIntoWater, tickSteamPoison, rekindleStarterCatalyst } from './core/cooling.ts';
import { createSteamCloud } from './render/steam.ts';
import { tickInventoryHazards, inventoryWarnings } from './core/inventory-hazards.ts';
import { CODEX, learnCodex, type CodexEntry } from './core/codex.ts';
import { createGameAudio } from './audio.ts';
import { GameFactory } from '@gf/game-sdk';
import './style.css';
import './interface.css';

import {
  createPlayer,
  damageAetherCore,
  performPhysicalAttack,
  castMagic,
  performParry,
  applyHealing,
  applyDamage,
  restAtAetherRift,
  forceVentHeat,
  calculateScore,
} from './core/player.ts';
import { createInventory, placeItem, autoPlaceItem, removeItem, calculateInventoryStats, getScrollMultiplier, infectInventory, cleanseInventory } from './core/inventory.ts';
import { STAFF_COOLDOWN_MS } from './core/balance.ts';
import { revealSecrets as revealSecretRooms } from './core/secrets.ts';
import { shrineRelic, libraryRelic, vaultRelic, oracleFocus, weaponPrice, damageFragileRelics } from './core/relics.ts';
import { createEffects, spellImpact, tickEffects, type EnemyEffects } from './core/effects.ts';
import { createOracleChallenge, tickOracle, strikeOracleNode, moveInNightmare, observeOracle, oracleStealthChance } from './core/oracle.ts';
import { createOracle } from './render/oracle.ts';
import { startHealing, advanceHealing, type Healing } from './core/healing.ts';
import { createCombat, tickCombat, beginDodge, setGuard, incomingHit, createStaffStrike, advanceStaffStrike, type StaffStrike } from './core/combat.ts';
import { beltItem } from './core/belt.ts';
import { parseSavedRun, parseMetaProgress, type SavedRunProgress } from './core/saves.ts';
import { isWalkable, moveOnFloor, moveEnemyOnFloor, hasLineOfSight } from './core/movement.ts';
import { generateFloor, enterRoom, canUnlockMetroidvania, refreshSoundGates } from './core/dungeon.ts';
import type { InventoryItem, WeightClass } from './core/types.ts';

import { createCryptMaterials } from './render/materials.ts';
import { buildCryptWorld, type SporeMimic3D } from './render/environment.ts';
import { createPlayerCharacter, createSylvanEnemy, type EnemySylvan3D } from './render/character.ts';
import { createCombatTextManager } from './render/combatText.ts';
import { createHud, updateHud, setHudBest, drawMinimap, triggerDamageFlash, triggerFateFlash } from './ui/hud.ts';
import { createInventoryView } from './ui/inventoryView.ts';
import { createEncountersUI, type StealthChoice, type ScoreBreakdown } from './ui/encounters.ts';
import { createTouchControls, prefersTouch } from './ui/touchControls.ts';

async function main(): Promise<void> {
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });
  const saveWriter=createSaveWriter((key,value)=>session.save(key,value));
  const audio = createGameAudio();
  const settings = await session.load<{ muted?: unknown }>('settings').catch(() => null);
  if (settings && typeof settings === 'object') audio.setMuted(settings.muted === true);

  const meta = parseMetaProgress(await session.load<unknown>('meta_progress').catch(() => null));

  const initialRawSavedRun=await session.load<unknown>('run_progress').catch(()=>null);
  const initialRun=parseSavedRun(initialRawSavedRun);
  const initialRunId=initialRun?(initialRun.runId??legacyRunId(initialRun)):null;
  let discardCompletedRun=!!initialRunId&&!!meta.completedRunIds?.includes(initialRunId);
  let recoveryNotice='';
  const pendingResult=parseRunReceipt(await session.load<unknown>('pending_result').catch(()=>null));
  if(pendingResult) {
    const clearActive=!initialRunId||initialRunId===pendingResult.id;discardCompletedRun ||= clearActive;
    try {
      await saveWriter.batch(resultEntries(meta,pendingResult,clearActive));
      await session.submitScore(meta.highScore);
      await saveWriter.save('pending_result',null);
      recoveryNotice='📖 Итог предыдущей попытки восстановлен. Награды учтены один раз.';
    } catch {recoveryNotice='⚠️ Предыдущий итог восстановлен в памяти; сохранение или отправка рекорда ещё не завершились.';}
  }

  function learn(key: CodexEntry): void {
    if (!learnCodex(meta, key)) return;
    encountersUI.showNotification(`📖 Кодекс: ${CODEX[key].title}`);
    void saveWriter.save('meta_progress', meta).catch(() => encountersUI.showNotification('⚠️ Знание изучено, но запись Кодекса не удалась.'));
  }

  const initialBest = await session.bestScore().catch(() => null);
  if (typeof initialBest === 'number' && Number.isFinite(initialBest) && initialBest > meta.highScore) {
    meta.highScore = initialBest;
  }

  // 1. Инициализация состояния
  const player = createPlayer();
  let healing: Healing | null = null;
  let steam = createSteamState();
  let pendingStaff: { timing: StaffStrike; item: InventoryItem; cooledHeat: number } | null = null;
  const groundDrops: { item: InventoryItem; mesh: THREE.Mesh }[] = [];
  const enemyEffects = new Map<string, EnemyEffects>();
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
    name: 'Огненный камень', durability: 12, maxDurability: 12,
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
      slot.isMudded = false;
    }
    inventory.revision++;
    inventory.quickSlots = [null, null, null, null];
    placeItem(inventory, { ...starterStaff }, 0, 0);
    placeItem(inventory, { ...fireStone }, 1, 1);
    placeItem(inventory, { id: 'starter_shield', name: 'Ветхий баклер', parryType: 'reflect', category: 'shield', rarity: 'common', element: 'aether', shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }], weight: 1.2, rotation: 0, defense: 3 }, 2, 0);
    placeItem(inventory, { ...bandage }, 3, 0);
    placeItem(inventory, {
      id: 'starter_scroll', name: 'Свиток света', category: 'scroll', rarity: 'common',
      element: 'aether', shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }], weight: 0.4, rotation: 0,
    }, 4, 0);
    inventory.quickSlots = ['starter_staff', 'starter_shield', 'bandage_starter', 'starter_scroll'];
  }

  // Проверка сохранённого активного забега в SDK
  const rawSavedRun = discardCompletedRun?null:initialRawSavedRun;
  const savedRun = parseSavedRun(rawSavedRun);
  const newSeed = (): number => globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] || Math.floor(Math.random() * 4294967294) + 1;
  let runSeed = savedRun ? savedRun.seed ?? 0 : newSeed();
  const newRunId=():string=>globalThis.crypto?.randomUUID?.()??`run_${Date.now().toString(36)}_${newSeed().toString(36)}`;
  let runId=savedRun?(savedRun.runId??legacyRunId(savedRun)):newRunId();
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
    player.temporaryMana = savedRun.temporaryMana ?? 0;
    player.aetherCore = savedRun.aetherCore ?? 100;
    if (savedRun.world?.steam) steam = { ...savedRun.world.steam };
    healing = savedRun.world?.healing ? { ...savedRun.world.healing } : null;

    if (Array.isArray(savedRun.inventoryItems)) {
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
    for (const cell of savedRun.muddied ?? []) {
      const slot = inventory.slots[cell.y * inventory.width + cell.x]; if (slot) slot.isMudded = true;
    }
    inventory.revision++;
    isRunRestored = true;
  } else {
    setupDefaultStarterItems();
  }

  let floor = generateFloor(player.currentFloor, runSeed);
  if (savedRun?.world) {
    for (const room of floor.rooms) {
      const old = savedRun.world.rooms.find((entry) => entry.id === room.id);
      if (old) { room.isRevealed = old.revealed; room.isVisited = old.visited; room.unlocked = old.unlocked; room.relicTaken = old.relicTaken; room.devastated = old.devastated; }
    }
    if (floor.rooms.some((room) => room.id === savedRun.world!.activeRoomId)) floor.activeRoomId = savedRun.world.activeRoomId;
  }

  async function saveCurrentRun(): Promise<boolean> {
    if (player.isDead || runFinalized) return false;
    collectEnemyRewards();
    if (oracleState.status === 'active') {
      encountersUI.showNotification('🔮 Сначала завершите испытание Оракула.');
      return false;
    }
    const runData: SavedRunProgress = {
      floor: player.currentFloor,
      seed: runSeed,
      runId,
      hp: player.hp,
      greyHp: player.greyHp,
      threadsOfFate: player.threadsOfFate,
      score: player.score,
      injuriesCount: player.injuriesCount,
      elitesDefeated: player.elitesDefeated,
      lightSupply: player.lightSupply,
      aetherHeat: player.aetherHeat,
      fatigue: player.fatigue,
      temporaryMana: player.temporaryMana,
      aetherCore: player.aetherCore,
      muddied: inventory.slots.filter((slot) => slot.isMudded).map((slot) => ({ x: slot.x, y: slot.y })),
      inventoryItems: Array.from(inventory.items.values()),
      quickSlots: inventory.quickSlots.map((id) => id && inventory.items.has(id) ? id : null),
      world: {
        player: { x: playerChar.mesh.position.x, z: playerChar.mesh.position.z, yaw: cameraYaw, pitch: cameraPitch },
        rooms: floor.rooms.map((room) => ({ id: room.id, revealed: room.isRevealed, visited: room.isVisited, unlocked: room.unlocked, relicTaken: room.relicTaken, devastated: room.devastated })),
        activeRoomId: floor.activeRoomId,
        oracle: oracleState.status,
        healing: healing ? { ...healing } : undefined,
        steam: { ...steam },
        drops: groundDrops.map((drop) => ({ item: { ...drop.item, gridX: undefined, gridY: undefined }, x: drop.mesh.position.x, z: drop.mesh.position.z })),
        enemies: enemies.map((enemy) => ({ id: enemy.id, hp: Math.max(0, enemy.hp), x: enemy.mesh.position.x, z: enemy.mesh.position.z, stealthAvailable: enemy.stealthAvailable, effects: enemyEffects.get(enemy.id) ? { ...enemyEffects.get(enemy.id)! } : undefined })),
        mimics: world.mimics.map((mimic) => ({ roomId: mimic.roomId, opened: mimic.isOpened, awakened: mimic.isAwakened })),
      },
    };
    try {
      await saveWriter.batch([
        ['run_progress',runData],
        ['progress',{floor:runData.floor,score:runData.score,hp:runData.hp,threads:runData.threadsOfFate}],
      ]);
    } catch {
      encountersUI.showNotification('⚠️ Сохранение не удалось. Повторите у Разлома.');
      return false;
    }

    return true;
  }

  // 2. Инициализация Three.js
  const canvas = document.getElementById('app-canvas') as HTMLCanvasElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Rogue Destiny: игровое поле');
  // Телефон: без сглаживания, плотность пикселей до 1.5, без теней от точечных
  // светильников и с половиной факельного света - как k8s-at-home держит fps.
  const lowPower = prefersTouch();
  const maxPixelRatio = lowPower ? 1.5 : 2;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lowPower,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const combatEffects=createCombatEffects(lowPower);scene.add(combatEffects.mesh);
  const cameraImpulse=createCameraImpulse();
  function feedbackAt(position:THREE.Vector3,kind:ImpactKind,strength=0,height=1.1):void {
    combatEffects.burst(position.x,position.y+height,position.z,kind,motionPreference.matches);
    if(!motionPreference.matches)kickCamera(cameraImpulse,strength);
  }
  const pulseMaterial=new THREE.MeshBasicMaterial({color:'#edcfa7',transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false});
  const corePulse=new THREE.Mesh(new THREE.RingGeometry(0.9,1,48),pulseMaterial);corePulse.rotation.x=-Math.PI/2;corePulse.visible=false;scene.add(corePulse);
  let pulseRemaining=0,pulseRadius=1;
  const steamCloud = createSteamCloud(); scene.add(steamCloud.cloud);
  const dropGeometry = new THREE.OctahedronGeometry(0.22, 0);
  const dropMaterial = new THREE.MeshBasicMaterial({ color: '#edc987' });
  function dropItem(item: InventoryItem, x: number, z: number): void {
    if (groundDrops.some((drop) => drop.item.id === item.id)) return;
    const mesh = new THREE.Mesh(dropGeometry, dropMaterial);
    mesh.position.set(x, 0.65, z);
    scene.add(mesh);
    groundDrops.push({ item: { ...item, gridX: undefined, gridY: undefined }, mesh });
  }
  scene.background = new THREE.Color('#080b10');
  scene.fog = new THREE.FogExp2('#101822', 0.024);

  const ambientLight = new THREE.AmbientLight('#a2b5d2', 0.9);
  scene.add(new THREE.HemisphereLight('#719ab4', '#211a20', 0.65));
  scene.add(ambientLight);
  const moonLight = new THREE.DirectionalLight('#adc9d8', 1.1);
  moonLight.position.set(-8, 18, -10);
  moonLight.castShadow = !lowPower;
  moonLight.shadow.mapSize.set(1024, 1024);
  moonLight.shadow.camera.left = moonLight.shadow.camera.bottom = -18;
  moonLight.shadow.camera.right = moonLight.shadow.camera.top = 18;
  moonLight.shadow.camera.near = 1; moonLight.shadow.camera.far = 60;
  moonLight.shadow.bias = -0.001;
  scene.add(moonLight, moonLight.target);

  const materials = createCryptMaterials();
  let world = buildCryptWorld(scene, floor, lowPower);
  let oracle = createOracle(floor.rooms.find((room) => room.type === 'shrine')!);
  let oracleState = createOracleChallenge();
  world.group.add(oracle.group);
  if (savedRun?.world?.oracle) oracleState.status = savedRun.world.oracle;
  if (oracleState.status !== 'waiting') oracle.ghost.visible = false;

  // 3. Создание персонажа и врагов
  const playerChar = createPlayerCharacter(materials, lowPower);
  scene.add(playerChar.mesh);
  playerChar.mesh.position.set(0, 0, 0);

  function spawnFloorEnemies(): EnemySylvan3D[] {
    const hall = floor.rooms.find((room) => room.type === 'hall')!;
    const gate = floor.rooms.find((room) => room.type === 'boss_gate')!;
    const corridor = floor.rooms.find((room) => room.type === 'corridor')!;
    const mimic = floor.rooms.find((room) => room.type === 'mimic_room')!;
    const shrine = floor.rooms.find((room) => room.type === 'shrine')!;
    const spawn = (id: string, x: number, z: number, boss = false): EnemySylvan3D =>
      createSylvanEnemy(id, x, z, materials, boss, floor.floorNumber);
    const result = [
      spawn(`sylvan_gatewatch_f${floor.floorNumber}`, corridor.x, corridor.y),
      spawn(`sylvan_f${floor.floorNumber}_1`, hall.x, hall.y),
      spawn(`sylvan_f${floor.floorNumber}_2`, hall.x + 2, hall.y - 2),
      spawn(`warden_f${floor.floorNumber}`, gate.x, gate.y, true),
    ];
    if (floor.floorNumber >= 2) result.push(spawn(`sylvan_relicwatch_f${floor.floorNumber}`, mimic.x - 3, mimic.y));
    if (floor.floorNumber >= 3) result.push(spawn(`sylvan_oraclewatch_f${floor.floorNumber}`, shrine.x - 3, shrine.y + 2));
    return result;
  }
  const enemies: EnemySylvan3D[] = spawnFloorEnemies();
  for (const enemy of enemies) {
    scene.add(enemy.mesh);
  }

  // 4. Настройка камеры от 3-го лица over-the-shoulder
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 150);
  let cameraYaw = 0;
  let cameraPitch = 0.15;
  const cameraObstacles: THREE.Mesh[] = [];
  const cameraRay = new THREE.Raycaster();
  const cameraOrigin = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const cameraIntersections: THREE.Intersection[] = [];
  function refreshCameraObstacles(): void {
    cameraObstacles.length = 0;
    world.group.traverse((node) => {
      if (node.parent === oracle.nightmare) return;
      if (node instanceof THREE.Mesh && node.geometry instanceof THREE.CylinderGeometry && Math.max(node.geometry.parameters.radiusTop, node.geometry.parameters.radiusBottom) >= 0.3) cameraObstacles.push(node);
    });
  }
  refreshCameraObstacles();
  if (savedRun?.world) {
    const old = savedRun.world;
    if (isWalkable(floor, old.player.x, old.player.z)) playerChar.mesh.position.set(old.player.x, 0, old.player.z);
    cameraYaw = old.player.yaw;
    cameraPitch = old.player.pitch;
    for (const enemy of enemies) {
      const state = old.enemies.find((entry) => entry.id === enemy.id);
      if (!state) continue;
      if (isWalkable(floor, state.x, state.z)) enemy.mesh.position.set(state.x, 0, state.z);
      if (state.hp < enemy.maxHp) enemy.takeHit(enemy.maxHp - state.hp, new THREE.Vector3());
      if (!state.stealthAvailable) enemy.markStealthUsed();
      if (state.effects) enemyEffects.set(enemy.id, { ...state.effects });
    }
    for (const drop of old.drops ?? []) dropItem(drop.item, drop.x, drop.z);
    for (const mimic of world.mimics) {
      const state = old.mimics.find((entry) => entry.roomId === mimic.roomId);
      if (state?.opened) mimic.openChest();
      else if (state?.awakened) mimic.awakenMimic();
    }
  }

  // 5. Инициализация UI-слоя и боевого 3D-текста
  const hud = createHud();
  const bossPanel = document.createElement('div');
  bossPanel.className = 'boss-panel';
  bossPanel.hidden = true;
  const bossName = document.createElement('div');
  bossName.className = 'boss-name';
  bossName.textContent = 'СТРАЖ СЕМЕНИ';
  const bossTrack = document.createElement('div'); bossTrack.className = 'boss-track';
  const bossFill = document.createElement('div'); bossFill.className = 'boss-fill'; bossTrack.appendChild(bossFill);
  bossPanel.append(bossName, bossTrack); document.body.appendChild(bossPanel);
  const hazardPanel=document.createElement('div'); hazardPanel.className='hazard-panel'; hazardPanel.hidden=true; document.body.append(hazardPanel);
  const oraclePanel = document.createElement('div'); oraclePanel.className = 'oracle-panel'; oraclePanel.hidden = true;
  const oracleLabel = document.createElement('div'); oracleLabel.className = 'oracle-label';
  const oracleTrack = document.createElement('div'); oracleTrack.className = 'oracle-track';
  const oracleFill = document.createElement('div'); oracleFill.className = 'oracle-fill'; oracleTrack.append(oracleFill);
  oraclePanel.append(oracleLabel, oracleTrack); document.body.append(oraclePanel);
  const healingPanel = document.createElement('div'); healingPanel.className = 'healing-panel'; healingPanel.hidden = true;
  const healingLabel = document.createElement('span'); healingLabel.textContent = 'ПЕРЕВЯЗКА';
  const healingTrack = document.createElement('div'); healingTrack.className = 'healing-track';
  const healingFill = document.createElement('div'); healingFill.className = 'healing-fill'; healingTrack.appendChild(healingFill);
  healingPanel.append(healingLabel, healingTrack); document.body.appendChild(healingPanel);
  const invView = createInventoryView(inventory, (dx, dz, sprint) => {
    keys.forward = dz < 0; keys.backward = dz > 0;
    keys.left = dx < 0; keys.right = dx > 0; keys.shift = sprint;
  }, () => meta.codex, (id) => {
    if (oracleState.status === 'active') { encountersUI.showNotification('🔮 В кошмаре нельзя оставить настоящий предмет.'); return; }
    const item = inventory.items.get(id);
    if (!item || !removeItem(inventory,id)) return;
    dropItem(item,playerChar.mesh.position.x,playerChar.mesh.position.z);
    invView.render(); updateHud(hud,player,floor);
  }, (method,id) => {
    if (isTacticalPause || player.isDead || oracleState.status==='active') return;
    const result=method==='water'?coolIntoWater(player,steam,playerChar.mesh.position.x,playerChar.mesh.position.z):coolIntoItem(player,inventory,id??'');
    encountersUI.showNotification(result.reason);
    if(result.heat>0) {audio.play('magic');invView.render();updateHud(hud,player,floor);}
  },{state:()=>({active:player.threadsOfFate,max:player.maxThreads,scoutable:oracleState.status!=='active'&&fateScoutTargets(floor).length>0}),weave:()=>{
    if(isTacticalPause)return;
    const reserve=fateReserves(inventory)[0];if(!reserve||!weaveFate(player,inventory,reserve.id))return;
    audio.play('pickup');invView.render();updateHud(hud,player,floor);encountersUI.showNotification('🧵 Резервная Нить вплетена в судьбу.');
  },scout:()=>{
    if(isTacticalPause||oracleState.status==='active')return;
    const result=scoutWithFate(player,floor);if(!result.spent)return;
    for(const id of result.opened)world.revealRoom(id);player.score+=result.opened.length*40;
    invView.render();updateHud(hud,player,floor);refreshMinimap();audio.play('magic');
    encountersUI.showNotification(`🧵 Разведано залов: ${result.revealed.length}. Потрачена Нить; свет расходуется при посещении.`);void saveCurrentRun();
  }});
  const encountersUI = createEncountersUI();
  const combatText = createCombatTextManager();
  if(recoveryNotice)encountersUI.showNotification(recoveryNotice);

  function refreshMinimap(): void {
    drawMinimap(hud.minimapCanvas,floor,oracleState.status==='active'?[]:enemies.filter(enemy=>enemy.isAlive).map(enemy=>({x:enemy.mesh.position.x,z:enemy.mesh.position.z,boss:enemy.id.startsWith('warden_')})),{x:playerChar.mesh.position.x,z:playerChar.mesh.position.z,yaw:playerChar.mesh.rotation.y});
  }

  updateHud(hud, player, floor);
  setHudBest(hud, meta.highScore);
  refreshMinimap();
  if (rawSavedRun !== null && savedRun === null) encountersUI.showNotification('⚠️ Сохранённый забег повреждён. Начат новый; рекорды сохранены.');
  if (isRunRestored) {
    encountersUI.showNotification(`📜 Загружен сохранённый забег: Этаж ${player.currentFloor}!`);
  }

  function clearWorld(): void {
    enemyEffects.clear();combatEffects.clear();Object.assign(cameraImpulse,createCameraImpulse());
    for (const drop of groundDrops) scene.remove(drop.mesh);
    groundDrops.length = 0;
    // Материалы героя общие для врагов: освобождаем только принадлежащее этажу.
    const geometries = new Set<THREE.BufferGeometry>();
    const ownedMaterials = new Set<THREE.Material>();
    const persistentMaterials = new Set<THREE.Material>();
    for (const value of Object.values(materials)) if (value instanceof THREE.Material) persistentMaterials.add(value);
    const collect = (node: THREE.Object3D): void => {
      if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Points)) return;
      if (node instanceof THREE.InstancedMesh) node.dispose();
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!persistentMaterials.has(material)) ownedMaterials.add(material);
      }
    };
    nightmareVisibility.clear(); oraclePanel.hidden = true;
    world.group.traverse(collect);
    for (const enemy of enemies) enemy.mesh.traverse(collect);
    for (const geometry of geometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    for (const material of Object.values(world.materials)) {
      if (material instanceof THREE.Material || material instanceof THREE.Texture) material.dispose();
    }
    scene.remove(world.group);
    combatText.clear();
    for (const enemy of enemies) {
      scene.remove(enemy.mesh);
    }
    enemies.length = 0;
  }

  function buildWorldForFloor(): void {
    world = buildCryptWorld(scene, floor, lowPower);
    oracle = createOracle(floor.rooms.find((room) => room.type === 'shrine')!);
    oracleState = createOracleChallenge(); world.group.add(oracle.group);
    refreshCameraObstacles();
    if (scene.fog instanceof THREE.FogExp2) scene.fog.color.set('#101822');
    enemies.push(...spawnFloorEnemies());
    for (const enemy of enemies) {
      scene.add(enemy.mesh);
    }
  }

  let runFinalized = false;
  let floorFinalized = false;
  async function settleRun(victory:boolean,totalScore:number):Promise<boolean> {
    let isNewRecord=totalScore>meta.highScore;
    const receipt={id:runId,score:totalScore,elites:player.elitesDefeated,victory,floor:Math.min(3,player.currentFloor)};
    let saved=false;
    for(let attempt=0;attempt<2&&!saved;attempt++) {
      try {await saveWriter.batch(resultEntries(meta,receipt,true));saved=true;}catch{}
    }
    if(!saved)encountersUI.showNotification('⚠️ Итог пока хранится в памяти: записать сохранение не удалось.');
    try {
      const scoreRes=await session.submitScore(meta.highScore);
      if(scoreRes?.isBest&&totalScore>=meta.highScore)isNewRecord=true;
      if(saved)await saveWriter.save('pending_result',null);
    } catch {encountersUI.showNotification(saved?'⚠️ Рекорд ожидает отправки. Повторим её при следующем запуске.':'⚠️ Отправка рекорда не удалась; итог пока не подтверждён хранилищем.');}
    setHudBest(hud,meta.highScore);return isNewRecord;
  }
  async function triggerDeath(): Promise<void> {
    if (runFinalized) return;
    collectEnemyRewards();
    runFinalized = true;
    invView.close(); playerChar.setBrowsing(false);
    isTacticalPause = true;
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
    document.exitPointerLock();

    encountersUI.showBusy('ПУТЬ ОБОРВАЛСЯ');
    const totalScore=calculateScore(player);
    const isNewRecord=await settleRun(false,totalScore);

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
    if (runFinalized || floorFinalized) return;
    collectEnemyRewards();
    floorFinalized = true;
    invView.close(); playerChar.setBrowsing(false);
    if (player.currentFloor >= 3) runFinalized = true;
    isTacticalPause = true;
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
    document.exitPointerLock();

    encountersUI.showBusy(player.currentFloor>=3?'КРИПТЫ ОСВОБОЖДЕНЫ':'ПОРТАЛ ОТКРЫТ');
    const totalScore=calculateScore(player);let isNewRecord=false;
    if(player.currentFloor>=3) isNewRecord=await settleRun(true,totalScore);
    else {
      isNewRecord=totalScore>meta.highScore;meta.highScore=Math.max(meta.highScore,totalScore);
      meta.highestFloor=Math.max(meta.highestFloor,Math.min(3,player.currentFloor+1));
      await saveWriter.save('meta_progress',meta).catch(()=>encountersUI.showNotification('⚠️ Не удалось записать прогресс этажа.'));
      try {const result=await session.submitScore(totalScore);if(result?.isBest)isNewRecord=true;}catch{}
      setHudBest(hud,meta.highScore);
    }

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
        if (player.currentFloor >= 3) restartGame();
        else void advanceToNextFloor();
      },
      () => {
        restartGame();
      },
    );
  }

  function restartGame(): void {
    invView.close(); playerChar.setBrowsing(false);
    runFinalized = false; floorFinalized = false;
    runSeed = newSeed();runId=newRunId();
    clearWorld();
    player.currentFloor = 1;
    player.hp = player.maxHp = 100;
    player.greyHp = 0;
    player.aetherHeat = 0;
    player.fatigue = 0;
    player.temporaryMana = 0;
    player.aetherCore = 100;
    player.threadsOfFate = 2;
    player.lightSupply = 100;
    player.score = 0;
    player.injuriesCount = 0;
    player.elitesDefeated = 0;
    player.isDead = false;
    healing = null; pendingStaff = null; steam=createSteamState(); steamCloud.cloud.visible=false; pulseRemaining=0;corePulse.visible=false;meltdownSavePending=false; hazardElapsed=0; hazardPanel.hidden=true;

    setupDefaultStarterItems();
    guard(false);
    Object.assign(combat, createCombat());
    rewardedEnemies.clear();
    invView.render();

    floor = generateFloor(1, runSeed);
    buildWorldForFloor();

    playerChar.mesh.position.set(0, 0, 0);
    cameraYaw = 0;
    cameraPitch = 0.15;

    // Сброс сохранения забега для нового прохождения
    void saveWriter.batch([['run_progress',null],['progress',null]]).catch(() => encountersUI.showNotification('⚠️ Не удалось записать начало нового забега.'));

    updateHud(hud, player, floor);
    refreshMinimap();
    isTacticalPause = false;
    lockPointer();
    encountersUI.showNotification('✨ Новое перерождение мага в Затопленных Криптах!');
  }

  async function advanceToNextFloor(): Promise<void> {
    encountersUI.showBusy('СПУСК В ГЛУБИНЫ');
    floorFinalized = false;
    clearWorld();
    player.currentFloor += 1;
    guard(false);
    Object.assign(combat, createCombat());
    rewardedEnemies.clear();
    player.lightSupply = 100;
    steam=createSteamState(); steamCloud.cloud.visible=false;
    player.fatigue = 0;
    player.aetherHeat = 0;

    meta.highestFloor = Math.max(meta.highestFloor, player.currentFloor);
    await saveWriter.save('meta_progress', meta).catch(() => {});

    floor = generateFloor(player.currentFloor, runSeed);
    buildWorldForFloor();

    playerChar.mesh.position.set(0, 0, 0);
    cameraYaw = 0;
    cameraPitch = 0.15;

    // Автосохранение забега на новом этаже
    await saveCurrentRun();

    updateHud(hud, player, floor);
    refreshMinimap();
    isTacticalPause = false;
    lockPointer();
    encountersUI.hideBusy();
    encountersUI.showNotification(`🌀 Спуск на Этаж ${player.currentFloor}: древняя магия сгущается!`);
  }

  // Задержка - у каждого слота своя: общая не давала наложить бинт сразу после удара.
  // Удар посохом - не чаще, чем длится его анимация.
  const QUICK_SLOT_COOLDOWN_MS = [STAFF_COOLDOWN_MS, 250, 400, 400];
  const lastQuickSlotTime = [0, 0, 0, 0];

  const nightmareVisibility = new Map<THREE.Object3D, boolean>();
  function setNightmare(active: boolean): void {
    oracle.nightmare.visible = active;
    if (active) {
      pendingStaff = null; guard(false);
      for (const object of [...world.group.children, ...enemies.map(enemy => enemy.mesh), ...groundDrops.map(drop => drop.mesh)]) {
        if (object === oracle.group) continue;
        nightmareVisibility.set(object, object.visible); object.visible = false;
      }
    } else {
      for (const [object, visible] of nightmareVisibility) object.visible = visible;
      nightmareVisibility.clear();
    }
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.set(active ? '#261c30' : '#101822'); scene.fog.density = active ? 0.065 : 0.024;
    }
    oraclePanel.hidden = !active;
  }
  function moveHero(x: number, z: number, dx: number, dz: number): { x: number; z: number } {
    return oracleState.status === 'active' ? moveInNightmare(x,z,dx,dz,oracle.center.x,oracle.center.z) : moveOnFloor(floor,x,z,dx,dz);
  }
  function beginNightmare(): void {
    if (oracleState.status !== 'waiting') return;
    oracleState.status = 'active';
    const position = moveInNightmare(playerChar.mesh.position.x,playerChar.mesh.position.z,0,0,oracle.center.x,oracle.center.z);
    playerChar.mesh.position.set(position.x,0,position.z);
    setNightmare(true); audio.play('magic');
    encountersUI.showNotification('🔮 Споры заметили вас. Кошмар: разрушьте 3 узла за 20 секунд [удар / E].');
  }
  function strikeIllusion(): void {
    for (let i = 0; i < oracle.nodes.length; i++) {
      if (!oracleState.nodes[i] || playerChar.mesh.position.distanceTo(oracle.nodes[i]!.position) > 2.8) continue;
      if (strikeOracleNode(oracleState, i)) {
        oracle.nodes[i]!.visible = false;
        playerChar.triggerAttack(); audio.play('parry');feedbackAt(oracle.nodes[i]!.position,'parry',0.015,0);
        encountersUI.showNotification(`🔮 Узел разрушен: ${oracleState.nodes.filter(Boolean).length} осталось.`);
      }
      return;
    }
  }
  function discoverSecrets(vision = false, elemental = false): void {
    if (oracleState.status === 'active') return;
    const opened = revealSecretRooms(floor, playerChar.mesh.position.x, playerChar.mesh.position.z,
      { vision, elemental, trueSight: meta.codex.includes('true_sight'), heat: player.aetherHeat });
    if (!opened.length) return;
    for (const id of opened) world.revealRoom(id);
    player.score += opened.length * 40;
    refreshMinimap(); updateHud(hud, player, floor);
    audio.play('magic'); encountersUI.showNotification('🌊 За неприметной стеной открылся затопленный архив (+40 очков).');
  }
  function hitWithStaff(equipped: InventoryItem, cooledHeat: number): void {
    discoverSecrets(false, equipped.element === 'fire' || equipped.element === 'ice' || calculateInventoryStats(inventory).bonusFireDamage > 0);
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
          if (dot > fatigueModifiers(player.fatigue).cone && hasLineOfSight(floor,playerPos.x,playerPos.z,enemy.mesh.position.x,enemy.mesh.position.z)) {
            const stats = calculateInventoryStats(inventory);
            const critical = Math.random() < Math.min(0.6, stats.bonusCritRate);
            const dmg = Math.round(((equipped.damage ?? 18) + stats.bonusFireDamage + stats.bonusPoisonDamage) * (critical ? 1.5 : 1) * fatigueModifiers(player.fatigue).damage);
            enemy.takeHit(dmg, toEnemy);feedbackAt(enemy.mesh.position,'hit',critical?0.025:0.012);
            audio.play('hit');

            const isFire = stats.bonusFireDamage > 0;
            combatText.spawn(
              enemy.mesh.position,
              critical ? `КРИТ! -${dmg}` : isFire ? `🔥 -${dmg}` : `-${dmg}`,
              critical || isFire ? 'crit' : 'damage_enemy',
            );

            encountersUI.showNotification(
              `💥 Удар посохом: -${dmg} HP (Охлаждение тепла -${cooledHeat}%)`,
            );
            if (!enemy.isAlive) {

              updateHud(hud, player, floor);
              encountersUI.showNotification('💀 Сильван повержен! Получены трофеи.');
            }
          }
        }
      }
  }
  function activateQuickSlot(slotNum: number): void {
    if (player.isDead || isTacticalPause) return;
    if (oracleState.status === 'active' && slotNum === 1) { strikeIllusion(); return; }
    if (oracleState.status === 'active' && slotNum === 4) return;
    const now = performance.now();
    const i = slotNum - 1;
    const cooldown=(QUICK_SLOT_COOLDOWN_MS[i] ?? 320)*(i===0?fatigueModifiers(player.fatigue).cooldown:1);
    if (now - (lastQuickSlotTime[i] ?? 0) < cooldown) return;
    lastQuickSlotTime[i] = now;

    const slotEl = hud.quickSlotElements[slotNum - 1];
    if (slotEl) {
      slotEl.classList.add('active');
      setTimeout(() => slotEl.classList.remove('active'), 220);
    }

    const equipped = beltItem(inventory, i);
    if (!equipped) {
      encountersUI.showNotification('🎒 Для этого действия нет подходящего предмета в ранце.');
      return;
    }
    if (slotNum === 1) {
      if (pendingStaff || combat.dodge > 0) return;
      // Посох: боевой замах и охлаждение тепла
      playerChar.triggerAttack();
      audio.play('staff');
      const price = weaponPrice(equipped);
      const coolRes = performPhysicalAttack(player, 4 + price.fatigue);
      if (price.health > 0) {
        const burned = applyDamage(player, price.health);
        combatText.spawn(playerChar.mesh.position, `-${burned.actualDamage}`, 'damage_player');
        if (player.isDead) { void triggerDeath(); return; }
        if (burned.survivedByFate) triggerFateFlash(hud);
      }
      updateHud(hud, player, floor);

      pendingStaff = { timing: createStaffStrike(), item: equipped, cooledHeat: coolRes.cooledHeat };
    } else if (slotNum === 2) {
      // Ветхий щит: стойка магического парирования
      const nextParry = !playerChar.isParrying;
      guard(nextParry);
      if (nextParry) {
        encountersUI.showNotification(`🛡️ Стойка: ${{reflect:'отражение урона',siphon:'перехват эссенции',both:'отражение и перехват'}[equipped.parryType??'both']}. Идеальное окно: 0,24 с.`);
      } else {
        encountersUI.showNotification('🛡️ Стойка парирования опущена');
      }
    } else if (slotNum === 3) {
      if(healing) return;
      healing=startHealing(player,(equipped.healAmount??0)*calculateInventoryStats(inventory).healingMultiplier,equipped.fatigueRestore??0);
      if(!healing) {encountersUI.showNotification('⚠️ Этот припас сейчас не нужен: проверьте здоровье и усталость.');return;}
      removeItem(inventory,equipped.id);invView.render();updateHud(hud,player,floor);
      encountersUI.showNotification('🩹 Припас: 3 секунды. Можно двигаться; скачок прервёт действие.');
    } else if (slotNum === 4) {
      const scroll = equipped;
      if (!scroll) {
        encountersUI.showNotification('📜 В ранце нет свитка. Ищите реликварии в криптах.');
        return;
      }
      if (scroll.damage && scroll.damage > 0) {
        const cast = castMagic(player, scroll.heatCost ?? 20);
        if (!cast.success) { encountersUI.showNotification('🔥 Сначала охладите магические каналы.'); return; }
        for (const enemy of enemies) {
          if (!enemy.isAlive || playerChar.mesh.position.distanceTo(enemy.mesh.position) > 8 || !hasLineOfSight(floor,playerChar.mesh.position.x,playerChar.mesh.position.z,enemy.mesh.position.x,enemy.mesh.position.z)) continue;
          const push = new THREE.Vector3().subVectors(enemy.mesh.position, playerChar.mesh.position).normalize();
          const effects = enemyEffects.get(enemy.id) ?? createEffects();
          enemyEffects.set(enemy.id, effects);
          const damage = spellImpact(effects, scroll.element, Math.round(scroll.damage * getScrollMultiplier(inventory, scroll.id) * (cast.inRedline ? 1.5 : 1)));
          enemy.takeHit(damage, push);feedbackAt(enemy.mesh.position,'magic',0.012);
          combatText.spawn(enemy.mesh.position, `-${damage}`, 'crit');
        }
        removeItem(inventory, scroll.id); invView.render(); playerChar.triggerCast(); updateHud(hud, player, floor);
        encountersUI.showNotification(`📜 ${scroll.name}: ${scroll.element === 'poison' ? 'яд разъедает врагов' : scroll.element === 'ice' ? 'враги замедлены' : 'огненный взрыв'}!`);
        return;
      }
      removeItem(inventory, scroll.id);
      invView.render();
      // Свиток: истинное видение залов и свет
      playerChar.triggerCast();
      player.lightSupply = Math.min(100, player.lightSupply + 35);
      combatText.spawn(playerChar.mesh.position, '💡 +35% СВЕТ', 'vent');

      discoverSecrets(true);
      // Раскрытие смежных комнат на миникарте
      for (const [rAId, rBId] of floor.connections) {
        if (rAId === floor.activeRoomId) {
          const neighbor = floor.rooms.find((r) => r.id === rBId);
          if (neighbor && !neighbor.secret) neighbor.isRevealed = true;
        } else if (rBId === floor.activeRoomId) {
          const neighbor = floor.rooms.find((r) => r.id === rAId);
          if (neighbor && !neighbor.secret) neighbor.isRevealed = true;
        }
      }

      updateHud(hud, player, floor);
      refreshMinimap();
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

  /** Захват мыши - только на ПК: на телефоне его нет, а отказ браузера - не ошибка игры. */
  function lockPointer(): void {
    if (touch?.enabled || document.pointerLockElement === canvas) return;
    try {
      const r = canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // нет захвата - игрок кликнет ещё раз
    }
  }

  // QTE мимика идёт с захваченной мышью: курсор там не нужен, а снятие захвата
  // съедало первый клик (приёмка, пункт 8). Остальные окна курсор отпускают.
  let qteActive = false;

  // 6. Управление: WASD + мышь (PointerLock)
  let isTacticalPause = false;
  const keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    shift: false,
  };

  const combat = createCombat();
  let dodgeSpeed = 0;
  const dodgeDirection = new THREE.Vector3();
  function guard(active: boolean): void {
    active = active && beltItem(inventory, 1) !== null && !player.isDead;
    setGuard(combat, active);
    playerChar.setParry(active);
  }
  function dodge(): void {
    if (isTacticalPause || invView.isOpen || player.isDead) return;
    dodgeSpeed = beginDodge(combat, player.fatigue, calculateInventoryStats(inventory).weightClass);
    if (!dodgeSpeed) return;
    audio.play('dodge');
    player.fatigue = Math.min(100, player.fatigue + 10);
    let dx = Number(keys.left) - Number(keys.right);
    let dz = Number(keys.forward) - Number(keys.backward);
    if (!dx && !dz) dz = 1;
    const angle = Math.atan2(dx, dz) + cameraYaw;
    dodgeDirection.set(Math.sin(angle), 0, Math.cos(angle));
    pendingStaff = null;
    guard(false);
    if (healing) { healing = null; encountersUI.showNotification('🩹 Применение припаса прервано скачком.'); }
  }

  // Сброс клавиш при потере фокуса окна (защита от залипания)
  window.addEventListener('blur', () => {
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
    guard(false);
    touch.release();
    if (!isTacticalPause && !player.isDead) showTitle(true);
  });

  function toggleInventory(): void {
    invView.toggle();
    playerChar.setBrowsing(invView.isOpen);
    if (invView.isOpen) {
      touch.release();
      document.exitPointerLock();
      setTimeout(() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }, 20);
    } else {
      lockPointer();
    }
  }
  invView.onClose(() => {
    if (invView.isOpen) toggleInventory();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && e.target.closest('select, input, textarea') && e.code !== 'Escape') return;
    // Закрытие открытого инвентаря или окна Разлома по Escape
    if (e.code === 'Escape') {
      if (invView.isOpen) {
        e.preventDefault();
        toggleInventory();
        return;
      }
      const overlay = document.getElementById('encounter-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        const riftCard = overlay.querySelector('.rift-card');
        if (riftCard) {
          e.preventDefault();
          overlay.classList.add('hidden');
          isTacticalPause = false;
          lockPointer();
          return;
        }
      }
    }

    if (isTacticalPause) return;
    if (e.code === 'Escape') {
      e.preventDefault(); showTitle(true); return;
    }

    // Открытие/закрытие инвентаря на TAB или I (персонаж достаёт карту, бег на WASD не блокируется!)
    if (e.code === 'Tab' || e.code === 'KeyI') {
      e.preventDefault();
      toggleInventory();
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

    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); dodge(); }

    // Сброс тепла клавишей [V] (ценой ожога плоти в серое HP)
    if (e.code === 'KeyV' && !e.repeat) ventHeat();
    if (e.code === 'KeyX' && !e.repeat) triggerMeltdown();

    // Каст боевого заклинания на клавишу [Q]
    if (e.code === 'KeyQ') {
      triggerMagicCast();
    }

    // Взаимодействие [E]: Споровый Мимик / Эфирный Разлом / Портал
    if (e.code === 'KeyE' && !e.repeat) {
      triggerNearbyInteraction();
    }
  });

  function ventHeat(): void {
    if (player.isDead || isTacticalPause) return;
    if (player.aetherHeat <= 15) {
      encountersUI.showNotification('🔥 Перегрев ниже 15% - сбрасывать нечего');
      return;
    }
    const vent = forceVentHeat(player);feedbackAt(playerChar.mesh.position,'magic',0.035);
    for(const enemy of enemies) if(enemy.isAlive&&playerChar.mesh.position.distanceTo(enemy.mesh.position)<4.5&&hasLineOfSight(floor,playerChar.mesh.position.x,playerChar.mesh.position.z,enemy.mesh.position.x,enemy.mesh.position.z)) {
      const push=new THREE.Vector3().subVectors(enemy.mesh.position,playerChar.mesh.position).normalize();enemy.takeHit(0,push);
    }
    updateHud(hud, player, floor);
    combatText.spawn(playerChar.mesh.position, `⚡ -${vent.heatVented}%`, 'vent');
    combatText.spawn(playerChar.mesh.position, `-${vent.healthBurned}`, 'damage_player');
    encountersUI.showNotification(`⚠️ Сброс тепла (-${vent.heatVented}%): ожог каналов (-${vent.healthBurned} HP)`);
  }

  function triggerMeltdown(): void {
    if(player.isDead||isTacticalPause||invView.isOpen||oracleState.status==='active') return;
    const room=meltdownRoom(floor,playerChar.mesh.position.x,playerChar.mesh.position.z);
    const result=meltdown(player,room);encountersUI.showNotification(result.reason);
    if(!result.success||!room) return;
    healing=null;pendingStaff=null;guard(false);dodgeSpeed=0;combat.dodge=0.7;combat.cooldown=1.25;
    steam=createSteamState();steamCloud.cloud.visible=false;
    for(const enemy of enemies) if(enemy.isAlive&&insideRoom(room,enemy.mesh.position.x,enemy.mesh.position.z)) enemy.takeHit(enemy.hp,new THREE.Vector3());
    for(let i=groundDrops.length-1;i>=0;i--) {
      const drop=groundDrops[i]!;if(!insideRoom(room,drop.mesh.position.x,drop.mesh.position.z)) continue;
      scene.remove(drop.mesh);groundDrops.splice(i,1);
    }
    if(insideRoom(room,oracle.center.x,oracle.center.z)&&oracleState.status==='waiting') {oracleState.status='lost';oracle.ghost.visible=false;}
    world.devastateRoom(room.id);
    corePulse.position.set(room.x,0.17,room.y);pulseRadius=Math.hypot(room.width,room.height)*0.6;pulseRemaining=0.8;corePulse.visible=true;
    playerChar.triggerCast();triggerFateFlash(hud);audio.play('magic');updateHud(hud,player,floor);
    // Снимок будет сделан после единого учёта наград в игровом цикле.
    meltdownSavePending=true;
  }
  let meltdownSavePending=false;
  let lastMagicTime = -Infinity;
  function triggerMagicCast(): void {
    if (oracleState.status === 'active') { if (!isTacticalPause && !player.isDead) strikeIllusion(); return; }
    if (player.isDead || isTacticalPause || performance.now() - lastMagicTime < 650) return;
    lastMagicTime = performance.now();
    const castRes = castMagic(player, 25);
    if (castRes.isOverloaded) {
      encountersUI.showNotification('🔥 ПЕРЕГРУЗКА: охладите посох ударами или сбросьте жар клавишей V.');
    }
    if (castRes.success) {
      discoverSecrets();
      audio.play('magic');
      playerChar.triggerCast();
      updateHud(hud, player, floor);

      const enemy=aimedTarget(floor,enemies.map(enemy=>({enemy,x:enemy.mesh.position.x,z:enemy.mesh.position.z,alive:enemy.isAlive})),playerChar.mesh.position.x,playerChar.mesh.position.z,cameraYaw)?.enemy;
      if(enemy) {
        const spellDmg=castRes.inRedline?38:25;
        const push=new THREE.Vector3().subVectors(enemy.mesh.position,playerChar.mesh.position).normalize();
        enemy.takeHit(spellDmg,push);feedbackAt(enemy.mesh.position,'magic',castRes.inRedline?0.025:0.012);
        combatText.spawn(enemy.mesh.position,castRes.inRedline?`💥 КРИТ! -${spellDmg}`:`⚡ -${spellDmg}`,castRes.inRedline?'crit':'damage_enemy');
        if(!enemy.isAlive) {updateHud(hud,player,floor);encountersUI.showNotification('💀 Сильван испепелён эфирной магией!');}
      }

      if (castRes.inRedline) {
        encountersUI.showNotification('🔥 КРАСНАЯ ЗОНА: Заклинания усилены на +50%!');
      }
    }
  }

  function nearbyGroundDrop(): {drop:(typeof groundDrops)[number];index:number}|null {
    let distance=2.2*2.2,index=-1;
    for(let i=0;i<groundDrops.length;i++) {const current=playerChar.mesh.position.distanceToSquared(groundDrops[i]!.mesh.position);if(current<=distance){distance=current;index=i;}}
    return index<0?null:{drop:groundDrops[index]!,index};
  }
  function triggerNearbyInteraction(): void {
    if (player.isDead || isTacticalPause || invView.isOpen) return;
    if (oracleState.status === 'active') { strikeIllusion(); return; }
    const target=nearbyGroundDrop();
    if(target) {
      if(!autoPlaceItem(inventory,target.drop.item)) {encountersUI.showNotification('🎒 Освободите место в ранце для трофея.');return;}
      scene.remove(target.drop.mesh);groundDrops.splice(target.index,1);invView.render();audio.play('pickup');
      encountersUI.showNotification(`🎒 Получено: ${target.drop.item.name}`);return;
    }
    if (oracleState.status === 'waiting' && playerChar.mesh.position.distanceTo(oracle.center) < 3) {
      if (playerChar.mesh.position.x <= oracle.center.x || keys.shift) { beginNightmare(); return; }
      let fateReroll=false;
      const chance = oracleStealthChance(calculateInventoryStats(inventory).weightClass);
      isTacticalPause = true; document.exitPointerLock();
      keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
      encountersUI.showStealthModal('Скорбящий Оракул: разорвать споровую связь', [
        { text: `Тихо оборвать споры (${Math.round(chance * 100)}%)`, risk: chance > 0.9 ? 'low' : chance > 0.5 ? 'medium' : 'high', reward: 'Истинное зрение и награда без кошмара', action: () => {
          isTacticalPause = false; lockPointer();
          if (stealthRoll(chance,fateReroll)) { oracleState.status = 'won'; finishOracle(); }
          else beginNightmare();
        } },
        { text: 'Войти в кошмар осознанно', risk: 'high', reward: 'Разрушить три узла за 20 секунд', action: () => { isTacticalPause = false; lockPointer(); beginNightmare(); } },
        { text: 'Отступить', risk: 'low', reward: 'Связь останется нетронутой', action: () => { isTacticalPause = false; lockPointer(); } },
      ],{threads:player.threadsOfFate,change:enabled=>{fateReroll=enabled;}});
      return;
    }
    for (const room of floor.rooms) {
      if (room.secret || !room.lockType || room.unlocked) continue;
      const dx = Math.max(0, Math.abs(playerChar.mesh.position.x - room.x) - room.width / 2);
      const dz = Math.max(0, Math.abs(playerChar.mesh.position.z - room.y) - room.height / 2);
      if (Math.hypot(dx, dz) > 2.5) continue;
      const knowledge = new Set<string>(meta.codex);
      if (player.fatigue < 85 && combat.cooldown <= 0) knowledge.add('aether_step');
      if (player.threadsOfFate > 0) knowledge.add('fate_light');
      if (floor.rooms.find((entry) => entry.type === 'shrine')?.isVisited) knowledge.add('sylvan_ciphers');
      const result = canUnlockMetroidvania(room.lockType, inventory, knowledge);
      encountersUI.showNotification(result.reason);
      if (result.canUnlock) {
        room.unlocked = true;
        const barrier = world.barriers.get(room.id);
        if (barrier) barrier.visible = false;
        if (room.lockType === 'chasm' && knowledge.has('aether_step')) {
          dodge(); dodgeDirection.set(room.x-playerChar.mesh.position.x,0,room.y-playerChar.mesh.position.z).normalize();
        }
        if (room.lockType !== 'soundTrap') player.score += 20;
        updateHud(hud, player, floor);
        void saveCurrentRun();
      }
      return;
    }
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
        if (enemies.some((enemy) => enemy.isAlive)) {
          encountersUI.showNotification('🔒 Печать портала держится: одолейте стражей и Стража Семени.');
          return;
        }
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
          cleanseInventory(inventory); invView.render();
          isTacticalPause = false;
          lockPointer();
          restAtAetherRift(player); if(rekindleStarterCatalyst(inventory)) invView.render(); steam=createSteamState(); steamCloud.cloud.visible=false;
          if (!Array.from(inventory.items.values()).some((item) => item.category === 'potion' && (item.healAmount??0)>0 && !item.isSpoiled)) {
            autoPlaceItem(inventory, { ...bandage, id: `rift_bandage_${player.currentFloor}` });
            invView.render();
          }
          const saved = await saveCurrentRun();
          updateHud(hud, player, floor);
          combatText.spawn(playerChar.mesh.position, '✨ ОТДЫХ: HP ПОЛНО!', 'heal');
          encountersUI.showNotification(saved ? '✨ Силы и стартовый катализатор восстановлены; прогресс сохранён!' : '✨ Силы восстановлены. Запись прогресса не удалась.');
        },
        async () => {
          // Сохранение через SDK
          isTacticalPause = false;
          lockPointer();
          if (!await saveCurrentRun()) return;
          encountersUI.showNotification('💾 Прогресс забега сохранён в кристалле Разлома!');
        },
        () => {
          // Выход из диалога Разлома
          isTacticalPause = false;
          lockPointer();
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
      lockPointer();
      return;
    }

    // ЛКМ: Физический удар посохом (быстрый слот 1)
    if (e.button === 0) {
      activateQuickSlot(1);
    }

    // ПКМ: Парирование (лазурный барьер / быстрый слот 2)
    if (e.button === 2 && beltItem(inventory, 1)) {
      guard(true);
      const slotEl = hud.quickSlotElements[1];
      if (slotEl) slotEl.classList.add('active');
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      guard(false);
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
    if (document.pointerLockElement === canvas && !isTacticalPause) {
      cameraYaw -= e.movementX * 0.0025;
      cameraPitch = Math.max(-0.45, Math.min(0.65, cameraPitch + e.movementY * 0.0025));
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  });

  // Автоматический сброс PointerLock при открытых окнах (защита для Wayland/Chromium)
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement && (invView.isOpen || (isTacticalPause && !qteActive))) {
      document.exitPointerLock();
    }
  });

  // Сенсорное управление - по образцу k8s-at-home: включается на телефоне сразу,
  // а на любом другом устройстве - с первого касания пальцем.
  const touch = createTouchControls(canvas, {
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
      active = active && beltItem(inventory, 1) !== null;
      guard(active);
      const slotEl = hud.quickSlotElements[1];
      if (slotEl) slotEl.classList.toggle('active', active);
    },
    onMagic: () => triggerMagicCast(),
    onDodge: () => dodge(),
    onInteract: () => triggerNearbyInteraction(),
    onPause: () => { if (!isTacticalPause) showTitle(true); },
    onInventory: () => {
      if (isTacticalPause) return;
      toggleInventory();
    },
    onHeal: () => activateQuickSlot(3),
    onScroll: () => activateQuickSlot(4),
    onVent: () => ventHeat(),
    onMeltdown: () => triggerMeltdown(),
    isActive: () => !isTacticalPause && !invView.isOpen,
  });

  // Телефон держат боком: стоя половину экрана закрывают кнопки
  function portraitHint(): void {
    if (touch.enabled && window.innerHeight > window.innerWidth * 1.1) {
      encountersUI.showNotification('📱 Поверните телефон боком - так удобнее');
    }
  }
  window.addEventListener('orientationchange', () => setTimeout(portraitHint, 300));
  portraitHint();

  // Новый предмет - в первое свободное место, перебирая повороты (core/inventory.ts)
  function tryAddItem(item: InventoryItem): boolean {
    const added = autoPlaceItem(inventory, item);
    if (added) invView.render();
    else dropItem(item, playerChar.mesh.position.x + 0.8, playerChar.mesh.position.z);
    return added;
  }

  // Запуск тактической стелс-паузы и сценарного выбора
  function stealthRoll(chance:number,reroll:boolean):boolean {
    const result=attemptWithFate(player,chance,reroll);
    if(result.spent){audio.play('pickup');updateHud(hud,player,floor);encountersUI.showNotification(result.success?'🧵 Переброс за Нить спас действие.':'🧵 Переброс за Нить тоже не удался.');}
    return result.success;
  }
  function triggerStealthScenario(enemy: EnemySylvan3D, weightClass: WeightClass): void {
    isTacticalPause = true;
    document.exitPointerLock();

    const isLight = weightClass === 'light';
    let fateReroll=false;
    const assassinateChance = isLight ? 0.88 : 0.72;
    const harvestChance = isLight ? 0.95 : 0.85;

    const choices: StealthChoice[] = [
      {
        text: `🗡️ Скрытный раскол в сочленение ветвей (${Math.round(assassinateChance * 100)}% шанс)`,
        risk: isLight ? 'low' : 'medium',
        reward: '+50 очков и Руна древнего мха',
        action: () => {
          isTacticalPause = false;
          lockPointer();

          if (stealthRoll(assassinateChance,fateReroll)) {
            player.score += 50;
            const pushDir = new THREE.Vector3()
              .subVectors(enemy.mesh.position, playerChar.mesh.position)
              .normalize();
            enemy.takeHit(999, pushDir);
            combatText.spawn(enemy.mesh.position, '💥 КРИТИЧЕСКИЙ УДАР! 999', 'crit');


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
                : '🗡️ БЕСШУМНОЕ УСТРАНЕНИЕ: Страж сражён! (+50 очков, рюкзак полон - руна оставлена)',
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
          lockPointer();

          if (stealthRoll(harvestChance,fateReroll)) {
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
        reward: 'Отвлечение до 6 метров с учётом преград',
        action: () => {
          isTacticalPause = false;
          lockPointer();

          const forward = new THREE.Vector3();
          enemy.mesh.getWorldDirection(forward);
          const distractOffset = forward.clone().multiplyScalar(6.0);
          const destination=moveOnFloor(floor,enemy.mesh.position.x,enemy.mesh.position.z,distractOffset.x,distractOffset.z);
          enemy.distract(new THREE.Vector3(destination.x-enemy.mesh.position.x,0,destination.z-enemy.mesh.position.z));

          player.score += 15;
          updateHud(hud, player, floor);
          encountersUI.showNotification('🪨 ОТВЛЕЧЕНИЕ: Страж пошёл на шум камня (+15 очков)!');
        },
      },
    ];

    encountersUI.showStealthModal('Вы бесшумно подкрались за спину Древесного Стража Сильвана', choices,{threads:player.threadsOfFate,change:enabled=>{fateReroll=enabled;}});
  }

  // Запуск QTE-взлома Спорового Мимика
  function triggerMimicEncounter(mimic: SporeMimic3D): void {
    if (!mimic.triggerQteAvailable || isTacticalPause) return;

    isTacticalPause = true;
    qteActive = true;
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
    touch.release();

    encountersUI.showMimicQte(
      () => {
        // Успех взлома
        isTacticalPause = false;
        qteActive = false;
        lockPointer();
        mimic.openChest();

        player.score += 75;
        const relicScroll: InventoryItem = {
          id: `relic_scroll_${Date.now()}`,
          name: player.currentFloor % 2 === 1 ? 'Свиток огня' : 'Свиток яда',
          category: 'scroll',
          rarity: 'rare',
          element: player.currentFloor % 2 === 1 ? 'fire' : 'poison',
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
            ? `✨ РЕЛИКВАРИЙ ВСКРЫТ: ${relicScroll.name} получен (+75 очков)!`
            : '✨ РЕЛИКВАРИЙ ВСКРЫТ: Споры уснули! Ранец полон (+75 очков)',
        );
      },
      () => {
        // Провал: пробуждение и яростный укус мимика
        isTacticalPause = false;
        qteActive = false;
        lockPointer();
        mimic.awakenMimic();

        damageAetherCore(player, 20);
        player.lightSupply = Math.max(0, player.lightSupply - 25);
        const dmgRes = applyDamage(player, 22);
        player.fatigue = Math.min(100, player.fatigue + 35); // Споровый шок
        if (infectInventory(inventory)) encountersUI.showNotification('🦠 Споры заразили отсек ранца. Соседние предметы заблокированы до очистки у Разлома.');
        invView.render();
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

  // Диагностика создаётся по требованию, обновление текста - дважды в секунду.
  let diagnostics: HTMLPreElement | null = null;
  let diagnosticTime = 0;
  let lastLightUpdate = -Infinity;
  let hazardElapsed = 0;
  let diagnosticFrames = 0;
  let previousDiagnosticTime = performance.now();
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'F3' || event.repeat) return;
    event.preventDefault();
    if (!diagnostics) {
      diagnostics = document.createElement('pre');
      diagnostics.style.cssText = 'position:fixed;top:8px;right:8px;z-index:10000;pointer-events:none;background:#08101ee8;color:#9ee7ef;padding:12px;border:1px solid #386071;border-radius:8px;font:12px monospace';
      document.body.appendChild(diagnostics);
    } else diagnostics.hidden = !diagnostics.hidden;
  });

  const rewardedEnemies = new Set(enemies.filter((enemy) => !enemy.isAlive).map((enemy) => enemy.id));

  function placeFateReserve(item:InventoryItem,x:number,z:number):'bag'|'ground' {
    const placed=autoPlaceItem(inventory,item);if(!placed)dropItem(item,x,z);invView.render();return placed?'bag':'ground';
  }
  function collectEnemyRewards():void {
    for (const enemy of enemies) {
      let fateNotice='🌱 Страж Семени повержен. Возвращена Нить Судьбы; печать ослабла.';
      if (claimDefeat(player,rewardedEnemies,enemy,item=>{const location=placeFateReserve(item,enemy.mesh.position.x,enemy.mesh.position.z);fateNotice=location==='bag'?'🧵 Запас Нитей полон: Нить Стража убрана в ранец.':'🧵 Ранец полон: резервная Нить осталась у Стража.';})) {
        if(enemy.kind==='stalker') learn('spore_stalker');
        if(enemy.kind==='thorn') learn('thorn_guard');
        const trophy: InventoryItem = enemy.id.startsWith('warden_') ? {
          id: `trophy_${enemy.id}`, name: 'Свиток ледяной печати', category: 'scroll', rarity: 'holy', element: 'ice', shape: [{ x: 0, y: 0 }], weight: 0.6, rotation: 0, damage: 22, heatCost: 20,
        } : enemy.id.includes('gatewatch') ? {
          id:`trophy_${enemy.id}`,name:'Фляга чистой воды',category:'potion',rarity:'common',element:'physical',shape:[{x:0,y:0}],weight:0.4,rotation:0,fatigueRestore:35,
        } : enemy.id.includes('relicwatch') ? {
          id:`trophy_${enemy.id}`,name:'Сухой паёк следопыта',category:'potion',rarity:'common',element:'physical',shape:[{x:0,y:0}],weight:0.5,rotation:0,healAmount:10,fatigueRestore:25,
        } : {
          id: `trophy_${enemy.id}`, name: 'Полевой бинт', category: 'potion', rarity: 'common', element: 'physical', shape: [{ x: 0, y: 0 }], weight: 0.3, rotation: 0, healAmount: 24,
        };
        dropItem(trophy, enemy.mesh.position.x, enemy.mesh.position.z);
        updateHud(hud, player, floor);
        if (enemy.id.startsWith('warden_')) {
          encountersUI.showNotification(fateNotice);
        }
      }
    }
  }

  // 7. Игровой цикл (requestAnimationFrame)
  let lastTime = performance.now();
  let lastHeardRoom = '';
  let lastCueTime = -Infinity;
  const tempMoveDir = new THREE.Vector3();

  function animate(now: number) {
    requestAnimationFrame(animate);
    diagnosticFrames++;
    if (now - lastLightUpdate >= 250) {
      lastLightUpdate = now;
      if(!isTacticalPause) refreshMinimap();
      if (!isTacticalPause && oracleState.status !== 'active') {
        for (const id of refreshSoundGates(floor,inventory,playerChar.mesh.position.x,playerChar.mesh.position.z)) {
          const barrier=world.barriers.get(id); if(barrier) barrier.visible=true;
        }
      }
      if (!isTacticalPause && (meta.codex.includes('true_sight') || player.aetherHeat >= 80 && player.aetherHeat <= 95)) discoverSecrets();
      for (const entry of world.lighting) {
        let parent = entry.light.parent;
        let visible = true;
        while (parent) { if (!parent.visible) { visible = false; break; } parent = parent.parent; }
        entry.distance = visible ? entry.position.distanceToSquared(playerChar.mesh.position) : Infinity;
      }
      world.lighting.sort((a, b) => a.distance - b.distance);
      world.lighting.forEach((entry, i) => { entry.light.visible = Number.isFinite(entry.distance) && i < (lowPower ? 3 : 7); });
    }
    if (now - previousDiagnosticTime >= 500) {
      for (let i = 0; i < hud.quickSlotElements.length; i++) {
        const item = beltItem(inventory, i);
        const slot = hud.quickSlotElements[i]!;
        const label = slot.querySelector('.slot-name');
        if (label) label.textContent = item?.name ?? 'Пусто';
        slot.style.opacity = item ? '1' : '0.45';
        slot.title = item ? `[${i + 1}] ${item.name}` : `[${i + 1}] Нет предмета`;
      }
      const objective=chapterObjective(floor,enemies.filter(enemy=>enemy.isAlive).length,enemies.some(enemy=>enemy.isAlive&&enemy.id.startsWith('warden_')),meta.codex.includes('sylvan_ciphers'));
      hud.objectiveText.textContent=objective.title;hud.objectiveText.title=objective.detail;
      const possibleMeltdownRoom=meltdownRoom(floor,playerChar.mesh.position.x,playerChar.mesh.position.z);
      touch.setMeltdownReady(!isTacticalPause&&!invView.isOpen&&oracleState.status!=='active'&&player.aetherHeat>=95&&player.threadsOfFate>0&&!!possibleMeltdownRoom&&!possibleMeltdownRoom.devastated);
      const focus=selectCombatTarget(enemies.map(enemy=>({enemy,x:enemy.mesh.position.x,z:enemy.mesh.position.z,kind:enemy.kind,alive:enemy.isAlive})),playerChar.mesh.position.x,playerChar.mesh.position.z,cameraYaw)?.enemy;
      bossPanel.hidden=oracleState.status==='active'||!focus||isTacticalPause||invView.isOpen;
      if(focus&&!bossPanel.hidden) {
        bossFill.style.width=`${Math.max(0,focus.hp/focus.maxHp)*100}%`;bossPanel.classList.toggle('ordinary',focus.kind!=='warden');
        bossName.textContent=focus.kind==='warden' ? focus.unblockable&&focus.aiState==='windup'?'СТРАЖ СЕМЕНИ · УДАР ПО ЗЕМЛЕ - ОТОЙДИТЕ':focus.hp<focus.maxHp/2?'СТРАЖ СЕМЕНИ · ЯРОСТЬ':'СТРАЖ СЕМЕНИ'
          : `${focus.name}${focus.kind==='thorn'&&focus.aiState==='windup'?' · НЕСБИВАЕМЫЙ ЗАМАХ':focus.kind==='stalker'?' · ОПАСЕН ДЛЯ ЯДРА':''}`;
      }
      diagnosticTime = Math.round(diagnosticFrames * 1000 / (now - previousDiagnosticTime));
      diagnosticFrames = 0;
      previousDiagnosticTime = now;
      if (diagnostics && !diagnostics.hidden) diagnostics.textContent =
        `Rogue Destiny 0.3.0\n${diagnosticTime} fps | ${renderer.info.render.calls} calls\n${renderer.info.render.triangles} triangles\n${renderer.info.memory.geometries} geometries | ${renderer.info.memory.textures} textures\nЭтаж ${player.currentFloor} | ${enemies.filter((enemy) => enemy.isAlive).length} противников`;
    }

    if (isTacticalPause) {
      lastTime = now;
      renderer.render(scene, camera);
      return;
    }

    const delta = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    tickCombat(combat, delta);
    if(pulseRemaining>0) {pulseRemaining=Math.max(0,pulseRemaining-delta);corePulse.scale.setScalar(Math.max(0.01,(1-pulseRemaining/0.8)*pulseRadius));pulseMaterial.opacity=pulseRemaining/0.8;corePulse.visible=pulseRemaining>0;}
    if(oracleState.status!=='active') {
      const poison=tickSteamPoison(player,steam,delta);
      if(poison.damage>0) {updateHud(hud,player,floor);combatText.spawn(playerChar.mesh.position,`☠ -${poison.damage}`,'damage_player');if(poison.fate) triggerFateFlash(hud);}
      if(player.isDead) {void triggerDeath();renderer.render(scene,camera);return;}
    }
    steamCloud.update(steam,delta,oracleState.status!=='active');
    if (oracleState.status !== 'active') {
      hazardElapsed += delta;
      if (hazardElapsed >= 0.25) {
        const hazards=tickInventoryHazards(inventory,hazardElapsed); hazardElapsed=0;
        if(hazards.burned.length||hazards.spoiled.length) {
          invView.render(); updateHud(hud,player,floor); audio.play('hurt');
          for(const name of hazards.burned) encountersUI.showNotification(`🔥 Сгорел ${name}. Держите огонь отдельно от бумаги.`);
          for(const name of hazards.spoiled) encountersUI.showNotification(`☠ ${name}: припас отравлен соседним предметом.`);
        } else invView.refreshHazards();
        const warnings=inventoryWarnings(inventory); hazardPanel.hidden=!warnings.length;
        if(warnings.length) {
          const warning=warnings[0]!;
          hazardPanel.textContent=`${warning.kind==='fire'?'🔥 ГОРИТ':'☠ ОТРАВЛЯЕТСЯ'} ${warning.name} · ${warning.remaining.toFixed(1)} с · переложите в ранце`;
        }
      }
    } else hazardPanel.hidden=true;
    if (player.lightSupply <= 0) { damageAetherCore(player, delta * 2); updateHud(hud, player, floor); }
    const wasOracleActive = oracleState.status === 'active';
    if (floor.rooms.some(room => room.type === 'shrine' && room.unlocked) && observeOracle(oracleState, delta, playerChar.mesh.position.x - oracle.center.x, playerChar.mesh.position.z - oracle.center.z, calculateInventoryStats(inventory).weightClass, keys.shift)) beginNightmare();
    tickOracle(oracleState, delta);
    oraclePanel.hidden = oracleState.status !== 'active';
    if (!oraclePanel.hidden) {
      oracleLabel.textContent = `ВЫЖЖЕННЫЙ ЛЕС · ${Math.ceil(oracleState.remaining)} с · УЗЛЫ ${oracleState.nodes.filter(Boolean).length}/3`;
      oracleFill.style.transform = `scaleX(${oracleState.remaining / 20})`;
      oraclePanel.classList.toggle('urgent', oracleState.remaining <= 5);
      oracle.embers.rotation.y += delta * 0.08;
    }
    oracle.ghost.position.y = 0.6 + Math.sin(now * 0.0018) * 0.18;
    for (let i = 0; i < oracle.nodes.length; i++) {
      const node = oracle.nodes[i]!;
      node.visible = oracleState.status === 'active' && oracleState.nodes[i]!;
      if (node.visible) { node.rotation.y += delta; node.position.y = 1.1 + Math.sin(now * 0.004 + i) * 0.2; }
    }
    if (wasOracleActive && oracleState.status !== 'active') finishOracle();
    if (oracleState.status === 'won' && oracle.ghost.visible) finishOracle();
    if(player.isDead||isTacticalPause){renderer.render(scene,camera);return;}
    healingPanel.hidden = healing === null;
    if (healing) {
      const fatigueBefore=player.fatigue;healingLabel.textContent=(healing.fatigueAmount??0)>0?'ПРИПАСЫ':'ПЕРЕВЯЗКА';
      const healed = advanceHealing(healing, player, delta);
      const fatigueRecovered=fatigueBefore-player.fatigue;
      healingFill.style.width = `${Math.max(0, 1 - healing.remaining / 3) * 100}%`;
      if (healing.remaining <= 0) {
        healing = null; healingPanel.hidden = true;
        audio.play('heal');feedbackAt(playerChar.mesh.position,'heal');
        combatText.spawn(playerChar.mesh.position, fatigueRecovered>0?`-${Math.round(fatigueRecovered)} УСТАЛОСТИ${healed>0?` · +${healed} HP`:''}`:`+${healed} HP`, 'heal');
        updateHud(hud, player, floor);
      }
    }
    if (combat.dodge > 0) {
      const next = moveHero(playerChar.mesh.position.x, playerChar.mesh.position.z,
        dodgeDirection.x * dodgeSpeed * delta, dodgeDirection.z * dodgeSpeed * delta);
      playerChar.mesh.position.x = next.x; playerChar.mesh.position.z = next.z;
    }

    // Вектор перемещения (A - влево на экране (+X в Three.js при Z-forward), D - вправо (-X))
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

    const fatigueMovement=fatigueModifiers(player.fatigue).speed;
    baseSpeed*=fatigueMovement;sprintSpeed*=fatigueMovement;
    if (isMoving && combat.dodge <= 0) {
      tempMoveDir.normalize();

      // Направление движения относительно угла камеры
      const moveAngle = Math.atan2(tempMoveDir.x, tempMoveDir.z) + cameraYaw;
      const speed = keys.shift && player.fatigue < 80 ? sprintSpeed : baseSpeed;

      const next = moveHero(playerChar.mesh.position.x, playerChar.mesh.position.z,
        Math.sin(moveAngle) * speed * delta, Math.cos(moveAngle) * speed * delta);
      playerChar.mesh.position.x = next.x;
      playerChar.mesh.position.z = next.z;

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
    if (pendingStaff && advanceStaffStrike(pendingStaff.timing, delta)) {
      const strike = pendingStaff; pendingStaff = null;
      if (!player.isDead) hitWithStaff(strike.item, strike.cooledHeat);
    }
    moonLight.position.set(playerChar.mesh.position.x - 8, 18, playerChar.mesh.position.z - 10);
    moonLight.target.position.copy(playerChar.mesh.position);

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
    cameraOrigin.set(playerChar.mesh.position.x, 1.5, playerChar.mesh.position.z);
    cameraDirection.subVectors(camera.position, cameraOrigin);
    cameraRay.far = cameraDirection.length();
    cameraDirection.normalize(); cameraRay.set(cameraOrigin, cameraDirection);
    cameraIntersections.length = 0;
    if (oracleState.status !== 'active') cameraRay.intersectObjects(cameraObstacles, false, cameraIntersections);
    const obstacle = cameraIntersections[0];
    if (obstacle) camera.position.copy(cameraOrigin).addScaledVector(cameraDirection, Math.max(0.8, obstacle.distance - 0.25));

    const recoil=tickCameraImpulse(cameraImpulse,delta,motionPreference.matches);camera.position.x+=recoil.x;camera.position.y+=recoil.y;
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
          refreshMinimap();

          if (room.type === 'shrine') learn('sylvan_ciphers');
          if (room.type === 'shrine' && !room.relicTaken) {
            room.relicTaken = true;
            dropItem(shrineRelic(player.currentFloor), room.x + 2, room.y);
            encountersUI.showNotification('🗝️ Найдены реликвия и знания древнего шифра. Святой посох безопасен; адский жезл забирает здоровье.');
          }
          if (room.type === 'vault' && !room.relicTaken) {
            room.relicTaken = true; player.score += 60;
            dropItem(vaultRelic(player.currentFloor),room.x,room.y);
            encountersUI.showNotification('🏺 Боковой реликварий: найден редкий инструмент (+60 очков).');
          }
          if (room.type === 'library' && !room.relicTaken) {
            room.relicTaken = true; learn('water_breathing');
            dropItem(libraryRelic(player.currentFloor), room.x, room.y);
            const reserve=awardFate(player,`library_${player.currentFloor}`);if(reserve)placeFateReserve(reserve,room.x,room.y);
            updateHud(hud,player,floor);
            encountersUI.showNotification('📖 Архивариус оставил эфирную реликвию, знание Дыхания корней и Нить Судьбы.');
          }
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
            if (lastHeardRoom !== neighbor.id && now - lastCueTime > 5000) {
              audio.play('cue'); lastHeardRoom = neighbor.id; lastCueTime = now;
            }
            nearbyCue = neighbor.cue.message;
            break;
          }
        }
      }
    }

    for (const room of floor.rooms) {
      if (room.secret || !room.lockType || room.unlocked) continue;
      const dx = Math.max(0, Math.abs(playerChar.mesh.position.x - room.x) - room.width / 2);
      const dz = Math.max(0, Math.abs(playerChar.mesh.position.z - room.y) - room.height / 2);
      if (Math.hypot(dx, dz) < 2.5) { nearbyCue = { brambles: '🔥 [E] Прожечь корни огнём или кислотой', runeCipher: '📖 [E] Расшифровать врата: исследуйте святилище', submerged: '🌊 [E] Затопленный сифон: дыхательный амулет или знание корней', steamVent: '❄ [E] Паровой клапан: нужен лёд', soundTrap: '🔔 [E] Звуковой проход: ранец легче 6 кг', elementalWard: '🛡 [E] Эфирный барьер: изучите идеальное парирование', pitchBlack: '✦ [E] Абсолютная тьма: свет Нити или кристалл', chasm: '💨 [E] Разлом: готовый скачок или крюк', illusionary: '' }[room.lockType]; break; }
    }

    // Проверка близости к Споровому Мимику
    for (const mimic of world.mimics) {
      if (oracleState.status !== 'active' && mimic.triggerQteAvailable) {
        const dist = playerChar.mesh.position.distanceTo(mimic.worldPosition);
        if (dist <= 3.2) {
          nearbyCue = '📦 [E] - Осторожно взломать споровый реликварий';
          if (dist <= 1.4 && !isTacticalPause && !invView.isOpen && !nearbyGroundDrop()) {
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
          nearbyCue = '⚡ [E] - Коснуться Эфирного Разлома (Отдых и Сохранение)';
          break;
        }
      }
    }

    // Проверка близости к Древнему Порталу (Завершение этажа / Победа)
    if (!nearbyCue) {
      for (const p of world.portals) {
        const distToPortal = playerChar.mesh.position.distanceTo(p.worldPosition);
        if (distToPortal <= 4.2) {
          nearbyCue = enemies.some((enemy) => enemy.isAlive) ? '🔒 Печать портала: победите стражей' : '🌀 [E] - Активировать Древний Портал';
          break;
        }
      }
    }

    for (const drop of groundDrops) {
      if (playerChar.mesh.position.distanceTo(drop.mesh.position) <= 2.2) { nearbyCue = `🎒 [E] Подобрать: ${drop.item.name}`; break; }
    }
    if(player.aetherHeat>=95&&player.threadsOfFate>0&&oracleState.status!=='active') nearbyCue='🧵 [X / 🧵] Срыв Ядра: -1 Нить, 1 HP. Зал и оставленный лут будут уничтожены.';
    if (oracleState.status === 'waiting' && oracleState.awareness > 0.1) nearbyCue = `🔮 ОРАКУЛ ЧУЕТ ВАС · ${Math.round(oracleState.awareness * 100)}% · уйдите из его взгляда и не бегите`;
    if (oracleState.status === 'active') nearbyCue = `🔮 КОШМАР: ${Math.ceil(oracleState.remaining)} с · узлов ${oracleState.nodes.filter(Boolean).length} · [ЛКМ / E] разрушить`;
    else if (oracleState.status === 'waiting' && oracleState.awareness <= 0.1 && playerChar.mesh.position.distanceTo(oracle.center) < 3) nearbyCue = playerChar.mesh.position.x > oracle.center.x && !keys.shift ? '🔮 [E] Тихо разорвать споры Оракула со спины' : '🔮 Оракул смотрит ко входу. Обойдите его тихо или [E] войдите в кошмар';
    const groundTarget=nearbyGroundDrop();
    if(groundTarget&&oracleState.status!=='active') nearbyCue=`🎒 [E] Подобрать: ${groundTarget.drop.item.name}`;
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

    if(steam.remaining>0 && Math.hypot(playerChar.mesh.position.x-steam.x,playerChar.mesh.position.z-steam.z)<2.5) detectionRadius*=0.4;

    // Проверка сценарного стелса (подкрадывание со спины к патрульному Сильвану)
    if (oracleState.status !== 'active' && !isTacticalPause && !invView.isOpen && invStats.weightClass !== 'heavy') {
      for (const enemy of enemies) {
        if (enemy.isAlive && enemy.stealthAvailable && enemy.aiState === 'patrol') {
          const toPlayer = new THREE.Vector3()
            .subVectors(playerChar.mesh.position, enemy.mesh.position);
          toPlayer.y = 0;
          const dist = toPlayer.length();

          if (dist <= 2.5 && hasLineOfSight(floor,enemy.mesh.position.x,enemy.mesh.position.z,playerChar.mesh.position.x,playerChar.mesh.position.z)) {
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

    // Сценарий мог открыть паузу в текущем кадре: враги уже не должны наносить удар.
    if (isTacticalPause) { renderer.render(scene, camera); return; }
    // Обновление врагов Сильванов и обработка входящего урона
    for (const enemy of enemies) {
      if(player.isDead||isTacticalPause)break;
      if (enemy.isAlive && oracleState.status !== 'active') {
        const previousX = enemy.mesh.position.x, previousZ = enemy.mesh.position.z, wasStaggered=enemy.isStaggered;
        const effects = enemyEffects.get(enemy.id);
        if (effects) {
          const damage = tickEffects(effects, delta);
          if (damage > 0) { enemy.takeHit(damage, new THREE.Vector3(), false); combatText.spawn(enemy.mesh.position, `-${damage}`, 'damage_enemy'); }
        }
        const senses=enemySenses(floor,{x:previousX,z:previousZ,yaw:enemy.mesh.rotation.y},{x:playerChar.mesh.position.x,z:playerChar.mesh.position.z},detectionRadius,invStats.weightClass==='heavy');
        if(!enemy.isAlive||!senses.active)continue;
        enemy.update(delta * (effects && effects.slow > 0 ? 0.55 : 1), playerChar.mesh.position, detectionRadius, (dmg, attacker) => {
          if (player.isDead || !hasLineOfSight(floor,attacker.mesh.position.x,attacker.mesh.position.z,playerChar.mesh.position.x,playerChar.mesh.position.z)) return;

          const toAttackerX = attacker.mesh.position.x - playerChar.mesh.position.x;
          const toAttackerZ = attacker.mesh.position.z - playerChar.mesh.position.z;
          const facing = toAttackerX * Math.sin(playerChar.mesh.rotation.y) + toAttackerZ * Math.cos(playerChar.mesh.rotation.y) > 0;
          const focus=beltItem(inventory,1);if(!focus) guard(false);
          const hit = incomingHit(combat, dmg, player.fatigue, facing && !attacker.unblockable);
          player.fatigue = Math.min(100, player.fatigue + hit.fatigue);
          if (!hit.parried && hit.damage === 0) return;
          // Идеальное парирование ограничено окном, удержание превращается в блок.
          if (hit.parried) {
            learn('elemental_ward');
            audio.play('parry');
            const parryRes = performParry(player, dmg, focus?.parryType??'both');
            const toAttacker = new THREE.Vector3()
              .subVectors(attacker.mesh.position, playerChar.mesh.position)
              .normalize();
            attacker.takeHit(parryRes.reflectedDamage, toAttacker);feedbackAt(playerChar.mesh.position,'parry',0.02);
            updateHud(hud, player, floor);
            combatText.spawn(playerChar.mesh.position, `🛡️ ${parryRes.reflectedDamage}`, 'parry');
            if(parryRes.reflectedDamage>0) combatText.spawn(attacker.mesh.position, `-${parryRes.reflectedDamage}`, 'damage_enemy');
            encountersUI.showNotification(
              `🛡️ ПАРИРОВАНИЕ! ${parryRes.reflectedDamage>0?`Отражено ${parryRes.reflectedDamage}. `:''}${parryRes.manaGained>0?`+${parryRes.manaGained} эссенции.`:''}`,
            );
          } else {
            // Пропущенный удар когтей Сильвана
            audio.play('hurt');feedbackAt(playerChar.mesh.position,'hurt',0.035);
            const dmgRes = applyDamage(player, hit.damage, calculateInventoryStats(inventory).totalArmor);
            if(dmgRes.actualDamage>0&&attacker.coreDamage>0) {damageAetherCore(player,attacker.coreDamage);combatText.spawn(playerChar.mesh.position,`ЯДРО -${attacker.coreDamage}`,'damage_player');}
            if (damageFragileRelics(inventory, dmgRes.actualDamage)) invView.render();
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
        },senses);
        {
          const dx=enemy.mesh.position.x-previousX,dz=enemy.mesh.position.z-previousZ;
          const next = wasStaggered?moveOnFloor(floor,previousX,previousZ,dx,dz):moveEnemyOnFloor(floor,previousX,previousZ,dx,dz,enemy.id,enemy.navigationTarget);
          enemy.mesh.position.x = next.x; enemy.mesh.position.z = next.z;
        }
      }
    }

    collectEnemyRewards();

    if(meltdownSavePending) {meltdownSavePending=false;void saveCurrentRun();}

    for (const drop of groundDrops) {
      drop.mesh.rotation.y += delta;
      drop.mesh.position.y = 0.65 + Math.sin(now * 0.002 + drop.mesh.id) * 0.12;
    }

    world.materials.waterNormal.offset.x += delta * 0.008;
    world.materials.waterNormal.offset.y += delta * 0.003;

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

    combatEffects.update(delta);

    // Обновление всплывающих 3D-чисел урона и лечения в пространстве камеры
    combatText.update(camera, now);

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);

  // Снимок доступен инструментам проверки и не содержит средств изменения состояния.
  (window as unknown as Record<string, unknown>).render_game_to_text = () => JSON.stringify({
    coordinates: 'x вправо по карте, z вниз; метры',
    mode: player.isDead ? 'dead' : runFinalized ? 'victory' : floorFinalized ? 'floor_complete' : isTacticalPause ? 'paused' : invView.isOpen ? 'inventory' : 'playing',
    floor: player.currentFloor,
    seed: runSeed,
    player: { x: playerChar.mesh.position.x, z: playerChar.mesh.position.z, hp: player.hp, trauma: player.greyHp, heat: player.aetherHeat, core: player.aetherCore, fatigue: player.fatigue, threads: player.threadsOfFate, light: player.lightSupply },
    enemies: enemies.filter((enemy) => enemy.isAlive).map((enemy) => ({ id: enemy.id, hp: enemy.hp, x: enemy.mesh.position.x, z: enemy.mesh.position.z, action: enemy.aiState, heavyAttack: enemy.unblockable, kind:enemy.kind, name:enemy.name })),
    inventory: Array.from(inventory.items.values()).map((item) => ({ id: item.id, name: item.name, category: item.category, damage:item.damage, durability:item.durability, parryType:item.parryType, severed:item.isSevered, burn:item.burnTime, poison:item.poisonTime })),
    rooms:floor.rooms.filter(room=>room.isRevealed).map(room=>({id:room.id,visited:room.isVisited,unlocked:room.unlocked,devastated:room.devastated})),
    objective:chapterObjective(floor,enemies.filter(enemy=>enemy.isAlive).length,enemies.some(enemy=>enemy.isAlive&&enemy.id.startsWith('warden_')),meta.codex.includes('sylvan_ciphers')),
    drops: groundDrops.map((drop) => ({ name: drop.item.name, x: drop.mesh.position.x, z: drop.mesh.position.z })),
    healing: healing ? { remaining: healing.remaining } : null,
    steam: { ...steam },
    oracle: { status: oracleState.status, remaining: oracleState.remaining, nodes: oracleState.nodes },
    score: calculateScore(player),
  });

  function finishOracle(): void {
    oracle.ghost.visible = false;
    setNightmare(false);
    for (const node of oracle.nodes) node.visible = false;
    if (oracleState.status === 'won') {
      learn('true_sight');
      player.score += 100;
      player.aetherCore = Math.min(100, player.aetherCore + 25);
      tryAddItem({ id: `oracle_scroll_${player.currentFloor}`, name: 'Свиток эфирного покоя', category: 'scroll', rarity: 'holy', element: 'aether', shape: [{ x: 0, y: 0 }], weight: 0.4, rotation: 0 });
      tryAddItem(oracleFocus(player.currentFloor));
      encountersUI.showNotification('🔮 Споровая связь разорвана. Оракул оставил свиток и фокус (+100 очков).');
    } else {
      damageAetherCore(player, 30);
      applyDamage(player, 20); player.aetherHeat = Math.min(100, player.aetherHeat + 20);
      encountersUI.showNotification('🔮 Кошмар отступил ценой здоровья и перегрева.');
      if (player.isDead) void triggerDeath();
    }
    updateHud(hud, player, floor);
    if (!player.isDead) void saveCurrentRun();
  }
  function showTitle(continuing: boolean): void {
    if (invView.isOpen) { invView.close(); playerChar.setBrowsing(false); }
    isTacticalPause = true;
    keys.forward = keys.backward = keys.left = keys.right = keys.shift = false;
    touch.release();
    document.exitPointerLock();
    bossPanel.hidden = true;
    encountersUI.showStartMenu(continuing, () => {
      isTacticalPause = false;
      lastTime = performance.now();
      canvas.focus();
      audio.unlock();
      lockPointer();
    }, () => { audio.unlock(); restartGame(); }, () => {
      audio.setMuted(!audio.muted);
      if (!audio.muted) audio.unlock();
      void saveWriter.save('settings', { muted: audio.muted }).catch(() => undefined);
      return audio.muted;
    }, audio.muted, { ...meta, floor:player.currentFloor, objective:chapterObjective(floor,enemies.filter(enemy=>enemy.isAlive).length,enemies.some(enemy=>enemy.isAlive&&enemy.id.startsWith('warden_')),meta.codex.includes('sylvan_ciphers')) });
  }
  // Камера меню смотрит в стартовый зал ещё до первого игрового кадра.
  camera.position.set(-3, 3, -5);
  camera.lookAt(playerChar.mesh.position.x, 1, playerChar.mesh.position.z);
  showTitle(isRunRestored);
  session.ready();
}

void main().catch((error: unknown) => {
  console.error('Не удалось запустить Rogue Destiny:', error);
  const notice = document.createElement('section'); notice.className = 'launch-error'; notice.setAttribute('role', 'alert');
  const title = document.createElement('h1'); title.textContent = 'Крипты пока недоступны';
  const message = document.createElement('p'); message.textContent = 'Не удалось запустить игру. Обновите страницу или попробуйте браузер с поддержкой WebGL.';
  const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Попробовать снова'; reload.addEventListener('click', () => location.reload());
  notice.append(title, message, reload); document.body.appendChild(notice);
});
