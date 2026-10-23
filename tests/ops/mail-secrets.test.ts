// Явный локальный suite: Linux, bubblewrap и Python PTY, без Docker и живых секретов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const driver = fileURLToPath(new URL('./mail-secrets-pty.py', import.meta.url));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const oldHash = digest('synthetic-existing-secret-must-survive');
const apiHash = digest('re_synthetic_mail_test_key_012345678901234567890');
type Entry = { kind: string; mode: number; size?: number; sha256?: string; target?: string };
type Result = {
  status: number; prompted: boolean; timed_out: boolean; namespace_error: boolean;
  key_in_output: boolean; service_in_output: boolean; records: Record<string, Entry>;
  original_block_sha256: string; executed_block_sha256: string;
};
async function run(scenario: string): Promise<Result> {
  const mutation = process.env.GF_MAIL_TEST_MUTATION ?? 'none';
  const { stdout } = await exec('python3', [driver, scenario, mutation], { timeout: 8000, maxBuffer: 100000 });
  const value = JSON.parse(stdout);
  assert.equal(value.harness_error, undefined);
  assert.equal(value.namespace_error, false, 'стенд должен запуститься в namespace');
  assert.equal(value.timed_out, false, 'не принимать зависание за отказ защиты');
  assert.equal(value.key_in_output, false, 'ключ не попадает в терминальный вывод');
  assert.equal(value.service_in_output, false, 'служебный секрет не попадает в вывод');
  if (mutation === 'none') assert.equal(value.executed_block_sha256, value.original_block_sha256);
  else assert.notEqual(value.executed_block_sha256, value.original_block_sha256);
  assert.equal(value.records.victim!.sha256, oldHash, 'исходный файл-мишень не меняется');
  return value;
}
function empty(value: Result) {
  assert.equal(value.records['secrets/resend_api_key'], undefined);
  assert.equal(value.records['secrets/mail_service_secret'], undefined);
}

test('секреты: успешный скрытый ввод, точные данные и файловые права', async () => {
  const value = await run('success');
  assert.equal(value.status, 0);
  assert.equal(value.prompted, true);
  assert.equal(value.records.secrets!.mode, 0o700);
  assert.deepEqual(value.records['secrets/resend_api_key'], { kind: 'file', mode: 0o644, size: 48, sha256: apiHash });
  assert.deepEqual(value.records['secrets/mail_service_secret'], { kind: 'file', mode: 0o644, size: 64, sha256: digest('d'.repeat(64)) });
});
for (const [scenario, name] of [['existing-api', 'resend_api_key'], ['existing-service', 'mail_service_secret']]) {
  test('секреты: ранний отказ для ' + scenario, async () => {
    const value = await run(scenario!);
    assert.notEqual(value.status, 0);
    assert.equal(value.prompted, false, 'известный существующий секрет отвергается до запроса ключа');
    assert.equal(value.records['secrets/' + name]!.sha256, oldHash);
    assert.equal(Object.keys(value.records).filter((key) => key.startsWith('secrets/')).length, 1);
  });
}
for (const scenario of ['symlink-api', 'dangling-service', 'directory-link', 'directory-mode']) {
  test('секреты: отказ для ' + scenario, async () => {
    const value = await run(scenario);
    assert.notEqual(value.status, 0);
    assert.equal(value.prompted, false);
    assert.equal(value.records.absent, undefined);
    if (scenario === 'symlink-api') assert.equal(value.records['secrets/resend_api_key']!.kind, 'symlink');
    if (scenario === 'dangling-service') assert.equal(value.records['secrets/mail_service_secret']!.kind, 'symlink');
    if (scenario === 'directory-link') assert.equal(value.records.secrets!.kind, 'symlink');
    if (scenario === 'directory-mode') assert.equal(value.records.secrets!.mode, 0o755);
  });
}
test('секреты: неверный ключ не создаёт файлы', async () => {
  const value = await run('invalid-key');
  assert.notEqual(value.status, 0);
  empty(value);
});
for (const [scenario, name] of [['race-first', 'resend_api_key'], ['race-second', 'mail_service_secret']]) {
  test('секреты: noclobber после предварительной проверки, ' + scenario, async () => {
    const value = await run(scenario!);
    assert.notEqual(value.status, 0);
    assert.equal(value.records['secrets/' + name]!.sha256, oldHash);
    const other = name === 'resend_api_key' ? 'mail_service_secret' : 'resend_api_key';
    assert.equal(value.records['secrets/' + other], undefined, 'чужой файл не удаляется, собственный откатывается');
  });
}
test('секреты: ошибка второго открытия откатывает первый файл', async () => {
  const value = await run('second-open');
  assert.notEqual(value.status, 0);
  assert.equal(value.records['secrets/resend_api_key'], undefined);
  assert.equal(value.records['secrets/mail_service_secret']!.kind, 'directory');
});
for (const scenario of ['write-fail', 'signal-int', 'signal-term', 'chmod-fail']) {
  test('секреты: cleanup при ' + scenario, async () => {
    const value = await run(scenario);
    assert.notEqual(value.status, 0);
    if (scenario === 'signal-int') assert.equal(value.status, 130);
    if (scenario === 'signal-term') assert.equal(value.status, 143);
    empty(value);
  });
}
test('секреты: известное окно до регистрации оставляет только пустой 0600 файл', async () => {
  const value = await run('registration-gap');
  assert.equal(value.status, 143);
  assert.deepEqual(value.records['secrets/resend_api_key'], { kind: 'file', mode: 0o600, size: 0, sha256: digest('') });
  assert.equal(value.records['secrets/mail_service_secret'], undefined);
});

test('секреты: то же известное окно второго файла не сохраняет API-ключ', async () => {
  const value = await run('registration-gap-second');
  assert.equal(value.status, 143);
  assert.equal(value.records['secrets/resend_api_key'], undefined);
  assert.deepEqual(value.records['secrets/mail_service_secret'], { kind: 'file', mode: 0o600, size: 0, sha256: digest('') });
});
