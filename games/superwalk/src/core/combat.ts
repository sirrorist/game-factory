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
}

/**
 * Расчёт урона по формуле DESIGN.md (раздел 5.2, строки 104-105):
 * (база оружия + уровень оружия + фолиант силы) × множители предметов × крит (×2).
 */
export function calculateDamage(params: DamageParams): number {
  const flatSum = params.baseDamage + params.weaponLevelBonus + params.mightTomeBonus;
  const withItems = flatSum * Math.max(0, params.itemDamageMultiplier);
  const total = withItems * (params.isCrit ? 2.0 : 1.0);
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
  rnd: () => number,
): MobEntity {
  const cfg = MOB_CONFIGS[type];
  const hpMult = getMobHpMultiplier(runTimeSec);
  const hp = Math.round(cfg.baseHp * hpMult);

  const angle = rnd() * Math.PI * 2;
  // Дистанция строго в кольце 18..24 м
  const dist = 18.0 + rnd() * 6.0;
  const x = heroX + Math.cos(angle) * dist;
  const z = heroZ + Math.sin(angle) * dist;

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

export interface AttackEvent {
  weaponId: WeaponType;
  x: number;
  z: number;
  facingYaw: number;
  hits: number;
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
): StepCombatResult {
  const safeDt = Math.min(Math.max(dt, 0), 0.05);
  let damageDealtToHero = 0;
  let gemsCollected = 0;
  let leveledUp = false;
  const damagePopups: DamagePopupEvent[] = [];

  if (state.heroIFrameSec > 0) {
    state.heroIFrameSec = Math.max(0, state.heroIFrameSec - safeDt);
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
      // Касание героя
      if (dist < mob.radius + 0.45 && state.heroIFrameSec <= 0) {
        damageDealtToHero += mob.damage;
        state.heroIFrameSec = 0.6; // кадры неуязвимости
        damagePopups.push({
          x: heroX,
          y: heroY + 0.8,
          z: heroZ,
          damage: mob.damage,
          isCrit: false,
          isHero: true,
        });
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
        if (dist < mob.radius + 0.45 && state.heroIFrameSec <= 0) {
          damageDealtToHero += mob.damage;
          state.heroIFrameSec = 0.6;
          damagePopups.push({
            x: heroX,
            y: heroY + 0.8,
            z: heroZ,
            damage: mob.damage,
            isCrit: false,
            isHero: true,
          });
        }
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
      // Старый Пень (босс): медленно шагает к герою
      if (dist > 0.001) {
        mob.x += (dx / dist) * mob.speed * safeDt;
        mob.z += (dz / dist) * mob.speed * safeDt;
      }
      if (dist < mob.radius + 0.45 && state.heroIFrameSec <= 0) {
        damageDealtToHero += mob.damage;
        state.heroIFrameSec = 0.8;
        damagePopups.push({
          x: heroX,
          y: heroY + 0.8,
          z: heroZ,
          damage: mob.damage,
          isCrit: false,
          isHero: true,
        });
      }
    }

    mob.y = getGroundHeight(mob.x, mob.z);
  }

  // 2. Телеграфные лучи совят (3 фазы: прицеливание 0..1.1 с, фиксация 1.1..1.5 с, 3D хитскан на 1.5 с)
  for (let i = state.beams.length - 1; i >= 0; i--) {
    const beam = state.beams[i]!;
    beam.timer -= safeDt;

    // Фаза 1 (прицеливание, пока timer > 0.4 с): луч мягко следует за лисом
    if (beam.timer > 0.4) {
      const owl = state.mobs.find((m) => m.id === beam.owlId);
      if (owl) {
        beam.startX = owl.x;
        beam.startY = owl.y + 0.6;
        beam.startZ = owl.z;
        const targetY = heroY + 0.45;
        const bdx = heroX - beam.startX;
        const bdy = targetY - beam.startY;
        const bdz = heroZ - beam.startZ;
        const d3 = Math.hypot(bdx, bdy, bdz);
        if (d3 > 0.001) {
          beam.dirX = bdx / d3;
          beam.dirY = bdy / d3;
          beam.dirZ = bdz / d3;
        }
      }
    }
    // Фаза 2 (timer <= 0.4 с): луч намертво зафиксирован в пространстве — окно для уклонения!

    // Фаза 3: момент выстрела (timer <= 0)
    if (beam.timer <= 0) {
      // Честный 3D-расчёт расстояния от луча до центра тела героя (heroY + 0.45)
      const hx = heroX - beam.startX;
      const hy = (heroY + 0.45) - beam.startY;
      const hz = heroZ - beam.startZ;
      const t = hx * beam.dirX + hy * beam.dirY + hz * beam.dirZ;

      if (t >= 0 && t <= beam.length) {
        const closestX = beam.startX + beam.dirX * t;
        const closestY = beam.startY + beam.dirY * t;
        const closestZ = beam.startZ + beam.dirZ * t;
        const dist3D = Math.hypot(heroX - closestX, (heroY + 0.45) - closestY, heroZ - closestZ);

        // Если лис не подпрыгнул выше луча и не ушёл в сторону (радиус поражения луча 0.55 м)
        if (dist3D < 0.55 && state.heroIFrameSec <= 0) {
          damageDealtToHero += beam.damage;
          state.heroIFrameSec = 0.6;
          damagePopups.push({
            x: heroX,
            y: heroY + 0.8,
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
          isCrit: false,
          isHero: false,
        });
        hit = true;
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

  // 3. Магнит и сбор кристалликов опыта
  for (let i = state.gems.length - 1; i >= 0; i--) {
    const gem = state.gems[i]!;
    const dx = heroX - gem.x;
    const dz = heroZ - gem.z;
    const dist = Math.hypot(dx, dz);

    if (dist < pickupRadius) {
      gem.flying = true;
    }

    if (gem.flying) {
      const flySpeed = 14.0;
      if (dist > 0.001) {
        gem.x += (dx / dist) * flySpeed * safeDt;
        gem.z += (dz / dist) * flySpeed * safeDt;
      }
      if (dist < 0.6) {
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
      gem.y = getGroundHeight(gem.x, gem.z) + 0.25;
    }
  }

  // 4. Автоатака оружия лиса
  const attacks: AttackEvent[] = [];
  const mightBonus = getFlatMightBonus(state.mightLevel);

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

        for (let i = state.mobs.length - 1; i >= 0; i--) {
          const m = state.mobs[i]!;
          const mdx = m.x - heroX;
          const mdz = m.z - heroZ;
          const dist = Math.hypot(mdx, mdz);
          if (dist <= range + m.radius) {
            const dot = dist > 0.001 ? (bx * (mdx / dist) + bz * (mdz / dist)) : 1;
            if (dot >= minDot) {
              const dmg = calculateDamage({
                baseDamage: baseDmg,
                weaponLevelBonus: 0,
                mightTomeBonus: mightBonus,
                itemDamageMultiplier: 1.0,
                isCrit: false,
              });
              m.hp -= dmg;
              hits++;
              damagePopups.push({
                x: m.x,
                y: m.y + m.radius + 0.3,
                z: m.z,
                damage: dmg,
                isCrit: false,
                isHero: false,
              });
              if (m.hp <= 0) {
                killMob(state, m.id);
              }
            }
          }
        }

        attacks.push({
          weaponId: 'tail_blade',
          x: heroX,
          z: heroZ,
          facingYaw: heroFacingYaw,
          hits,
        });
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

          const dmg = calculateDamage({
            baseDamage: baseDmg,
            weaponLevelBonus: 0,
            mightTomeBonus: mightBonus,
            itemDamageMultiplier: 1.0,
            isCrit: false,
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
            });
          }

          attacks.push({
            weaponId: 'spark_sling',
            x: heroX,
            z: heroZ,
            facingYaw: heroFacingYaw,
            hits: count,
          });
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

  if (damageDealtToHero > 0) {
    state.heroHp = Math.max(0, state.heroHp - damageDealtToHero);
  }

  // 6. Информация о боссе для шкалы здоровья внизу экрана
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
  };
}

/** Уничтожение моба с выпадением кристалла опыта */
export function killMob(state: CombatState, mobId: number): boolean {
  const idx = state.mobs.findIndex((m) => m.id === mobId);
  if (idx === -1) return false;

  const mob = state.mobs[idx]!;
  state.mobs.splice(idx, 1);
  state.kills++;

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
