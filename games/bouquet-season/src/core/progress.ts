export interface StoryProgress { main: number; urgent: number; wins: number }
export const newStory = (): StoryProgress => ({ main: 0, urgent: 0, wins: 0 });
export function isStory(value: unknown): value is StoryProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'main,urgent,wins') return false;
  return Object.values(value).every(n => Number.isSafeInteger(n) && n >= 0);
}
export function storySteps(progress: StoryProgress): boolean[] {
  const q1 = progress.main >= 1, q2 = q1 && progress.main >= 3 && progress.urgent >= 1;
  return [q1, q2, q2 && progress.wins >= 1];
}
