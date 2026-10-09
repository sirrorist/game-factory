import {
  HERO_CONFIG,
  MOB_CONFIGS,
  WAVE_SCHEDULE,
  MAX_MOBS_DESKTOP,
  MAX_MOBS_TOUCH,
  getMobHpMultiplier,
  getRequiredExp,
  getGemTypeForExp,
  WEAPON_CONFIGS,
  type MobType,
  type WeaponType,
} from './content.ts';
import { getWeaponCooldown, getFlatMightBonus } from './upgrades.ts';
import type { Obstacle } from './movement.ts';

export function getMobHeight(type: MobType): number {
  switch (type) {
    case 'mushlet':
      return 0.45;
    case 'ram_beetle':
      return 0.65;
    case 'spit_owl':
      return 0.65;
    case 'old_stump':
      return 2.4;
  }
}

export interface WeaponState {
  id: WeaponType;
  level: number;
  cooldownTimer: number;
}


export interface DamageParams {
  baseDamage: number;
  weaponLevelBonus: number;
  mightTomeBonus: number;
  itemDamageMultiplier: number;
  isCrit: boolean;
  isOvercrit?: boolean;
}

export interface CritRollResult {
  isCrit: boolean;
  isOvercrit: boolean;
  multiplier: number;
}

/**
 * Ролл крита и оверкрита по правилам Megabonk (DESIGN.md, раздел 5.3):
 * - При шансе крита <= 100% (1.0): стандартный ролл (множитель ×2.0 при успехе).
 * - При шансе крита > 100% (1.0): базовый крит гарантирован (×2.0),
 *   а остаток шанса (critChance - 1.0) даёт шанс оранжевого супер-крита (×3.0).
 */
export function rollCrit(critChance: number, rnd: () => number = Math.random): CritRollResult {
  if (critChance <= 0) {
    return { isCrit: false, isOvercrit: false, multiplier: 1.0 };
  }
  if (critChance <= 1.0) {
    const isCrit = rnd() < critChance;
    return {
      isCrit,
      isOvercrit: false,
      multiplier: isCrit ? 2.0 : 1.0,
    };
  }
  const overcritChance = critChance - 1.0;
  const isOvercrit = rnd() < overcritChance;
  return {
    isCrit: true,
    isOvercrit,
    multiplier: isOvercrit ? 3.0 : 2.0,
  };
}

/**
 * Расчёт урона по формуле DESIGN.md (раздел 5.2 и 5.3):
 * (база оружия + уровень оружия + фолиант силы) × множители предметов × крит (×2 или оверкрит ×3).
 */
export function calculateDamage(params: DamageParams): number {
  const flatSum = params.baseDamage + params.weaponLevelBonus + params.mightTomeBonus;
  const withItems = flatSum * Math.max(0, params.itemDamageMultiplier);
  let critMult = 1.0;
  if (params.isOvercrit) {
    critMult = 3.0;
  } else if (params.isCrit) {
    critMult = 2.0;
  }
  const total = withItems * critMult;
  return Math.round(total);
}

/** Получение целевого числа мобов на карте по таймеру забега */
export function getWaveTargetCount(runTimeSec: number, isTouch = false): number {
  const cap = isTouch ? MAX_MOBS_TOUCH : MAX_MOBS_DESKTOP;
  const time = Math.max(0, runTimeSec);

  for (const wave of WAVE_SCHEDULE) {
    if (time >= wave.startSec && time < wave.endSec) {
      const progress = (time - wave.startSec) / Math.max(1, wave.endSec - wave.startSec);
      const target = wave.startTarget + progress * (wave.endTarget - wave.startTarget);
      return Math.min(cap, Math.round(target));
    }
  }

  // После расписания (12+ минут) - финальная волна на пределе 100 мобов
  return Math.min(cap, 100);
}

/** Получение доступных типов мобов для текущего времени */
export function getAvailableMobTypes(runTimeSec: number): readonly MobType[] {
  const time = Math.max(0, runTimeSec);
  for (const wave of WAVE_SCHEDULE) {
    if (time >= wave.startSec && time < wave.endSec) {
      return wave.types;
    }
  }
  return ['mushlet', 'ram_beetle', 'spit_owl'];
}

export interface MobEntity {
  id: number;
  type: MobType;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  damage: number;
  exp: number;
  /** Поведение: ходьба, телеграф атаки (мигание), рывок, перезарядка */
  state: 'walk' | 'telegraph' | 'charge' | 'cooldown';
  stateTimer: number;
  chargeDirX: number;
  chargeDirZ: number;
  shootCooldown: number;
  /** Таймер удара корнями босса (раз в 6.0 с, DESIGN.md) */
  rootAttackCooldown?: number;
  /** Таймер призыва 6 грибышей боссом (раз в 12.0 с, DESIGN.md) */
  minionSummonCooldown?: number;
  /** Фаза ярости босса при HP < 50% */
  isEnraged?: boolean;
}

export interface ExpGemEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  value: number;
  type: 'small' | 'medium' | 'large';
  flying: boolean;
}

export interface ProjectileEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  damage: number;
  radius: number;
  lifeSec: number;
}

export interface HeroProjectileEntity {
  id: number;
  weaponId: WeaponType;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  radius: number;
  lifeSec: number;
  isCrit?: boolean;
  isOvercrit?: boolean;
}

export interface TelegraphBeamEntity {
  id: number;
  owlId: number;
  startX: number;
  startY: number;
  startZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  length: number;
  timer: number;
  maxTimer: number;
  damage: number;
}

export interface DamagePopupEvent {
  x: number;
  y: number;
  z: number;
  damage: number;
  isCrit: boolean;
  isOvercrit?: boolean;
  isHero: boolean;
}

export interface CombatState {
  mobs: MobEntity[];
  gems: ExpGemEntity[];
  projectiles: ProjectileEntity[];
  heroProjectiles: HeroProjectileEntity[];
  beams: TelegraphBeamEntity[];
  weapons: WeaponState[];
  hasteLevel: number;
  mightLevel: number;
  pendingLevelUps: number;
  nextMobId: number;
  nextGemId: number;
  nextProjId: number;
  nextHeroProjId: number;
  nextBeamId: number;
  heroHp: number;
  heroMaxHp: number;
  heroLevel: number;
  heroExp: number;
  heroIFrameSec: number;
  kills: number;
  // --- Эффекты предметов (DESIGN.md, раздел 5.3) ---
  itemDamageMultiplier: number;
  critChance: number;
  regenHpPerSec: number;
  healOnKill: number;
  honeycombTokens: number;
  mirrorBarkCooldownSec: number;
  mirrorBarkBaseCooldown: number;
  mirrorBarkReady: boolean;
  hasMirrorBark: boolean;
  stormBeadCount: number;
  ninthTailAttackCount: number;
  hasNinthTail: boolean;
  phoenixDownCharges: number;
  /** Повержен ли босс Старый Пень */
  bossDefeated: boolean;
}

