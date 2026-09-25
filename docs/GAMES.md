# Игры

## Каталог

| id | Название | Версия | Тип | Офлайн | Статус | Заметки |
|---|---|---|---|---|---|---|
| `snake` | Змейка | 1.0.0 | static / static | да | в каталоге | эталон статической игры, покрыта e2e |
| `phaser-2d` | демо Phaser 4 | — | static / vite-ts | да | этап 0б | нужен npm |
| `three-3d` | демо Three.js | — | static / vite-ts | да | этап 0б | нужен npm |

## Как добавить игру

1. Папка `games/<id>/`, где `<id>` — будущий поддомен: `a-z`, `0-9`, дефис, до 40 символов.
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

3. `package.json` с `"private": true` (игра — пакет рабочей области pnpm).
4. Исходники в `src/`, SDK — `<script src="gf-sdk.js">` (SDK.md).
5. `pnpm gf validate my-game && pnpm games:build my-game && pnpm games:export my-game`.
6. Открыть `http://my-game.play.localhost:4100/` (после `pnpm play`) и архив через `file://`.
7. Строка в таблицу выше; если игра офлайн — добавить её в `tests/e2e/offline.test.ts`.

## Поля манифеста

| Поле | Обяз. | Что | Правила |
|---|---|---|---|
| `id` | да | поддомен игры | `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`, не из зарезервированных (`www`, `api`, `admin`, `hub`, `play`, `cdn`…) |
| `title` | да | название | 1–80 символов |
| `version` | да | версия | semver; опубликованную не перезаписать |
| `description` | нет | описание | до 500 символов |
| `kind` | да | `static` / `server` | `server` — этап 3 |
| `toolchain` | да | чем собирается | `static`, `vite-ts`, `prebuilt`; `rust-wasm`, `godot`, `docker` — запланированы |
| `source` | нет | папка исходников (для `static`) | по умолчанию `src` |
| `output` | нет | папка сборки (для остальных) | по умолчанию `dist`; для `static` запрещён |
| `entry` | да | входной HTML | относительный путь, `.html` |
| `offline` | да | можно скачать архивом | только для `kind: static`; вход должен быть `index.html` |
| `permissions` | да | что игра просит | `saves`, `leaderboard`, `multiplayer`, `fullscreen`, `pointer-lock`, `gamepad`, `audio` |
| `tags` | да | теги | до 10, `a-z0-9-` до 24 символов |
| `cover` | нет | обложка | png / jpg / webp / svg внутри пакета |
| `authors` | нет | авторы | до 10 строк |

Неизвестное поле — ошибка: так ловятся опечатки вроде `permisions`.

## Toolchain

| toolchain | Что делает `gf build` | Статус |
|---|---|---|
| `static` | берёт папку `source` как есть | работает |
| `prebuilt` | берёт готовую папку `output` (экспорт Godot, Unity WebGL, чужая сборка) | работает |
| `vite-ts` | `pnpm run build` в папке игры, потом `output` | код есть, проверится на этапе 0б |
| `rust-wasm` | сборка `wasm-pack` / `trunk` в контейнере | этап 2 |
| `godot` | экспорт в контейнере | этап 2 |
| `docker` | серверная часть игры | этап 3 |

## Требования к офлайн-играм

Архив открывают двойным кликом, то есть через `file://`. Там не работают:

- `<script type="module" src="…">` — **ошибка** `gf export`;
- `fetch()` и `XMLHttpRequest` к локальным файлам — **предупреждение**;
- динамический `import()` — **предупреждение**.

Работают: классические `<script src>`, встроенный `<script type="module">…</script>`,
`<img>`, `<audio>`, CSS, `data:`-URL. Для Vite-игр — офлайн-режим сборки в один HTML
(этап 0б). Окончательная проверка — e2e через `file://`, статическая — только подсказка.

## Ограничения пакета

Сборка отвергает: симлинки, скрытые файлы (`.env`, `.git` и т. п.), больше 2000 файлов,
файл больше 50 МБ, пакет больше 200 МБ. Сервер игр отдаёт только типы из белого списка
(`apps/play-server/src/mime.ts`).
