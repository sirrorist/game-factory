# Разработка: ход работы и соглашения

## Окружение

- Node.js ≥ 22.18 (`.nvmrc`), pnpm 10 (`packageManager` в `package.json`).
- Chromium для e2e: `pnpm exec playwright install chromium`. В облачной среде агента
  браузер уже стоит, но может быть старше Playwright — тогда
  `GF_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm check` (П-030).
- Коммиты — прямо в `main`, пока идёт MVP (D-030).
- Переменные — `.env` по образцу `.env.example`. Секретов в `.env` на этапе 0 нет.

## Ход работы над задачей

1. **Взять задачу** из ROADMAP.md (текущий этап) или от владельца. Непонятно, что
   считается готовым, — сначала критерии, потом код.
2. **Прочитать** STATE.md, раздел ARCHITECTURE, SECURITY и PITFALLS по теме.
3. **План** — коротко, в ответе владельцу: что меняется, какие файлы, как проверим.
   Решение, которое меняет архитектуру или добавляет зависимость, — в DECISIONS.md.
4. **Код + тесты вместе.** Для защитных мер — негативный тест и проверка мутацией
   (TESTING.md).
5. **`pnpm check`** — полностью зелёный. Красное — не «потом», а сейчас.
6. **Документы** в том же изменении: STATE, DECISIONS, PITFALLS, GAMES — что затронуто.
7. **Показать** владельцу: итог одной строкой, что проверено и чем, что не проверено.
8. **Коммит и пуш — только после «да»** (правило кита). Один коммит на сессию.

## Соглашения по коду

- TypeScript исполняется Node напрямую: только стираемый синтаксис, импорты с `.ts`,
  `import type` для типов. См. П-010…П-012.
- Ядро — без npm-зависимостей (D-013). Новая зависимость в ядро — запись в DECISIONS.
- Пакеты рабочей области импортируются в ядре относительными путями (П-012).
- Ошибки для человека — по-русски и с подсказкой, что делать
  («подними "version" в game.json»), а не «invalid input».
- Комментарий объясняет *почему*. *Что* делает код, видно из кода.
- Имена файлов — `kebab-case`, типы — `PascalCase`, функции — `camelCase`.
- Форматирование — `.editorconfig`: 2 пробела, LF, перевод строки в конце.

## Как добавить пакет

```
packages/<name>/
  package.json     { "name": "@gf/<name>", "private": true, "type": "module",
                     "exports": { ".": "./src/index.ts" } }
  src/index.ts
  test/<name>.test.ts
```

Добавить путь в `include` корневого `tsconfig.json`; если пакету нужен DOM — отдельный
`tsconfig.json`, как у `packages/game-sdk`, и строку в скрипт `typecheck`.

## Ручная проверка

```bash
pnpm games:build && pnpm games:export
pnpm play
```

Браузер: `http://snake.play.localhost:4100/`. Из терминала — через заголовок `Host` (П-007):

```bash
curl -sI http://127.0.0.1:4100/ -H 'Host: snake.play.localhost'
curl -sO http://127.0.0.1:4100/exports/snake-1.0.0.zip -H 'Host: play.localhost'
```

## Отладка протокола

В консоли страницы эталонного хаба e2e (`tests/e2e/fixtures/mock-hub.html`) лежит
`window.__events` — все события моста: `hello`, `ready`, `request`, `rejected` с причиной.
Внутри игры: `await GameFactory.init({ gameId: 'snake' })` и дальше вызовы SDK руками.