export function createInitialCombatState(): CombatState {
  return {
    mobs: [],
    gems: [],
    projectiles: [],
    heroProjectiles: [],
    beams: [],
    weapons: [
      {
        id: 'tail_blade',
        level: 1,
        cooldownTimer: 0.3,
      },
    ],
    hasteLevel: 0,
    mightLevel: 0,
    pendingLevelUps: 0,
    nextMobId: 1,
    nextGemId: 1,
    nextProjId: 1,
    nextHeroProjId: 1,
    nextBeamId: 1,
    heroHp: HERO_CONFIG.maxHp,
    heroMaxHp: HERO_CONFIG.maxHp,
    heroLevel: 1,
    heroExp: 0,
    heroIFrameSec: 0,
    kills: 0,
    itemDamageMultiplier: 1.0,
    critChance: 0.0,
    regenHpPerSec: 0.0,
    healOnKill: 0,
    honeycombTokens: 10.0,
    mirrorBarkCooldownSec: 0.0,
    mirrorBarkBaseCooldown: 10.0,
    mirrorBarkReady: false,
    hasMirrorBark: false,
    stormBeadCount: 0,
    ninthTailAttackCount: 0,
    hasNinthTail: false,
    phoenixDownCharges: 0,
    bossDefeated: false,
  };
}

/**
 * Спавн моба кольцом вокруг героя (дистанция 18..24 м, DESIGN.md)
 */
export function spawnMobInRing(
  state: CombatState,
  heroX: number,
  heroZ: number,
  type: MobType,
  runTimeSec: number,
  rnd: () => number = Math.random,
): MobEntity {
  // Босс Старый Пень спавнится строго в единственном экземпляре
  if (type === 'old_stump') {
    const existingBoss = state.mobs.find((m) => m.type === 'old_stump');
    if (existingBoss) return existingBoss;
  }

  const cfg = MOB_CONFIGS[type];
  const hpMult = getMobHpMultiplier(runTimeSec);
  const hp = Math.round(cfg.baseHp * hpMult);

  const angle = rnd() * Math.PI * 2;
  // Дистанция строго в кольце 18..24 м
  const dist = 18.0 + rnd() * 6.0;
  let x = heroX + Math.cos(angle) * dist;
  let z = heroZ + Math.sin(angle) * dist;

  // Безопасный спавн строго внутри активной арены (R <= 58.0 м при арене 60.0 м)
  const MAX_SPAWN_RADIUS = 58.0;
  if (Math.hypot(x, z) > MAX_SPAWN_RADIUS) {
    // Если точка спавна выходит за границы арены (герой у края карты):
    // Направляем спавн от героя в сторону центра поляны (0, 0)
    const toCenterAngle = Math.atan2(-heroZ, -heroX);
    // Случайный сектор ±60° в сторону центра поляны
    const inwardAngle = toCenterAngle + (rnd() - 0.5) * (Math.PI * 0.66);
    x = heroX + Math.cos(inwardAngle) * dist;
    z = heroZ + Math.sin(inwardAngle) * dist;

    // Гарантированный кламп внутри арены
    const distFromCenter = Math.hypot(x, z);
    if (distFromCenter > MAX_SPAWN_RADIUS) {
      x = (x / distFromCenter) * MAX_SPAWN_RADIUS;
      z = (z / distFromCenter) * MAX_SPAWN_RADIUS;
    }
  }

  const mob: MobEntity = {
    id: state.nextMobId++,
    type,
    x,
    y: 0,
    z,
    hp,
    maxHp: hp,
    speed: cfg.speed,
    radius: cfg.radius,
    damage: cfg.damage,
    exp: cfg.exp,
    state: 'walk',
    stateTimer: 0,
    chargeDirX: 0,
    chargeDirZ: 0,
    shootCooldown: 1.0 + rnd() * 1.5,
  };

  state.mobs.push(mob);
  return mob;
}

export type AttackType = WeaponType | 'ninth_tail' | 'storm_bead';

export interface AttackEvent {
  weaponId: AttackType;
  x: number;
  z: number;
  facingYaw: number;
  hits: number;
}

export interface BossRootAttackEvent {
  x: number;
  y: number;
  z: number;
  radius: number;
  timer: number;
  isSlam: boolean;
}

export interface StepCombatResult {
  leveledUp: boolean;
  pendingLevelUps: number;
  damageDealtToHero: number;
  gemsCollected: number;
  attacks: AttackEvent[];
  damagePopups: DamagePopupEvent[];
  bossAlive: boolean;
  bossHp: number | null;
  bossMaxHp: number | null;
  bossDefeated?: boolean;
  bossRootAttack?: BossRootAttackEvent | null;
  shieldBlocked?: boolean;
  revivedByPhoenix?: boolean;
  heroPushX?: number;
  heroPushZ?: number;
}

/**
 * Расчёт опорной поверхности под мобом с учётом покатых валунов арены.
 */
export function getMobSurfaceHeight(
  x: number,
  z: number,
  mobRadius: number,
  obstacles: readonly Obstacle[] = [],
  getGroundHeight: (x: number, z: number) => number = () => 0,
): number {
  let surfaceY = getGroundHeight(x, z);
  for (const obs of obstacles) {
    const obsHeight = obs.height ?? 1.2;
    if (obsHeight < 3.0) {
      const mDist = Math.hypot(x - obs.x, z - obs.z);
      const maxReach = obs.radius + mobRadius * 0.4;
      if (mDist < maxReach) {
        const u = Math.min(1.0, mDist / maxReach);
        const domeH = obsHeight * Math.sqrt(Math.max(0, 1 - u * u));
        const rockY = getGroundHeight(obs.x, obs.z) + domeH;
        if (rockY > surfaceY) {
          surfaceY = rockY;
        }
      }
    }
  }
  return surfaceY;
}

