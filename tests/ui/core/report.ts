import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function markInterrupted(file: string, exitCode: number): void {
  let previous: Record<string, unknown> = {};
  try { if (existsSync(file)) previous = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* Неполный JSON заменяется честным статусом прерывания. */ }
  writeFileSync(file, JSON.stringify({ ...previous, status: 'interrupted-or-failed', complete: false,
    failed: Math.max(1, typeof previous.failed === 'number' ? previous.failed : 0), exitCode }, null, 2));
}
