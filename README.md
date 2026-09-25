# Game Factory

Хаб браузерных игр: каталог, запуск каждой игры в изолированной песочнице, скачивание
простых игр офлайн-архивом. Дальше — админка, игры с бэкендом и ИИ-студия, которая
собирает игры из шаблонов и наборов скиллов.

- Хаб: `games.youranus.ru` (план, ещё не развёрнут)
- Игры: `<id>.play.youranus.ru` — у каждой игры свой origin

> Состояние проекта, что сделано и что дальше — [`docs/STATE.md`](docs/STATE.md).
> Карта всей документации — [`docs/README.md`](docs/README.md).

## Быстрый старт

Нужны Node.js 22.18+ (TypeScript исполняется напрямую, без сборки) и pnpm 10.

```bash
pnpm install          # typescript, @types/node, playwright — только dev
pnpm check            # типы, юнит-тесты, сборка игр, офлайн-архивы, e2e
pnpm play             # сервер игр на :4100
```

Открой <http://snake.play.localhost:4100/>: `*.localhost` браузеры резолвят в 127.0.0.1
сами, DNS не нужен. Офлайн-архив — `.data/storage/exports/snake-1.0.0.zip`: распакуй
и открой `index.html` двойным кликом.

## Что где

```
apps/play-server/     сервер игр: раздача по поддоменам, заголовки песочницы
apps/hub/             хаб на Next.js — этап 0б, ещё не создан
packages/manifest/    схема game.json и валидатор
packages/registry/    реестр опубликованных игр и раскладка хранилища
packages/game-sdk/    SDK для игр (классический скрипт, работает на file://)
packages/hub-bridge/  сторона хаба в протоколе SDK
tools/gf.ts           CLI: list, validate, build, export
games/                игры; каждая — папка с game.json
tests/e2e/            браузерные тесты: офлайн и встраивание в хаб
docs/                 документация
```

## Команды

| Команда | Что делает |
|---|---|
| `pnpm gf list` | игры в `games/` и их манифесты |
| `pnpm gf validate [id]` | проверить `game.json` |
| `pnpm games:build [id]` | собрать и опубликовать версию в `.data/` |
| `pnpm games:export [id]` | офлайн-архив для игр с `offline: true` |
| `pnpm play` | сервер игр |
| `pnpm typecheck` | tsc без эмита |
| `pnpm test` | юнит-тесты (`node --test`) |
| `pnpm test:e2e` | браузерные тесты (Playwright, Chromium) |
| `pnpm check` | всё сразу, как в CI |

## Правила работы

Правила агента общие для всех проектов приезжают из `global-agent-kit`, правила
этого проекта — в [`CLAUDE.md`](CLAUDE.md). Порядок работы — [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
