import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotEvidence, toolHash } from '../../core/evidence.ts';
import { OUT } from './snapshot.ts';
export { treeHash } from '../../core/evidence.ts';

export function gameEvidence(runner: string) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return { snapshots: snapshotEvidence(OUT), toolHash: toolHash([runner, 'adapter.ts', 'evidence.ts', 'wallet-layout.ts', 'config.ts', 'fixtures.ts', 'server.ts', 'snapshot.ts'].map(f => join(here, f))) };
}
