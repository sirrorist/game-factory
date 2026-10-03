// Чистая логика мобов, спавна, урона и опыта (без Three.js и DOM).
// Реализация требований DESIGN.md, разделы 5.2, 5.4, 5.5, 7 (шаг 4).

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

  // После 10 минут - финальная волна на пределе
  return Math.min(cap, 60);
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

export interface CombatState {
  mobs: MobEntity[];
  gems: ExpGemEntity[];
  projectiles: ProjectileEntity[];
  weapons: WeaponState[];
  nextMobId: number;
  nextGemId: number;
  nextProjId: number;
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
    weapons: [
      {
        id: 'tail_blade',
        level: 1,
        cooldownTimer: 0.3,
      },
    ],
    nextMobId: 1,
    nextGemId: 1,
    nextProjId: 1,
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
  damageDealtToHero: number;
  gemsCollected: number;
  attacks: AttackEvent[];
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
      // Плевун-совёнок: держит дистанцию 9..12 м, стреляет раз в 2.5 с
      if (dist < 9.0) {
        // Отступает назад от героя
        if (dist > 0.001) {
          mob.x -= (dx / dist) * mob.speed * safeDt;
          mob.z -= (dz / dist) * mob.speed * safeDt;
        }
      } else if (dist > 12.0) {
        // Подходит ближе
        if (dist > 0.001) {
          mob.x += (dx / dist) * mob.speed * safeDt;
          mob.z += (dz / dist) * mob.speed * safeDt;
        }
      }

      mob.shootCooldown -= safeDt;
      if (mob.shootCooldown <= 0 && dist < 16.0) {
        mob.shootCooldown = 2.5;
        // Выстрел снарядом в героя
        if (dist > 0.001) {
          const pSpeed = 10.0;
          state.projectiles.push({
            id: state.nextProjId++,
            x: mob.x,
            y: mob.y + 0.8,
            z: mob.z,
            vx: (dx / dist) * pSpeed,
            vz: (dz / dist) * pSpeed,
            damage: mob.damage,
            radius: 0.3,
            lifeSec: 3.0,
          });
        }
      }
    }

    mob.y = getGroundHeight(mob.x, mob.z);
  }

  // 2. Движение снарядов врагов
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i]!;
    p.x += p.vx * safeDt;
    p.z += p.vz * safeDt;
    p.lifeSec -= safeDt;

    const pDist = Math.hypot(heroX - p.x, heroZ - p.z);
    if (pDist < p.radius + 0.45 && state.heroIFrameSec <= 0) {
      damageDealtToHero += p.damage;
      state.heroIFrameSec = 0.6;
      state.projectiles.splice(i, 1);
      continue;
    }

    if (p.lifeSec <= 0) {
      state.projectiles.splice(i, 1);
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
          leveledUp = true;
        }
      }
    } else {
      gem.y = getGroundHeight(gem.x, gem.z) + 0.25;
    }
  }

  // 4. Автоатака оружия лиса
  const attacks: AttackEvent[] = [];
  for (const w of state.weapons) {
    w.cooldownTimer -= safeDt;
    if (w.cooldownTimer <= 0) {
      const cfg = WEAPON_CONFIGS[w.id];
      const levelIdx = Math.max(0, Math.min(4, w.level - 1));
      const baseDmg = cfg.damageByLevel[levelIdx] ?? 14;
      const cooldown = cfg.cooldownByLevel[levelIdx] ?? 1.1;
      w.cooldownTimer = cooldown;

      if (w.id === 'tail_blade') {
        const fx = -Math.sin(heroFacingYaw);
        const fz = -Math.cos(heroFacingYaw);
        let hits = 0;

        for (let i = state.mobs.length - 1; i >= 0; i--) {
          const m = state.mobs[i]!;
          const mdx = m.x - heroX;
          const mdz = m.z - heroZ;
          const dist = Math.hypot(mdx, mdz);
          if (dist <= cfg.range + m.radius) {
            const dot = dist > 0.001 ? (fx * (mdx / dist) + fz * (mdz / dist)) : 1;
            if (dot >= 0.45) {
              const dmg = calculateDamage({
                baseDamage: baseDmg,
                weaponLevelBonus: 0,
                mightTomeBonus: 0,
                itemDamageMultiplier: 1.0,
                isCrit: false,
              });
              m.hp -= dmg;
              hits++;
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
      }
    }
  }

  // 5. Деспавн мобов, отдалившихся больше чем на 45 м от героя
  for (let i = state.mobs.length - 1; i >= 0; i--) {
    const m = state.mobs[i]!;
    if (Math.hypot(heroX - m.x, heroZ - m.z) > 45.0) {
      state.mobs.splice(i, 1);
    }
  }

  if (damageDealtToHero > 0) {
    state.heroHp = Math.max(0, state.heroHp - damageDealtToHero);
  }

  return {
    leveledUp,
    damageDealtToHero,
    gemsCollected,
    attacks,
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
