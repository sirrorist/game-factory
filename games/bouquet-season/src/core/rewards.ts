import { EFFECTS, hasGlobal, type EffectOption, type EffectsState } from './effects.ts';
import { nextRandom, OPEN_FLOWERS } from './orders.ts';
import { storySteps, type StoryProgress } from './progress.ts';
import type { ObjectKind, PlantKind } from './layout.ts';

export interface RewardPending {
  orderId: number;
  stage: number;
  source: 'main' | 'urgent' | 'fair';
  options: EffectOption[];
}
export function drawReward(fx: EffectsState, progress: StoryProgress, seed: number, open:readonly PlantKind[] = OPEN_FLOWERS): { options: EffectOption[]; rng: number } {
  const unlocked = storySteps(progress);
  const options: EffectOption[] = [];
  for (const effect of EFFECTS) {
    if (effect.id === 'P5' && !unlocked[0] || effect.id === 'E3' && !unlocked[1] || effect.id === 'E4' && !unlocked[2]) continue;
    if (effect.form === 'module') options.push({ effect: effect.id, target: null });
    else {
      const targets: readonly ObjectKind[] = effect.category === 'plant' ? open : effect.id === 'E1' ? ['lamp'] : effect.id === 'E2' ? ['sprinkler'] : ['lamp', 'sprinkler'];
      for (const target of targets) if (!hasGlobal(fx, effect.id, target)) options.push({ effect: effect.id, target });
    }
  }
  const selected: EffectOption[] = [];
  let rng = seed;
  for (const category of ['plant', 'device', 'any']) {
    const pool = options.filter(o => !selected.includes(o) && (category === 'any' || EFFECTS.find(e => e.id === o.effect)!.category === category));
    if (!pool.length) throw Error('В наборе улучшений нет подходящих вариантов.');
    rng = nextRandom(rng); selected.push(pool[rng % pool.length]!);
  }
  return { options: selected, rng };
}
