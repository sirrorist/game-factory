// Только Compose config и извлечённые фрагменты; Docker Engine и полный updater не запускаются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);

test('Compose: исправленный image_ids и первоначальное включение', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'gf-mail-image-selection-'));
  const resultDir = resolve('test-results/mail-deployment');
  await mkdir(resultDir, { recursive: true });
  try {
    for (const name of ['compose.prod.yml', 'compose.mail.overlay.yml']) await copyFile(join('deploy', name), join(fixture, name));
    await mkdir(join(fixture, 'docker-config'));
    await mkdir(join(fixture, 'secrets'));
    for (const name of ['db_password', 'db_hub_password', 'auth_secret', 'mail_service_secret', 'resend_api_key']) {
      await writeFile(join(fixture, 'secrets', name), 'synthetic-not-a-real-secret');
    }
    await writeFile(join(fixture, 'parameters'), 'GF_IMAGE_TAG=synthetic-image-selection\nGF_MAIL_RELAY_IMAGE=example.invalid/mail@sha256:' + '0'.repeat(64) + '\nGF_MAIL_EGRESS_NETWORK=synthetic-egress\n');
    const docker = (process.env.PATH ?? '').split(':').map((path) => join(path, 'docker')).find(existsSync);
    assert.ok(docker);
    const env = { PATH: process.env.PATH ?? '', DOCKER_CONFIG: join(fixture, 'docker-config'), DOCKER_HOST: 'unix://' + join(fixture, 'no-engine.sock'), COMPOSE_DISABLE_ENV_FILE: '1' };
    const args = ['--project-directory', fixture, '--env-file', join(fixture, 'parameters'), '-f', join(fixture, 'compose.prod.yml'), '-f', join(fixture, 'compose.mail.overlay.yml')];
    const cli = async (...more: string[]) => (await exec(docker, ['compose', ...args, '--profile', 'publish', ...more], { env, timeout: 10000 })).stdout.trim();
    const version = (await exec(docker, ['compose', 'version', '--short'], { env, timeout: 10000 })).stdout.trim();
    const model = JSON.parse(await cli('config', '--format', 'json'));
    const images = (await cli('config', '--images', 'hub')).split('\n').filter(Boolean);
    const updater = await readFile('deploy/update.sh', 'utf8');
    const sourceHash = createHash('sha256').update(updater).digest('hex');
    const current = updater.match(/^image_ids\(\) \{[\s\S]*?^\}/m)?.[0];
    assert.ok(current);
    const before = '    img=$(compose config --images "$s")';
    const after = `    img=$(compose config --format json | python3 -c 'import json, sys; print(json.load(sys.stdin)["services"][sys.argv[1]]["image"])' "$s") || return\n    [[ -n $img && $img != *$'\\n'* ]] || return 1`;
    assert.ok(current.includes(after));
    // Прежняя версия создаётся только в памяти для воспроизведения регрессии.
    const legacy = current.replace(after, () => before);
    const capture = join(fixture, 'inspect-argument');
    const prefix = `GF_TEST_REAL_DOCKER=$1\nGF_TEST_CAPTURE=$2\nshift 2\nGF_TEST_COMPOSE_ARGS=("$@")\nSERVICES=(hub)\ncompose() { "$GF_TEST_REAL_DOCKER" compose "\${GF_TEST_COMPOSE_ARGS[@]}" --profile publish "$@"; }\ndocker() {\n  [[ $# == 5 && $1 == image && $2 == inspect && $3 == --format ]] || return 97\n  printf '%s' "$5" >"$GF_TEST_CAPTURE"\n  [[ $5 != *$'\\n'* ]] || return 1\n  printf '%s\\n' 'sha256:synthetic-image-id'\n}\n`;
    const inspect = async (body: string) => {
      const { stdout } = await exec('bash', ['-c', prefix + body + '\nimage_ids\n', 'gf-image-fixture', docker, capture, ...args], { env, timeout: 10000 });
      return { argument: await readFile(capture, 'utf8'), output: stdout.trim() };
    };
    const old = await inspect(legacy);
    // Compose не обещает порядок зависимостей между отдельными вызовами config.
    assert.deepEqual(old.argument.split('\n').sort(), [...images].sort());
    const ambiguous = images.length !== 1;
    if (ambiguous) assert.ok(old.output.startsWith('нет:'), 'несколько имён становятся одним неверным аргументом inspect');
    const fixed = await inspect(current);
    assert.equal(fixed.argument, model.services.hub.image);
    assert.equal(fixed.output, 'sha256:synthetic-image-id');
    const conditional = updater.match(/^if \[\[ \$before == \"\$after\" && \$\{1:-\} != --force \]\]; then\n  exit 0\nfi/m)?.[0];
    assert.ok(conditional);
    const branch = async (...parameters: string[]) => (await exec('bash', ['-c', 'before=same\nafter=same\n' + conditional + '\nprintf apply-required\n', 'gf-branch', ...parameters], { env, timeout: 10000 })).stdout;
    assert.equal(await branch(), '');
    assert.equal(await branch('--force'), 'apply-required');
    await writeFile(join(resultDir, 'image-selector-applied.bash'), prefix + current + '\n');
    await writeFile(join(resultDir, 'compose-applied-check.json'), JSON.stringify({
      updater_sha256: sourceHash, patch_applied_locally: true,
      cli_version: version, requested_service: 'hub', reported_images: images,
      legacy_inspect_argument_count: 1, legacy_inspect_argument_has_newlines: old.argument.includes('\n'),
      legacy_fallback_observed: old.output.startsWith('нет:'),
      fixed_selected_only_requested_image: fixed.argument === model.services.hub.image,
      unchanged_images_skip_apply: true, force_reaches_apply_branch: true,
      docker_engine_used: false, inspect_is_stubbed: true, full_updater_executed: false,
      updater_unchanged: await readFile('deploy/update.sh', 'utf8') === updater,
    }, null, 2) + '\n');
    assert.equal(await readFile('deploy/update.sh', 'utf8'), updater);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
