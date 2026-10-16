import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UI, safeName } from './paths.ts';
import { gameComparison } from './game.ts';
import { buildGameSnapshot } from './snapshot.ts';
import { checkGame } from './check.ts';
import type { UiAdapter } from './types.ts';

export async function loadAdapter(id: string): Promise<UiAdapter> {
  const file = join(UI, 'targets', safeName(id), 'adapter.ts');
  if (existsSync(file)) {
    const module = await import(pathToFileURL(file).href) as { default: UiAdapter };
    return module.default;
  }
  return { buildSnapshot: (side, ref) => buildGameSnapshot(id, side, ref), comparison: () => gameComparison(id), check: () => checkGame(id) };
}
