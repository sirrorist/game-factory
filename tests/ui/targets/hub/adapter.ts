import { buildSnapshot, hubComparison } from './preview.ts';
import type { UiAdapter } from '../../core/types.ts';

export default {
  buildSnapshot, comparison: hubComparison,
  check: async () => { await import('./check.ts'); return Number(process.exitCode ?? 0); },
  live: async () => { await import('./live.ts'); return Number(process.exitCode ?? 0); },
} satisfies UiAdapter;
