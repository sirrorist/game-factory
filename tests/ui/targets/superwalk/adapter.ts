import { buildSnapshot } from './snapshot.ts';
import { comparison } from './server.ts';
import type { UiAdapter } from '../../core/types.ts';

export default {
  buildSnapshot, comparison,
  check: async () => (await import('./check.ts')).runChecks(),
  live: async () => (await import('./live.ts')).runLiveChecks(),
  verify: () => import('./smoke.ts'),
  commands: {
    boundary: () => import('./wallet-boundary.ts'),
    'wallet-review': () => import('./wallet-review.ts'),
    acceptance: () => import('./acceptance.ts'),
  },
} satisfies UiAdapter;