/**
 * Шаг симуляции мобов, снарядов, опыта и столкновений с героем.
 */
export function stepCombat(
  state: CombatState,
  heroX: number,
  heroY: number,
  heroZ: number,
  dt: number,
  heroFacingYaw = 0,
  pickupRadius = HERO_CONFIG.pickupRadius,
  getGroundHeight: (x: number, z: number) => number = () => 0,
  rnd: () => number = Math.random,
  obstacles: readonly Obstacle[] = [],
  arenaRadius = 60.0,
): StepCombatResult {
  const safeDt = Math.min(Math.max(dt, 0), 0.05);
  let damageDealtToHero = 0;
  let gemsCollected = 0;
  let leveledUp = false;
  let bossRootAttack: BossRootAttackEvent | null = null;
  const damagePopups: DamagePopupEvent[] = [];

  if (state.heroIFrameSec > 0) {
    state.heroIFrameSec = Math.max(0, state.heroIFrameSec - safeDt);
  }

  // Пассивная регенерация здоровья (Лопух, burdock)
  if (state.regenHpPerSec > 0 && state.heroHp < state.heroMaxHp) {
    state.heroHp = Math.min(state.heroMaxHp, state.heroHp + state.regenHpPerSec * safeDt);
  }

  // Пополнение токенов вампиризма Сот (honeycomb: Token Bucket до 10 токенов/с, ERR-09)
  state.honeycombTokens = Math.min(10.0, state.honeycombTokens + safeDt * 10.0);

  // Перезарядка щита Зеркальной коры (mirror_bark, раз в 10 с)
  if (state.hasMirrorBark && !state.mirrorBarkReady) {
    state.mirrorBarkCooldownSec -= safeDt;
    if (state.mirrorBarkCooldownSec <= 0) {
      state.mirrorBarkReady = true;
    }
  }

  // 1. Поведение и перемещение мобов
  for (const mob of state.mobs) {
    const dx = heroX - mob.x;
    const dz = heroZ - mob.z;
    const dist = Math.hypot(dx, dz);

    if (mob.type === 'mushlet') {
      // Грибыш: идёт прямо на героя
      if (dist > 0.001) {
        mob.x += (dx / dist) * mob.speed * safeDt;
        mob.z += (dz / dist) * mob.speed * safeDt;
      }
    } else if (mob.type === 'ram_beetle') {
      // Жук-таран: останавливается, мигает 0.6 с, затем рывок 9 м/с
      if (mob.state === 'walk') {
        if (dist > 0.001) {
          mob.x += (dx / dist) * mob.speed * safeDt;
          mob.z += (dz / dist) * mob.speed * safeDt;
        }
        if (dist < 10.0) {
          mob.state = 'telegraph';
          mob.stateTimer = 0.6;
          mob.chargeDirX = dist > 0.001 ? dx / dist : 0;
          mob.chargeDirZ = dist > 0.001 ? dz / dist : 1;
        }
      } else if (mob.state === 'telegraph') {
        mob.stateTimer -= safeDt;
        if (mob.stateTimer <= 0) {
          mob.state = 'charge';
          mob.stateTimer = 0.8; // длительность рывка
        }
      } else if (mob.state === 'charge') {
        mob.stateTimer -= safeDt;
        const chargeSpeed = 9.0;
        mob.x += mob.chargeDirX * chargeSpeed * safeDt;
        mob.z += mob.chargeDirZ * chargeSpeed * safeDt;
        if (mob.stateTimer <= 0) {
          mob.state = 'cooldown';
          mob.stateTimer = 1.6;
        }
      } else if (mob.state === 'cooldown') {
        mob.stateTimer -= safeDt;
        if (mob.stateTimer <= 0) {
          mob.state = 'walk';
        }
      }
    } else if (mob.type === 'spit_owl') {
      // Плевун-совёнок: держит дистанцию 9..12 м, стреляет хитскан-лучом раз в 3.0 с
      if (dist < 9.0) {
        if (dist > 0.001) {
          mob.x -= (dx / dist) * mob.speed * safeDt;
          mob.z -= (dz / dist) * mob.speed * safeDt;
        }
      } else if (dist > 12.0) {
        if (dist > 0.001) {
          mob.x += (dx / dist) * mob.speed * safeDt;
          mob.z += (dz / dist) * mob.speed * safeDt;
        }
      }

      mob.shootCooldown -= safeDt;
      if (mob.shootCooldown <= 0 && dist < 16.0) {
        mob.shootCooldown = 3.0;
        // Запуск прицельного телеграфного луча на 1.5 с в честном 3D (учитываем Y совёнка и лиса)
        const startX = mob.x;
        const startY = mob.y + 0.6;
        const startZ = mob.z;
        const targetY = heroY + 0.45;
        const bdx = heroX - startX;
        const bdy = targetY - startY;
        const bdz = heroZ - startZ;
        const dist3D = Math.hypot(bdx, bdy, bdz);
        if (dist3D > 0.001) {
          state.beams.push({
            id: state.nextBeamId++,
            owlId: mob.id,
            startX,
            startY,
            startZ,
            dirX: bdx / dist3D,
            dirY: bdy / dist3D,
            dirZ: bdz / dist3D,
            length: 18.0,
            timer: 1.5,
            maxTimer: 1.5,
            damage: mob.damage,
          });
        }
      }
    } else if (mob.type === 'old_stump') {
      // Инициализируем кулдауны способностей босса
      if (mob.rootAttackCooldown === undefined) mob.rootAttackCooldown = 6.0;
      if (mob.minionSummonCooldown === undefined) mob.minionSummonCooldown = 12.0;

      // Фаза ярости: при HP < 50% скорость возрастает на +30% (DESIGN.md, раздел 5.4)
      const isEnraged = mob.hp < mob.maxHp * 0.5;
      mob.isEnraged = isEnraged;
      const effectiveSpeed = isEnraged ? mob.speed * 1.30 : mob.speed;

      // Медленно шагает к герою
      if (dist > 0.001) {
        mob.x += (dx / dist) * effectiveSpeed * safeDt;
        mob.z += (dz / dist) * effectiveSpeed * safeDt;
      }

      // Способность 1: Удар корнями по кругу 5.0 м раз в 6.0 с с телеграфом 1.0 с
      mob.rootAttackCooldown -= safeDt;
      if (mob.rootAttackCooldown <= 1.0 && mob.rootAttackCooldown > 0) {
        // Телеграф-предупреждение
        bossRootAttack = {
          x: mob.x,
          y: mob.y,
          z: mob.z,
          radius: 5.0,
          timer: mob.rootAttackCooldown,
          isSlam: false,
        };
      } else if (mob.rootAttackCooldown <= 0) {
        // Удар корнями!
        bossRootAttack = {
          x: mob.x,
          y: mob.y,
          z: mob.z,
          radius: 5.0,
          timer: 0,
          isSlam: true,
        };

        // Проверка попадания по герою в радиусе 5.0 м
        const heroGroundY = getGroundHeight(heroX, heroZ);
        const heightAboveGround = heroY - heroGroundY;
        const xzDist = Math.hypot(heroX - mob.x, heroZ - mob.z);
        // Честный 3D: если лис прыгнул выше 1.2 м над землёй, корни проходят под ним!
        if (xzDist <= 5.0 && heightAboveGround < 1.2 && state.heroIFrameSec <= 0) {
          damageDealtToHero += 20;
          state.heroIFrameSec = 0.8;
          damagePopups.push({
            x: heroX,
            y: heroY + 0.8,
            z: heroZ,
            damage: 20,
            isCrit: false,
            isHero: true,
          });
        }
        mob.rootAttackCooldown = 6.0;
      }

      // Способность 2: Призыв 6 грибышей раз в 12.0 с
      mob.minionSummonCooldown -= safeDt;
      if (mob.minionSummonCooldown <= 0) {
        mob.minionSummonCooldown = 12.0;
        const mushletCfg = MOB_CONFIGS.mushlet;
        for (let k = 0; k < 6; k++) {
          const sAngle = (k / 6) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
          const sDist = 2.5 + rnd() * 1.5;
          const sx = mob.x + Math.cos(sAngle) * sDist;
          const sz = mob.z + Math.sin(sAngle) * sDist;
          state.mobs.push({
            id: state.nextMobId++,
            type: 'mushlet',
            x: sx,
            y: getGroundHeight(sx, sz),
            z: sz,
            hp: mushletCfg.baseHp,
            maxHp: mushletCfg.baseHp,
            speed: mushletCfg.speed,
            radius: mushletCfg.radius,
            damage: mushletCfg.damage,
            exp: mushletCfg.exp,
            state: 'walk',
            stateTimer: 0,
            chargeDirX: 0,
            chargeDirZ: 0,
            shootCooldown: 0,
          });
        }
      }
    }

    // 1.1. Коллизии моба с препятствиями (камни, деревья)
    for (const obs of obstacles) {
      const obsHeight = obs.height ?? 1.2;
      const obsGroundY = getGroundHeight(obs.x, obs.z);

      // Отвесные монолитные преграды (стволы деревьев, граничные скалы) блокируют движение
      if (obsHeight >= 3.0) {
        const obsTopY = obsGroundY + obsHeight;
        const mobHeight = getMobHeight(mob.type);

        if (mob.y < obsTopY && (mob.y + mobHeight) > obsGroundY) {
          const minDist = obs.radius + mob.radius;
          const mdx = mob.x - obs.x;
          const mdz = mob.z - obs.z;
          const distSq = mdx * mdx + mdz * mdz;

          if (distSq < minDist * minDist && distSq > 0.00001) {
            const mDist = Math.sqrt(distSq);
            const overlap = minDist - mDist;
            const nx = mdx / mDist;
            const nz = mdz / mDist;
            mob.x += nx * overlap;
            mob.z += nz * overlap;

            // Касательный обход препятствий (Obstacle Steering / Slide, ERR-18):
            // Мобильная сущность не застревает в лоб, а скользит вдоль ствола в сторону героя
            const toHeroX = heroX - mob.x;
            const toHeroZ = heroZ - mob.z;
            const toHeroDist = Math.hypot(toHeroX, toHeroZ);
            if (toHeroDist > 0.001) {
              const hx = toHeroX / toHeroDist;
              const hz = toHeroZ / toHeroDist;
              // Скалярное произведение направления на героя и нормали к препятствию
              const dotN = hx * nx + hz * nz;
              if (dotN < 0.5) {
                // Вектор касательной t = (-nz, nx)
                const dotT = hx * (-nz) + hz * nx;
                const sign = dotT >= 0 ? 1 : -1;
                const tx = -nz * sign;
                const tz = nx * sign;
                mob.x += tx * mob.speed * safeDt * 1.25;
                mob.z += tz * mob.speed * safeDt * 1.25;
              }
            }

            // Жук-таран в фазе рывка врезается в дерево/скалу и останавливается в перезарядку
            if (mob.type === 'ram_beetle' && mob.state === 'charge') {
              mob.state = 'cooldown';
              mob.stateTimer = 1.6;
            }
          }
        }
      }
    }

    // 1.2. Ограничение границ арены для мобов (единая граница Megabonk, без искусственных стен перед героем)
    if (arenaRadius > 0) {
      const distArena = Math.hypot(mob.x, mob.z);
      if (distArena > arenaRadius) {
        mob.x = (mob.x / distArena) * arenaRadius;
        mob.z = (mob.z / distArena) * arenaRadius;
      }
    }

    // Обновляем высоту моба по рельефу и покатым камням арены (карабканье мобов, ликвидация абуза)
    mob.y = getMobSurfaceHeight(mob.x, mob.z, mob.radius, obstacles, getGroundHeight);

    // 1.3. Честный урон касанием по герою в 3D
    // Урон наносится только если:
    // а) цилиндр героя [heroY, heroY + 0.9] и цилиндр моба [mob.y, mob.y + mobHeight] пересекаются по Y
    // б) горизонтальное расстояние меньше суммы радиусов
    // в) для жука-тарана: только во время рывка (charge)
    const mobHeight = getMobHeight(mob.type);
    const isVerticalOverlap = heroY < (mob.y + mobHeight) && (heroY + 0.9) > mob.y;
    const distXZ = Math.hypot(heroX - mob.x, heroZ - mob.z);
    const canDamageHero =
      mob.type === 'ram_beetle' ? mob.state === 'charge' : mob.type !== 'spit_owl';

    if (canDamageHero && isVerticalOverlap && distXZ < mob.radius + 0.45 && state.heroIFrameSec <= 0) {
      damageDealtToHero += mob.damage;
      state.heroIFrameSec = mob.type === 'old_stump' ? 0.8 : 0.6;
      damagePopups.push({
        x: heroX,
        y: heroY + 0.8,
        z: heroZ,
        damage: mob.damage,
        isCrit: false,
        isHero: true,
      });

      // При попадании по герою жук-таран завершает рывок
      if (mob.type === 'ram_beetle' && mob.state === 'charge') {
        mob.state = 'cooldown';
        mob.stateTimer = 1.6;
      }
    }
  }

  // 1.5. Взаимное расталкивание мобов (Separation push-out) и коллизии с героем
  let heroPushX = 0;
  let heroPushZ = 0;
  const heroRadius = 0.45;
  const mobCount = state.mobs.length;

  for (let i = 0; i < mobCount; i++) {
    const m1 = state.mobs[i]!;

    // Взаимное расталкивание между парами мобов (предотвращает слипание врагов в одну точку)
    for (let j = i + 1; j < mobCount; j++) {
      const m2 = state.mobs[j]!;
      const dx = m1.x - m2.x;
      const dz = m1.z - m2.z;
      const minDist = m1.radius + m2.radius;
      const distSq = dx * dx + dz * dz;

      if (distSq < minDist * minDist && distSq > 0.00001) {
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;

        if (m1.type === 'old_stump') {
          // Босс монолитен: рядовой враг отталкивается на всю величину
          m2.x -= nx * overlap;
          m2.z -= nz * overlap;
        } else if (m2.type === 'old_stump') {
          m1.x += nx * overlap;
          m1.z += nz * overlap;
        } else {
          // Рядовые враги расталкиваются поровну
          const push = overlap * 0.5;
          m1.x += nx * push;
          m1.z += nz * push;
          m2.x -= nx * push;
          m2.z -= nz * push;
        }
      }
    }

    // Коллизия с героем: выталкивание героя наружу (не даёт проходить сквозь босса и мобов на земле)
    // Действует ТОЛЬКО если герой и моб пересекаются по вертикали!
    const m1Height = getMobHeight(m1.type);
    const isVerticalOverlapWithHero = heroY < (m1.y + m1Height) && (heroY + 0.9) > m1.y;

    if (isVerticalOverlapWithHero) {
      const hdx = heroX - m1.x;
      const hdz = heroZ - m1.z;
      const heroMinDist = m1.radius + heroRadius;
      const hDistSq = hdx * hdx + hdz * hdz;

      if (hDistSq < heroMinDist * heroMinDist && hDistSq > 0.00001) {
        const hDist = Math.sqrt(hDistSq);
        const hOverlap = heroMinDist - hDist;
        const hnx = hdx / hDist;
        const hnz = hdz / hDist;

        if (m1.type === 'old_stump') {
          // Босс монолитен: герой полностью выталкивается по нормали
          heroPushX += hnx * hOverlap;
          heroPushZ += hnz * hOverlap;
        } else {
          // Рядовой моб: мягкое разделение
          const push = hOverlap * 0.5;
          heroPushX += hnx * push;
          heroPushZ += hnz * push;
          m1.x -= hnx * push;
          m1.z -= hnz * push;
        }
      }
    }

    // Обновляем высоту по рельефу и покатым камням арены после расталкивания
    m1.y = getMobSurfaceHeight(m1.x, m1.z, m1.radius, obstacles, getGroundHeight);
  }

  // 2. Телеграфные лучи совят (честный статичный телеграф 1.5 с, каждый попавший луч наносит урон)
  let beamsHitHeroCount = 0;
  for (let i = state.beams.length - 1; i >= 0; i--) {
    const beam = state.beams[i]!;
    beam.timer -= safeDt;

    // Момент выстрела (timer <= 0)
    if (beam.timer <= 0) {
      // Честный 3D-расчёт расстояния от луча до центра тела героя (heroY + 0.45)
      const hx = heroX - beam.startX;
      const hy = (heroY + 0.45) - beam.startY;
      const hz = heroZ - beam.startZ;
      const t = hx * beam.dirX + hy * beam.dirY + hz * beam.dirZ;

      // Проверка препятствий (камней, стволов деревьев) между совёнком и героем
      let isBlockedByObstacle = false;
      for (const obs of obstacles) {
        const obsHeight = obs.height ?? 1.2;
        const obsGroundY = getGroundHeight(obs.x, obs.z);
        const obsTopY = obsGroundY + obsHeight;

        const ox = obs.x - beam.startX;
        const oz = obs.z - beam.startZ;
        const tObs = ox * beam.dirX + oz * beam.dirZ;

        if (tObs > 0 && tObs < t) {
          const ptX = beam.startX + beam.dirX * tObs;
          const ptY = beam.startY + beam.dirY * tObs;
          const ptZ = beam.startZ + beam.dirZ * tObs;
          const distToObs = Math.hypot(obs.x - ptX, obs.z - ptZ);

          if (distToObs < obs.radius && ptY >= obsGroundY && ptY <= obsTopY) {
            isBlockedByObstacle = true;
            break;
          }
        }
      }

      if (!isBlockedByObstacle && t >= 0 && t <= beam.length) {
        const closestX = beam.startX + beam.dirX * t;
        const closestY = beam.startY + beam.dirY * t;
        const closestZ = beam.startZ + beam.dirZ * t;
        const dist3D = Math.hypot(heroX - closestX, (heroY + 0.45) - closestY, heroZ - closestZ);

        // Если лис не подпрыгнул выше луча и не ушёл в сторону (радиус поражения луча 0.55 м)
        // ВАЖНО: одновременный залп нескольких совят не должен глушиться i-frame одного луча!
        if (dist3D < 0.55) {
          damageDealtToHero += beam.damage;
          beamsHitHeroCount++;

          const jitterX = (rnd() - 0.5) * 0.4;
          const jitterY = (rnd() - 0.5) * 0.3;
          damagePopups.push({
            x: heroX + jitterX,
            y: heroY + 0.8 + jitterY,
            z: heroZ,
            damage: beam.damage,
            isCrit: false,
            isHero: true,
          });
        }
      }
      state.beams.splice(i, 1);
    }
  }

  // Защитный i-frame выставляется только ПОСЛЕ того, как все одновременные лучи нанесли урон
  if (beamsHitHeroCount > 0) {
    state.heroIFrameSec = 0.4;
  }

  // 2.5. Предотвращение застревания кристаллов опыта внутри камней и деревьев (только для покоящихся)
  for (const gem of state.gems) {
    if (gem.flying) continue; // Летящие магнитом кристаллы свободно перемещаются в 3D к лису

    for (const obs of obstacles) {
      const obsHeight = obs.height ?? 1.2;
      if (obsHeight >= 3.0) {
        // Стволы деревьев и граничные скалы: выталкиваем кристаллы наружу
        const gdx = gem.x - obs.x;
        const gdz = gem.z - obs.z;
        const gDistSq = gdx * gdx + gdz * gdz;
        const minGemDist = obs.radius + 0.35;
        if (gDistSq < minGemDist * minGemDist) {
          const gDist = Math.sqrt(gDistSq);
          const nx = gDist > 0.0001 ? gdx / gDist : 1;
          const nz = gDist > 0.0001 ? gdz / gDist : 0;
          const gOverlap = minGemDist - gDist;
          gem.x += nx * gOverlap;
          gem.z += nz * gOverlap;
          gem.y = getGroundHeight(gem.x, gem.z) + 0.25;
        }
      }
    }
  }

  const attacks: AttackEvent[] = [];
  const mightBonus = getFlatMightBonus(state.mightLevel);

  // 2b. Движение снарядов героя (spark_sling) в 3D
  for (let i = state.heroProjectiles.length - 1; i >= 0; i--) {
    const hp = state.heroProjectiles[i]!;
    hp.x += hp.vx * safeDt;
    hp.y += hp.vy * safeDt;
    hp.z += hp.vz * safeDt;
    hp.lifeSec -= safeDt;

    let hit = false;
    for (let j = state.mobs.length - 1; j >= 0; j--) {
      const mob = state.mobs[j]!;
      const mobCenterY = mob.y + mob.radius * 0.8;
      const dist3D = Math.hypot(mob.x - hp.x, mobCenterY - hp.y, mob.z - hp.z);
      if (dist3D < hp.radius + mob.radius) {
        mob.hp -= hp.damage;
        damagePopups.push({
          x: mob.x,
          y: mob.y + mob.radius + 0.3,
          z: mob.z,
          damage: hp.damage,
          isCrit: hp.isCrit ?? false,
          isOvercrit: hp.isOvercrit ?? false,
          isHero: false,
        });
        hit = true;
        // Бусина грозы (storm_bead) при попадании снаряда (честный 3D-расчёт)
        triggerStormBead(state, mob.x, mob.y + mob.radius, mob.z, mightBonus, attacks, damagePopups, rnd);
        if (mob.hp <= 0) {
          killMob(state, mob.id);
        }
        break;
      }
    }

    if (hit || hp.lifeSec <= 0) {
      state.heroProjectiles.splice(i, 1);
    }
  }

  // 3. Магнит и сбор кристалликов опыта (честный 3D-расчёт, ERR-06)
  for (let i = state.gems.length - 1; i >= 0; i--) {
    const gem = state.gems[i]!;
    const dx = heroX - gem.x;
    const dy = (heroY + 0.45) - gem.y;
    const dz = heroZ - gem.z;
    const dist3D = Math.hypot(dx, dy, dz);

    if (dist3D < pickupRadius) {
      gem.flying = true;
    }

    if (gem.flying) {
      const flySpeed = 14.0;
      if (dist3D > 0.001) {
        gem.x += (dx / dist3D) * flySpeed * safeDt;
        gem.y += (dy / dist3D) * flySpeed * safeDt;
        gem.z += (dz / dist3D) * flySpeed * safeDt;
      }
      if (dist3D < 0.6) {
        // Подобрали кристалл!
        state.heroExp += gem.value;
        gemsCollected++;
        state.gems.splice(i, 1);

        // Проверка повышения уровня
        while (state.heroExp >= getRequiredExp(state.heroLevel)) {
          state.heroExp -= getRequiredExp(state.heroLevel);
          state.heroLevel++;
          state.pendingLevelUps++;
          leveledUp = true;
        }
      }
    } else {
      let gemSurfaceY = getGroundHeight(gem.x, gem.z);
      for (const obs of obstacles) {
        const obsHeight = obs.height ?? 1.2;
        if (obsHeight < 3.0) {
          const gDist = Math.hypot(gem.x - obs.x, gem.z - obs.z);
          if (gDist < obs.radius) {
            const u = gDist / obs.radius;
            const domeH = obsHeight * Math.sqrt(Math.max(0, 1 - u * u));
            const rY = getGroundHeight(obs.x, obs.z) + domeH;
            if (rY > gemSurfaceY) gemSurfaceY = rY;
          }
        }
      }
      gem.y = gemSurfaceY + 0.25;
    }
  }

  // 4. Автоатака оружия лиса
  for (const w of state.weapons) {
    w.cooldownTimer -= safeDt;
    if (w.cooldownTimer <= 0) {
      const cfg = WEAPON_CONFIGS[w.id];
      const levelIdx = Math.max(0, Math.min(4, w.level - 1));
      const baseDmg = cfg.damageByLevel[levelIdx] ?? 14;
      const cooldown = getWeaponCooldown(cfg.cooldownSec, state.hasteLevel);
      w.cooldownTimer = cooldown;

      if (w.id === 'tail_blade') {
        const range = cfg.rangeByLevel[levelIdx] ?? 2.8;
        const arc = cfg.sectorAngleByLevel ? (cfg.sectorAngleByLevel[levelIdx] ?? ((120 * Math.PI) / 180)) : ((120 * Math.PI) / 180);
        const isCircle = arc >= 2 * Math.PI - 0.01;
        const minDot = isCircle ? -1.0 : Math.cos(arc / 2);
        // Удар исходит сзади лиса (+Z в локальных координатах):
        const bx = Math.sin(heroFacingYaw);
        const bz = Math.cos(heroFacingYaw);
        let hits = 0;
        const critRoll = rollCrit(state.critChance, rnd);

        for (let i = state.mobs.length - 1; i >= 0; i--) {
          const m = state.mobs[i]!;
          const mdx = m.x - heroX;
          const mdy = (m.y + m.radius) - (heroY + 0.45);
          const mdz = m.z - heroZ;
          const distXZ = Math.hypot(mdx, mdz);
          // Честный 3D-расчёт: горизонтальный сектор удара и вертикальный размах ±1.5 м (ERR-06)
          if (distXZ <= range + m.radius && Math.abs(mdy) <= 1.5) {
            const dot = distXZ > 0.001 ? (bx * (mdx / distXZ) + bz * (mdz / distXZ)) : 1;
            if (dot >= minDot) {
              const dmg = calculateDamage({
                baseDamage: baseDmg,
                weaponLevelBonus: 0,
                mightTomeBonus: mightBonus,
                itemDamageMultiplier: state.itemDamageMultiplier,
                isCrit: critRoll.isCrit,
                isOvercrit: critRoll.isOvercrit,
              });
              m.hp -= dmg;
              hits++;
              damagePopups.push({
                x: m.x,
                y: m.y + m.radius + 0.3,
                z: m.z,
                damage: dmg,
                isCrit: critRoll.isCrit,
                isOvercrit: critRoll.isOvercrit,
                isHero: false,
              });
              if (m.hp <= 0) {
                killMob(state, m.id);
              }
            }
          }
        }

        if (hits > 0) {
          triggerStormBead(state, heroX, heroY + 0.45, heroZ, mightBonus, attacks, damagePopups, rnd);
        }

        attacks.push({
          weaponId: 'tail_blade',
          x: heroX,
          z: heroZ,
          facingYaw: heroFacingYaw,
          hits,
        });

        // Девятый хвост (ninth_tail): каждая 5-я атака — огненная волна 4 м на 45 урона
        if (state.hasNinthTail) {
          state.ninthTailAttackCount++;
          if (state.ninthTailAttackCount >= 5) {
            state.ninthTailAttackCount = 0;
            triggerNinthTailWave(state, heroX, heroY, heroZ, heroFacingYaw, mightBonus, attacks, damagePopups, rnd);
          }
        }
      } else if (w.id === 'spark_sling') {
        const range = cfg.rangeByLevel[levelIdx] ?? 16.0;
        const inRangeMobs: Array<{ mob: MobEntity; dist: number }> = [];
        for (const m of state.mobs) {
          const dist = Math.hypot(m.x - heroX, m.z - heroZ);
          if (dist <= range) {
            inRangeMobs.push({ mob: m, dist });
          }
        }
        inRangeMobs.sort((a, b) => a.dist - b.dist);

        // Стреляет только если в радиусе есть хотя бы один враг
        if (inRangeMobs.length > 0) {
          const maxProjs = cfg.projectilesByLevel ? (cfg.projectilesByLevel[levelIdx] ?? 1) : 1;
          // Количество снарядов не превышает количества мобов
          const count = Math.min(maxProjs, inRangeMobs.length);
          const pSpeed = cfg.projSpeed ?? 22.0;
          const critRoll = rollCrit(state.critChance, rnd);

          const dmg = calculateDamage({
            baseDamage: baseDmg,
            weaponLevelBonus: 0,
            mightTomeBonus: mightBonus,
            itemDamageMultiplier: state.itemDamageMultiplier,
            isCrit: critRoll.isCrit,
            isOvercrit: critRoll.isOvercrit,
          });

          const startX = heroX;
          const startY = heroY + 0.6;
          const startZ = heroZ;

          for (let k = 0; k < count; k++) {
            const targetMob = inRangeMobs[k]!.mob;
            const targetY = targetMob.y + (targetMob.radius ?? 0.4);
            const dx = targetMob.x - startX;
            const dy = targetY - startY;
            const dz = targetMob.z - startZ;
            const dist3D = Math.hypot(dx, dy, dz);
            const vx = dist3D > 0.001 ? (dx / dist3D) * pSpeed : 0;
            const vy = dist3D > 0.001 ? (dy / dist3D) * pSpeed : 0;
            const vz = dist3D > 0.001 ? (dz / dist3D) * pSpeed : pSpeed;

            state.heroProjectiles.push({
              id: state.nextHeroProjId++,
              weaponId: 'spark_sling',
              x: startX,
              y: startY,
              z: startZ,
              vx,
              vy,
              vz,
              damage: dmg,
              radius: 0.35,
              lifeSec: 1.2,
              isCrit: critRoll.isCrit,
              isOvercrit: critRoll.isOvercrit,
            });
          }

          attacks.push({
            weaponId: 'spark_sling',
            x: heroX,
            z: heroZ,
            facingYaw: heroFacingYaw,
            hits: count,
          });

          // Девятый хвост (ninth_tail): каждая 5-я атака — огненная волна
          if (state.hasNinthTail) {
            state.ninthTailAttackCount++;
            if (state.ninthTailAttackCount >= 5) {
              state.ninthTailAttackCount = 0;
              triggerNinthTailWave(state, heroX, heroY, heroZ, heroFacingYaw, mightBonus, attacks, damagePopups, rnd);
            }
          }
        }
      }
    }
  }

  // 5. Деспавн мобов, отдалившихся больше чем на 45 м от героя (кроме босса)
  for (let i = state.mobs.length - 1; i >= 0; i--) {
    const m = state.mobs[i]!;
    if (m.type !== 'old_stump' && Math.hypot(heroX - m.x, heroZ - m.z) > 45.0) {
      state.mobs.splice(i, 1);
    }
  }

  // 6. Получение урона героем (с учётом щита Зеркальной коры и воскрешения Феникса)
  let shieldBlocked = false;
  let revivedByPhoenix = false;

  if (damageDealtToHero > 0) {
    if (state.hasMirrorBark && state.mirrorBarkReady) {
      // Зеркальная кора (mirror_bark): поглощает удар целиком, перезарядка со сжатием КД
      state.mirrorBarkReady = false;
      state.mirrorBarkCooldownSec = state.mirrorBarkBaseCooldown ?? 10.0;
      shieldBlocked = true;
      damageDealtToHero = 0;
      // Убираем цифру урона по лису
      for (let pIdx = damagePopups.length - 1; pIdx >= 0; pIdx--) {
        if (damagePopups[pIdx]!.isHero) {
          damagePopups.splice(pIdx, 1);
          break;
        }
      }
    } else if (state.heroHp - damageDealtToHero <= 0 && state.phoenixDownCharges > 0) {
      // Пух феникса (phoenix_down): воскрешение с половиной здоровья (списываем 1 заряд, ERR-08)
      state.phoenixDownCharges--;
      state.heroHp = Math.round(state.heroMaxHp * 0.5);
      state.heroIFrameSec = 2.0; // 2.0 секунды неуязвимости для безопасного выхода из толпы
      revivedByPhoenix = true;
      damageDealtToHero = 0;
      for (let pIdx = damagePopups.length - 1; pIdx >= 0; pIdx--) {
        if (damagePopups[pIdx]!.isHero) {
          damagePopups.splice(pIdx, 1);
          break;
        }
      }
      // Радиальное отталкивание всех мобов в радиусе 7.0 м на 5.0 м назад (ERR-08)
      for (const m of state.mobs) {
        const mdx = m.x - heroX;
        const mdz = m.z - heroZ;
        const d = Math.hypot(mdx, mdz);
        if (d < 7.0) {
          const factor = d > 0.001 ? 5.0 / d : 1.0;
          m.x += d > 0.001 ? mdx * factor : 5.0;
          m.z += d > 0.001 ? mdz * factor : 0.0;
          m.y = getGroundHeight(m.x, m.z);
        }
      }
    } else {
      state.heroHp = Math.max(0, state.heroHp - damageDealtToHero);
    }
  }

  // 7. Информация о боссе для шкалы здоровья внизу экрана
  let bossAlive = false;
  let bossHp: number | null = null;
  let bossMaxHp: number | null = null;
  const boss = state.mobs.find((m) => m.type === 'old_stump');
  if (boss) {
    bossAlive = true;
    bossHp = Math.max(0, Math.ceil(boss.hp));
    bossMaxHp = boss.maxHp;
  }

  return {
    leveledUp,
    pendingLevelUps: state.pendingLevelUps,
    damageDealtToHero,
    gemsCollected,
    attacks,
    damagePopups,
    bossAlive,
    bossHp,
    bossMaxHp,
    bossDefeated: state.bossDefeated,
    bossRootAttack,
    shieldBlocked,
    revivedByPhoenix,
    heroPushX,
    heroPushZ,
  };
}

