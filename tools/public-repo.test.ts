// Репозиторий публичный: о сервере здесь только то, без чего не работает проект (D-043).
// Раньше это была строка grep в тексте решения, и держалась она на памяти агента - теперь
// красный `pnpm test`. Шаблон ловит не всё: список "нельзя" из D-043 по-прежнему читается глазами.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;
const SELF = 'tools/public-repo.test.ts';

// Веб-адрес сервера виден в DNS (D-036), остальные - не адреса сервера.
const ALLOWED_IPS = new Set(['2.26.198.231', '127.0.0.1', '0.0.0.0']);
const IP_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
// Пути вне проекта: рабочая копия агента, база инфраструктуры, домашние каталоги.
const PATH_RE = /\/(?:srv|home)\/[\w.-]/g;
// Детали сервера, о которых D-043 говорит "нельзя". В DECISIONS сам список "нельзя" их
// называет, поэтому журнал решений по словам не проверяется - только по адресам и путям.
const WORD_RE = /\b(?:swap|ufw)\b|аудит/giu;
const WORDS_EXEMPT = new Set(['docs/DECISIONS.md']);
// `font-display: swap` - режим загрузки шрифта в CSS, к памяти сервера отношения не имеет.
const NOT_SERVER = /font-display:\s*swap/giu;

function tracked(): string[] {
  // И ещё не добавленные: новый документ ловится до `git add`, а не после коммита.
  const args = ['ls-files', '--cached', '--others', '--exclude-standard'];
  const out = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }).stdout.split('\n');
  return out.filter(
    (f) =>
      /\.(md|ts|tsx|js|mjs|json|ya?ml|sh|service|timer|txt|html|css)$|(^|\/)Dockerfile$/.test(f) &&
      f !== 'pnpm-lock.yaml' &&
      f !== SELF,
  );
}

test('в репозитории нет деталей сервера сверх разрешённого D-043', () => {
  const files = tracked();
  assert.ok(files.length > 10, 'git ls-files ничего не вернул');
  const found: string[] = [];
  for (const file of files) {
    const lines = readFileSync(join(REPO, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const at = `${file}:${i + 1}`;
      for (const [ip] of line.matchAll(IP_RE)) {
        if (!ALLOWED_IPS.has(ip)) found.push(`${at}: адрес ${ip}`);
      }
      for (const [path] of line.matchAll(PATH_RE)) found.push(`${at}: путь ${path}…`);
      if (!WORDS_EXEMPT.has(file)) {
        for (const [word] of line.replace(NOT_SERVER, '').matchAll(WORD_RE)) found.push(`${at}: "${word}"`);
      }
    });
  }
  assert.deepEqual(found, [], 'детали сервера в публичном репозитории - убрать или см. D-043');
});
