import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip } from './zip.ts';

const hasUnzip = spawnSync('unzip', ['-v']).status === 0;

test('архив читается unzip и совпадает побайтно', { skip: !hasUnzip && 'нет unzip' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-zip-'));
  const big = Buffer.alloc(100_000, 'a');
  const random = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 251));
  const zipFile = join(dir, 'a.zip');
  writeFileSync(zipFile, createZip([
    { name: 'g/index.html', data: Buffer.from('<h1>привет</h1>') },
    { name: 'g/assets/big.txt', data: big },
    { name: 'g/assets/noise.bin', data: random },
    { name: 'g/пусто.txt', data: Buffer.alloc(0) },
  ]));
  assert.equal(spawnSync('unzip', ['-tq', zipFile]).status, 0);
  const out = join(dir, 'out');
  assert.equal(spawnSync('unzip', ['-q', zipFile, '-d', out]).status, 0);
  assert.equal(readFileSync(join(out, 'g/index.html'), 'utf8'), '<h1>привет</h1>');
  assert.deepEqual(readFileSync(join(out, 'g/assets/big.txt')), big);
  assert.deepEqual(readFileSync(join(out, 'g/assets/noise.bin')), random);
  assert.equal(readFileSync(join(out, 'g/пусто.txt')).length, 0);
});

test('архив детерминирован', () => {
  const entries = [{ name: 'a.txt', data: Buffer.from('x') }];
  assert.deepEqual(createZip(entries), createZip(entries));
});

test('небезопасные и повторные имена отвергаются', () => {
  assert.throws(() => createZip([{ name: '../evil', data: Buffer.alloc(1) }]));
  assert.throws(() => createZip([{ name: '/abs', data: Buffer.alloc(1) }]));
  assert.throws(() => createZip([
    { name: 'a', data: Buffer.alloc(1) },
    { name: 'a', data: Buffer.alloc(1) },
  ]));
});