/**
 * Бусина грозы (storm_bead): 12 % шанс призвать молнию по 3 целям (20 урона) в 3D (ERR-06).
 */
function triggerStormBead(
  state: CombatState,
  originX: number,
  originY: number,
  originZ: number,
  mightBonus: number,
  attacks: AttackEvent[],
  damagePopups: DamagePopupEvent[],
  rnd: () => number,
): void {
  if (state.stormBeadCount <= 0) return;
  const chance = Math.min(0.60, state.stormBeadCount * 0.12);
  if (rnd() >= chance) return;

  const inRange = state.mobs
    .map((m) => ({
      mob: m,
      dist: Math.hypot(m.x - originX, (m.y + m.radius) - originY, m.z - originZ),
    }))
    .filter((entry) => entry.dist <= 12.0)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);

  if (inRange.length === 0) return;

  const critRoll = rollCrit(state.critChance, rnd);
  const isOvercrit = critRoll.isOvercrit;
  const lightningDmg = calculateDamage({
    baseDamage: 20,
    weaponLevelBonus: 0,
    mightTomeBonus: mightBonus,
    itemDamageMultiplier: state.itemDamageMultiplier,
    isCrit: true,
    isOvercrit,
  });

  for (const { mob: m } of inRange) {
    m.hp -= lightningDmg;
    damagePopups.push({
      x: m.x,
      y: m.y + m.radius + 0.3,
      z: m.z,
      damage: lightningDmg,
      isCrit: true,
      isOvercrit,
      isHero: false,
    });
    if (m.hp <= 0) killMob(state, m.id);
  }

  attacks.push({
    weaponId: 'storm_bead',
    x: originX,
    z: originZ,
    facingYaw: 0,
    hits: inRange.length,
  });
}

