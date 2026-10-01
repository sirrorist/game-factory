# Домены, CI/CD и выкладка на прод

> Как устроено. Почему так - D-033…D-038, D-051; исходное задание - [`specs/deploy-vps.md`](specs/deploy-vps.md)
> (выполнено); работа руками - [OPERATIONS.md](OPERATIONS.md).

## Домены

| Имя | Назначение | Запись |
|---|---|---|
| `games.youranus.ru` | хаб | A → `2.26.198.231` (веб-адрес, D-036) |
| `play.youranus.ru` | служебный хост игр: архивы, обложки | A → `2.26.198.231` |
| `*.play.youranus.ru` | игры, `<id>.play.youranus.ru` | A → `2.26.198.231` |

Записи заводит владелец через API DNS-провайдера (как - в приватной базе инфраструктуры).
AAAA не заводится.

- `*-play.youranus.ru` невозможен (П-004); `*.play.youranus.ru` - правильная форма.
- Wildcard-запись **не покрывает** сам `play.youranus.ru` - для него нужна отдельная запись.
- Wildcard резолвит любые имена, поэтому сервер игр обязан отвечать 404 на неизвестный
  id - так и сделано (`server.test.ts`).
- Перед открытием платформы - отдельный регистрируемый домен для игр (D-010).

## Сертификаты

- Let's Encrypt, **бесплатно**. Wildcard `*.play.youranus.ru` выдаётся только через
  DNS-01 (TXT-запись `_acme-challenge.play.youranus.ru`).
- Сертификат живёт 90 дней, поэтому нужен API DNS-провайдера: Traefik (через lego)
  сам создаёт TXT-запись и продлевает. Поддерживаются, среди прочих, Cloudflare,
  REG.RU, Selectel, Yandex Cloud DNS.
- ✅ API у DNS-провайдера есть, в Traefik владельца заведён резолвер `dns01`. Роутер
  `gf-play` просит у него только `*.play.youranus.ru` (`play.youranus.ru` покрыт
  действующим `*.youranus.ru`); первый выпуск - около часа (П-037). `games.youranus.ru` -
  обычный HTTP-01 (резолвер `letsencrypt`).
- Токен API DNS - секрет: в репозиторий и в командную строку не попадает (правило кита).

## CI (GitHub Actions)

`.github/workflows/ci.yml`, на пуш в `dev` и `main` и на PR (публикация в прод - только с `main`, D-042):

Задача `check`:

1. `pnpm install --frozen-lockfile` - lockfile обязателен
2. `pnpm typecheck` → `pnpm test` → `pnpm test:db` → `pnpm games:build` → `gf check-prod`
   (та же `version`, что на проде, - то же содержимое, D-044) → `pnpm games:export` →
   `pnpm hub:build`
3. Chromium → `pnpm test:e2e` (эталонный хаб, настоящий хаб, офлайн через `file://`)
4. Офлайн-архивы игр - артефакт `offline-games` на 14 дней

CI не запускается на коммиты, где правлена только документация (D-031); вручную - кнопкой
Run workflow (П-038).

Workflow `docker.yml` - только при изменении `Dockerfile`, compose-файлов, `deploy/`,
`packages/db/`, lockfile и вручную (D-031). Образы собираются, но не публикуются; кроме того:

- `deploy/compose.prod.yml` разбирается (`config`);
- образ `games` публикует игры в том, а повторный запуск в тот же том говорит "без изменений";
- `db` поднимается ровно по `compose.prod.yml`, миграции проходят дважды, таблицы на месте;
- зонд сети: `migrate` видит базу, `play` - нет ни по имени, ни по адресу.

Права workflow - `contents: read`. Dependabot - раз в месяц, в ветку `dev`: npm (минорные и
патчи пачкой), Actions, образ базы в `deploy/` (по digest); мажор Postgres не предлагается -
это решение, а не PR (D-051).

## CD - как устроено (D-034…D-038, D-051)

Руками с этим работать - [OPERATIONS.md](OPERATIONS.md). Здесь - устройство.

1. **Образы.** `publish.yml` по зелёному `CI` на `main` собирает цели `hub`, `play`, `games`,
   `migrate` (`linux/amd64`, VPS-1 - x86_64) и кладёт в GHCR с тегами `<sha>` и `main`. Права
   `packages: write` - только у этого workflow. Пакеты GHCR публичные: токен на сервере не нужен.
   База - `postgres:17-alpine`, закреплённая digest'ом в `compose.prod.yml`.
2. **Игры собираются в CI**, в образ `games` (D-034). На сервере одноразовый контейнер
   только публикует их в постоянный том `gf-data` (`gf build --prebuilt && gf export`):
   ни pnpm, ни Vite на VPS-1 нет, а неизменяемость версий проверяется тем же кодом.
3. **Доставка - таймер на VPS-1** (вариант А спецификации): `gf-update.timer` раз в 5 минут
   тянет образы. Если сменились: `games` → `db` → дамп базы в `/var/backups/game-factory`
   (через `.part`, последние 10, П-046) → `migrate` → `up -d db play hub`. Упал любой шаг -
   выкладка стоит, работают прежние образы. В GitHub нет ключей от сервера, входящих
   соединений нет.
4. **Прод-конфиг - копии root** в `/etc/docker/containers/game-factory/` и
   `/usr/local/sbin/gf-update` (D-035), а не файлы рабочей копии.
5. **Traefik** владельца (provider docker): маршруты - метками в
   `deploy/compose.prod.yml`, общая с ним сеть - `gf-edge` (D-038). База - в своей сети
   `gf-db`, где только `db`, `migrate` и хаб (D-051). Портов наружу у контейнеров нет.
6. **Откат** - `GF_IMAGE_TAG=<sha>` в `.env` и `gf-update --force`; он же заморозка.
   Миграции только расширяющие (D-051), поэтому прежний хаб работает на новой схеме.

Все команды для VPS готовит агент блоками (машина, пользователь, оболочка; откат -
отдельным блоком), выполняет владелец - правило кита про чужие машины.
