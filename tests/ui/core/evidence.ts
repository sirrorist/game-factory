import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { UI } from './paths.ts';
import type { Snapshot } from './types.ts';

export function treeHash(directory: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, prefix: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) visit(join(path, entry.name), name + '/');
      else if (entry.isFile()) hash.update(name).update(readFileSync(join(path, entry.name)));
      else throw new Error('Неожиданный симлинк в доказательствах: ' + name);
    }
  };
  visit(directory, '');
  return hash.digest('hex');
}

export function toolHash(files: readonly string[]): string {
  const common = readdirSync(join(UI, 'core')).filter(f => f.endsWith('.ts')).map(f => join(UI, 'core', f));
  const hash = createHash('sha256');
  for (const file of [...new Set([...common, join(UI, 'cli.ts'), join(UI, 'compare.html'), ...files])].sort()) {
    hash.update(relative(UI, file)).update(readFileSync(file));
  }
  return hash.digest('hex');
}

export function snapshotEvidence(out: string) {
  return Object.fromEntries(['before', 'after'].map(side => {
    const saved = JSON.parse(readFileSync(join(out, side, 'snapshot.json'), 'utf8')) as Snapshot;
    const actual = createHash('sha256').update(readFileSync(join(out, side, 'index.html'))).digest('hex');
    if (saved.hash !== actual) throw new Error(`${side}: HTML не совпадает с snapshot.json`);
    return [side, { ...saved, artifactHash: treeHash(join(out, side)) }];
  }));
}
