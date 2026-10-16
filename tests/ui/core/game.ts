import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, outputFor, safeName } from './paths.ts';
import { PROFILES } from './profiles.ts';
import { snapshotEvidence, toolHash } from './evidence.ts';
import type { Comparison } from './types.ts';

export function targets(): { id: string; title: string }[] {
  return [{ id: 'hub', title: 'Game Factory (сайт)' }, ...readdirSync(join(ROOT, 'games'), { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(ROOT, 'games', e.name, 'game.json')))
    .map(e => { const m = JSON.parse(readFileSync(join(ROOT, 'games', e.name, 'game.json'), 'utf8')) as { title: string }; return { id: safeName(e.name), title: m.title }; })];
}

export function gameEvidence(id: string) {
  return { snapshots: snapshotEvidence(outputFor(id)), toolHash: toolHash([]) };
}

export function gameComparison(id: string): Comparison {
  const target = targets().find(t => t.id === safeName(id) && t.id !== 'hub');
  if (!target) throw new Error('Не найдена игра: ' + id);
  return { id, title: target.title, out: outputFor(id), profiles: PROFILES, scenes: [{ id: 'start', label: 'Старт игры' }],
    description: 'Обычные сборки игры на отдельных origins. Стартовый экран сравнивается без подстановки редких состояний; игровые сценарии добавляются адаптером. Это dev-просмотр, не проверка настоящего входа или bridge.',
    validateReport: report => {
      try { const current = gameEvidence(id), saved = report as typeof current;
        return JSON.stringify({ snapshots: saved.snapshots, toolHash: saved.toolHash }) === JSON.stringify(current);
      } catch { return false; }
    } };
}
