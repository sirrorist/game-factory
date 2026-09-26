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
pnpm install          # зависимости рабочей области (lockfile обязателен)
pnpm check            # типы, юнит-тесты, сборка игр, архивы, сборка хаба, e2e
pnpm play             # сервер игр на :4100 (в одном терминале)
pnpm hub              # хаб на :3000 (в другом)
```

Открой <http://localhost:3000>: каталог, игра в песочнице, кнопка «Скачать».
Игры живут на `http://<id>.play.localhost:4100/` — `*.localhost` браузеры резолвят
в 127.0.0.1 сами, DNS не нужен. Архив распакуй и открой `index.html` двойным кликом.

То же в контейнерах: `pnpm games:build && pnpm games:export && docker compose up --build`.

## Что где

```
apps/play-server/     сервер игр: раздача по поддоменам, заголовки песочницы
apps/hub/             хаб на Next.js: каталог, страница игры с iframe и мостом
packages/manifest/    схема game.json и валидатор
packages/registry/    реестр опубликованных игр и раскладка хранилища
packages/game-sdk/    SDK для игр (классический скрипт, работает на file://)
packages/hub-bridge/  сторона хаба в протоколе SDK, атрибуты iframe из прав манифеста
packages/vite-config/ общий Vite-конфиг игр: офлайн-сборка в один HTML
templates/vite-ts/    шаблон игры на TypeScript + Vite (pnpm gf new <id>)
tools/gf.ts           CLI: list, validate, build, export, new, check-prod
games/                игры; каждая — папка с game.json
tests/e2e/            браузерные тесты: офлайн, эталонный хаб, настоящий хаб
docs/                 документация
```

## Команды

| Команда | Что делает |
|---|---|
| `pnpm gf list` | игры в `games/` и их манифесты |
| `pnpm gf validate [id]` | проверить `game.json` |
| `pnpm games:build [id]` | собрать и опубликовать версию в `.data/` |
| `pnpm games:export [id]` | офлайн-архив для игр с `offline: true` |
| `pnpm gf new <id>` | новая игра из шаблона `vite-ts` |
| `pnpm gf check-prod` | та же `version`, что на проде, - то же содержимое? (`GF_PROD_GAME_URL`, D-044) |
| `pnpm play` | сервер игр |
| `pnpm hub` | хаб в режиме разработки (`next dev`, :3000) |
| `pnpm hub:build` / `pnpm hub:start` | сборка хаба / запуск собранного |
| `docker compose up --build` | хаб и сервер игр в контейнерах (игры — из `.data/` хоста) |
| `pnpm typecheck` | tsc без эмита |
| `pnpm test` | юнит-тесты (`node --test`) |
| `pnpm test:e2e` | браузерные тесты (Playwright, Chromium) |
| `pnpm check` | всё сразу, как в CI |

## Правила работы

Правила агента общие для всех проектов приезжают из `global-agent-kit`, правила
этого проекта — в [`CLAUDE.md`](CLAUDE.md). Порядок работы — [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
