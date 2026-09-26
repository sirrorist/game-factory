# Игры

## Каталог

| id | Название | Версия | Тип | Офлайн | Статус | Заметки |
|---|---|---|---|---|---|---|
| `snake` | Змейка | 1.0.0 | static / static | да | в каталоге | эталон статической игры, покрыта e2e |
| `phaser-2d` | Звездопад | 1.1.0 | static / vite-ts | да | в каталоге | эталон 2D на Phaser 4; текстуры рисуются кодом; уровни сложности каждые 20 с (D-040); просит `fullscreen`; покрыта e2e |
| `three-3d` | Три полосы | 1.0.0 | static / vite-ts | да | в каталоге | эталон 3D на Three.js (WebGL); просит `fullscreen`; покрыта e2e |

Шаблон `templates/vite-ts` - не игра и в каталог не попадает, но собирается и проверяется
типами вместе со всеми (пакет рабочей области), чтобы не протухал.

## Как добавить игру на TypeScript + Vite (основной путь)

1. `pnpm gf new my-game` - копия `templates/vite-ts` в `games/my-game/` с нужными id и именем пакета.
2. `pnpm install` - подтянуть зависимости рабочей области; движок - `pnpm --filter @gf-game/my-game add phaser`.
3. Поправить `title`, `description`, `tags`, `permissions` в `game.json`; код - в `src/main.ts`.
4. `pnpm --filter @gf-game/my-game dev` - Vite с горячей перезагрузкой (SDK в режиме `standalone`).
5. `pnpm games:build my-game && pnpm games:export my-game`, потом `pnpm play` + `pnpm hub`.
6. Строка в таблицу выше; офлайн-игру - в списки `tests/e2e/offline.test.ts` и `tests/e2e/hub.test.ts`.

Требования офлайн-сборки для движков: без `fetch`/XHR за ассетами (П-002) - картинки
импортом в код (станут `data:`-URL) или рисовать кодом; без top-level `await` (П-018).

## Как добавить статическую игру (без сборки)

1. Папка `games/<id>/`, где `<id>` - будущий поддомен: `a-z`, `0-9`, дефис, до 40 символов.
2. `game.json` (схема подхватится редактором через `$schema`):

   ```json
   {
     "$schema": "../../packages/manifest/game.schema.json",
     "id": "my-game",
     "title": "Моя игра",
     "version": "1.0.0",
     "kind": "static",
     "toolchain": "static",
     "source": "src",
     "entry": "index.html",
     "offline": true,
     "permissions": ["saves", "leaderboard"],
     "tags": ["arcade"],
     "cover": "cover.svg"
   }
   ```

3. `package.json` с `"private": true` (игра - пакет рабочей области pnpm).
4. Исходники в `src/`, SDK - `<script src="gf-sdk.js">` (SDK.md).
5. `pnpm gf validate my-game && pnpm games:build my-game && pnpm games:export my-game`.
6. Открыть `http://my-game.play.localhost:4100/` (после `pnpm play`) и архив через `file://`.
7. Строка в таблицу выше; если игра офлайн - добавить её в `tests/e2e/offline.test.ts`.

## Поля манифеста

| Поле | Обяз. | Что | Правила |
|---|---|---|---|
| `id` | да | поддомен игры | `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`, не из зарезервированных (`www`, `api`, `admin`, `hub`, `play`, `cdn`…) |
| `title` | да | название | 1-80 символов |
| `version` | да | версия | semver; опубликованную не перезаписать |
| `description` | нет | описание | до 500 символов |
| `kind` | да | `static` / `server` | `server` - этап 3 |
| `toolchain` | да | чем собирается | `static`, `vite-ts`, `prebuilt`; `rust-wasm`, `godot`, `docker` - запланированы |
| `source` | нет | папка исходников (для `static`) | по умолчанию `src` |
| `output` | нет | папка сборки (для остальных) | по умолчанию `dist`; для `static` запрещён |
| `entry` | да | входной HTML | относительный путь, `.html` |
| `offline` | да | можно скачать архивом | только для `kind: static`; вход должен быть `index.html` |
| `permissions` | да | что игра просит | `saves`, `leaderboard`, `multiplayer`, `fullscreen`, `pointer-lock`, `gamepad`, `audio` |
| `tags` | да | теги | до 10, `a-z0-9-` до 24 символов |
| `cover` | нет | обложка | png / jpg / webp / svg внутри пакета |
| `authors` | нет | авторы | до 10 строк |

Неизвестное поле - ошибка: так ловятся опечатки вроде `permisions`.

## Toolchain

| toolchain | Что делает `gf build` | Статус |
|---|---|---|
| `static` | берёт папку `source` как есть | работает |
| `prebuilt` | берёт готовую папку `output` (экспорт Godot, Unity WebGL, чужая сборка) | работает |
| `vite-ts` | `pnpm run build` в папке игры (Vite + `@gf/vite-config`), потом `output` | работает: `phaser-2d`, `three-3d` |
| `rust-wasm` | сборка `wasm-pack` / `trunk` в контейнере | этап 2 |
| `godot` | экспорт в контейнере | этап 2 |
| `docker` | серверная часть игры | этап 3 |

## Требования к офлайн-играм

Архив открывают двойным кликом, то есть через `file://`. Там не работают:

- `<script type="module" src="…">` - **ошибка** `gf export`;
- `fetch()` и `XMLHttpRequest` к локальным файлам - **предупреждение**;
- динамический `import()` - **предупреждение**.

Работают: классические `<script src>`, встроенный `<script type="module">…</script>`,
`<img>`, `<audio>`, CSS, `data:`-URL. Для Vite-игр - офлайн-режим `@gf/vite-config`:
один `index.html`, скрипт внутри - классический (IIFE), CSS и ассеты встроены. Окончательная проверка - e2e через `file://`, статическая - только подсказка.

## Ограничения пакета

Сборка отвергает: симлинки, скрытые файлы (`.env`, `.git` и т. п.), больше 2000 файлов,
файл больше 50 МБ, пакет больше 200 МБ. Сервер игр отдаёт только типы из белого списка
(`apps/play-server/src/mime.ts`).