/**
 * Девятый хвост (ninth_tail): каждая 5-я атака — огненная волна 4 м (45 урона) в 3D (ERR-06).
 */
function triggerNinthTailWave(
  state: CombatState,
  heroX: number,
  heroY: number,
  heroZ: number,
  heroFacingYaw: number,
  mightBonus: number,
  attacks: AttackEvent[],
  damagePopups: DamagePopupEvent[],
  rnd: () => number = Math.random,
): void {
  const waveRadius = 4.0;
  const critRoll = rollCrit(state.critChance, rnd);
  const isOvercrit = critRoll.isOvercrit;
  const waveDmg = calculateDamage({
    baseDamage: 45,
    weaponLevelBonus: 0,
    mightTomeBonus: mightBonus,
    itemDamageMultiplier: state.itemDamageMultiplier,
    isCrit: true,
    isOvercrit,
  });

  let hits = 0;
  const heroCenterY = heroY + 0.45;
  for (let i = state.mobs.length - 1; i >= 0; i--) {
    const m = state.mobs[i]!;
    const mobCenterY = m.y + m.radius;
    const dist3D = Math.hypot(m.x - heroX, mobCenterY - heroCenterY, m.z - heroZ);
    if (dist3D <= waveRadius + m.radius) {
      m.hp -= waveDmg;
      hits++;
      damagePopups.push({
        x: m.x,
        y: m.y + m.radius + 0.3,
        z: m.z,
        damage: waveDmg,
        isCrit: true,
        isOvercrit,
        isHero: false,
      });
      if (m.hp <= 0) killMob(state, m.id);
    }
  }

  attacks.push({
    weaponId: 'ninth_tail',
    x: heroX,
    z: heroZ,
    facingYaw: heroFacingYaw,
    hits,
  });
}

/** Уничтожение моба с выпадением кристалла опыта */
export function killMob(state: CombatState, mobId: number): boolean {
  const idx = state.mobs.findIndex((m) => m.id === mobId);
  if (idx === -1) return false;

  const mob = state.mobs[idx]!;
  state.mobs.splice(idx, 1);
  state.kills++;

  if (mob.type === 'old_stump') {
    state.bossDefeated = true;
  }

  // Эффект Соты (honeycomb): +2 здоровья за убийство (Token Bucket до 10 токенов, ERR-09)
  if (state.healOnKill > 0 && state.honeycombTokens >= 1.0) {
    state.heroHp = Math.min(state.heroMaxHp, state.heroHp + state.healOnKill);
    state.honeycombTokens -= 1.0;
  }

  // Спавн кристаллика опыта на месте гибели моба
  state.gems.push({
    id: state.nextGemId++,
    x: mob.x,
    y: mob.y + 0.2,
    z: mob.z,
    value: mob.exp,
    type: getGemTypeForExp(mob.exp),
    flying: false,
  });

  return true;
}
