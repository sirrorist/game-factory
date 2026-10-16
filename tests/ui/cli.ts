// Только явный dev-запуск. Из приложений, build/start и compose этот файл не импортируется.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { targets } from './core/game.ts';
import { loadAdapter } from './core/adapters.ts';
import { outputFor, safeName } from './core/paths.ts';
import { archiveAfter } from './core/snapshot.ts';
import { assertDevelopment, startComparison } from './core/server.ts';
import { markInterrupted } from './core/report.ts';

assertDevelopment();
const command = process.argv[2];
const option = (name: string) => { const i = process.argv.indexOf(name); if (i < 0) return undefined; const value = process.argv[i + 1]; if (!value || value.startsWith('--')) throw new Error('Не задано ' + name); return value; };
if (!command || command === 'help' || command === '--help') {
  console.log('pnpm ui:<list|baseline|preview|compare|check|live|verify|boundary|acceptance> <hub|id игры> [--ref COMMIT] [--run имя] [--port 4179]');
} else if (command === 'list') {
  for (const t of targets()) console.log(`${t.id}\t${t.title}`);
} else {
  const id = safeName(process.argv[3] ?? '');
  if (!targets().some(t => t.id === id)) throw new Error('Неизвестная цель: ' + id);
  if (option('--run')) process.env.GF_UI_RUN = safeName(option('--run')!);
  if (option('--label')) process.env.GF_UI_LABEL = safeName(option('--label')!);
  const out = outputFor(id);
  const adapter = await loadAdapter(id);
  const build = adapter.buildSnapshot;
  const compare = (port = 0) => startComparison(adapter.comparison(), port);
  process.env.GF_UI_LABEL ??= 'after';
  if (command === 'baseline') {
    if (!option('--ref')) throw new Error('Для базы укажи --ref COMMIT');
    await build('before', option('--ref')); console.log(`База сохранена: ${out}`);
  } else {
    if (!existsSync(join(out, 'before', 'snapshot.json'))) throw new Error(`Сначала pnpm ui:baseline ${id} --ref COMMIT [--run имя]`);
    const pending = (name: string, status: string) => { mkdirSync(out, { recursive: true }); writeFileSync(join(out, name), JSON.stringify({ status, complete: false, failed: null })); };
    if (command === 'preview' || command === 'check') {
      archiveAfter(out);
      for (const name of ['report.json', 'live-report.json', 'tool-smoke.json']) pending(name, command === 'check' ? 'running' : 'awaiting-final-checks');
      await build('after');
    }
    if (command === 'compare' || command === 'preview') {
      if (!existsSync(join(out, 'after', 'snapshot.json'))) throw new Error(`Сначала pnpm ui:preview ${id}`);
      const port = Number(option('--port') ?? process.env.GF_UI_PORT ?? (id === 'hub' ? 4183 : 4179));
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Некорректный --port');
      const server = await compare(port);
      console.log(`${id} · сравнение до/после: ${server.url}\nCtrl+C — остановить. Только dev, localhost.`);
      process.once('SIGINT', () => void server.close()); process.once('SIGTERM', () => void server.close());
    } else if (command === 'check' || command === 'live') {
      const name = command === 'check' ? 'report.json' : 'live-report.json';
      pending(name, 'running');
      let done = false;
      process.once('exit', code => { if (!done) markInterrupted(join(out, name), code); });
      const run = command === 'check' ? adapter.check : adapter.live;
      if (!run) throw new Error('Для этой цели нет сценария ' + command + '; добавь его в адаптер');
      try { process.exitCode = await run(); }
      catch (error) { markInterrupted(join(out, name), 1, error); throw error; }
      done = true;
    } else if (command === 'verify') {
      if (adapter.verify) await adapter.verify();
      else await (await import('./core/verify.ts')).verifyViewer(adapter.comparison());
    } else if (adapter.commands?.[command]) await adapter.commands[command]();
    else throw new Error('Неизвестная команда или нет адаптера: ' + command);
  }
}
