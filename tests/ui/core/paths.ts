import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const UI = fileURLToPath(new URL('../', import.meta.url));

export function safeName(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error('Имя цели/прохода: только a–z, 0–9 и дефис');
  return value;
}

export function outputFor(target: string): string {
  const out = join(ROOT, 'test-results/ui', safeName(target));
  return process.env.GF_UI_RUN ? join(out, 'runs', safeName(process.env.GF_UI_RUN)) : out;
}
