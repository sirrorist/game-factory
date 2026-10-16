import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, outputFor } from '../../core/paths.ts';
import { buildGameSnapshot } from '../../core/snapshot.ts';
export { ROOT } from '../../core/paths.ts';
export type { Snapshot } from '../../core/types.ts';

export const GAME = join(ROOT, 'games/superwalk');
export const OUT = outputFor('superwalk');

export function buildSnapshot(side: 'before' | 'after', ref?: string) {
  return buildGameSnapshot('superwalk', side, ref, source => {
    const entry = join(source, 'src/main.ts'), marker = 'new SuperwalkApp(session, best);';
    const original = readFileSync(entry, 'utf8');
    if (original.split(marker).length !== 2) throw new Error('Изменился запуск Superwalk: адаптируй временную инструментализацию');
    writeFileSync(entry, original.replace(marker, 'const app = new SuperwalkApp(session, best); Object.assign(globalThis, { __SW_UI__: app });'));
  });
}
