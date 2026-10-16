import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

function writeReport(file: string, report: unknown): void {
  const pending = `${file}.${process.pid}.pending`;
  writeFileSync(pending, JSON.stringify(report, null, 2));
  renameSync(pending, file);
}

// Пишем после каждого измерения: finally не выполняется при SIGINT/SIGTERM.
// Синхронный обработчик сигнала сохраняет накопленные данные до завершения процесса.
export function trackCheck(file: string, details: () => Record<string, unknown>) {
  let status = 'running';
  let fatal: string | null = null;
  let exitCode: number | undefined;
  const checkpoint = () => {
    const data = details();
    writeReport(file, { ...data, status, complete: status === 'finished' && data.complete === true, fatal,
      failed: status === 'interrupted-or-failed' ? Math.max(1, typeof data.failed === 'number' ? data.failed : 0) : data.failed,
      ...(exitCode === undefined ? {} : { exitCode }) });
  };
  const fail = (error: unknown, code = 1) => { status = 'interrupted-or-failed'; fatal = String(error); exitCode = code; checkpoint(); };
  const onExit = (code: number) => { if (status === 'running') fail('Процесс завершён до окончания проверки', code); };
  const onInterrupt = () => { fail('Получен SIGINT', 130); process.exit(130); };
  const onTerminate = () => { fail('Получен SIGTERM', 143); process.exit(143); };
  checkpoint();
  process.once('exit', onExit);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  return { checkpoint, fail,
    finish: () => { status = 'finished'; checkpoint(); },
    close: () => {
      if (status === 'running') fail('Проверка завершилась без результата');
      process.removeListener('exit', onExit); process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
    } };
}

export function markInterrupted(file: string, exitCode: number, error?: unknown): void {
  let previous: Record<string, unknown> = {};
  try { if (existsSync(file)) previous = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* Неполный JSON заменяется честным статусом прерывания. */ }
  writeReport(file, { ...previous, status: 'interrupted-or-failed', complete: false,
    failed: Math.max(1, typeof previous.failed === 'number' ? previous.failed : 0), exitCode,
    ...(error === undefined ? {} : { fatal: String(error) }) });
}
