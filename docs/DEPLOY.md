# Домены, CI/CD и будущий деплой

> Деплой на VPS-1 - D-033…D-037, задание - [`specs/deploy-vps.md`](specs/deploy-vps.md),
> работа руками - [OPERATIONS.md](OPERATIONS.md).

## Домены

| Имя | Назначение | Запись |
|---|---|---|
| `games.youranus.ru` | хаб | A → `2.26.198.231` (VPS-1, веб-адрес, D-036) |
| `play.youranus.ru` | служебный хост игр: архивы, обложки | A → `2.26.198.231` |
| `*.play.youranus.ru` | игры, `<id>.play.youranus.ru` | A → `2.26.198.231` |

DNS зоны `youranus.ru` - у Timeweb, записи заводятся через их API (команды - в базе
инфраструктуры `infra-ctl`, `11-SHELL.md`, `TPL:api-*`). AAAA не заводится: у остальных имён зоны их тоже нет.

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
- ✅ Зона у **Timeweb**, API есть; в Traefik владельца уже заведён резолвер `dns01`
  (`provider: timewebcloud`, токен - файлом). Роутер `gf-play` просит у него
  только `*.play.youranus.ru` (П-037), `play.youranus.ru` покрыт действующим `*.youranus.ru`; `games.youranus.ru` - обычный HTTP-01
  (резолвер `letsencrypt`).
- Токен API DNS - секрет: лежит на сервере у root, в репозиторий и в командную строку
  не попадает (правило кита).

## CI (GitHub Actions)

`.github/workflows/ci.yml`, на пуш в `main` и на PR:

Задача `check`:

1. `pnpm install --frozen-lockfile` - lockfile обязателен
2. `pnpm typecheck` → `pnpm test` → `pnpm games:build` → `pnpm games:export` → `pnpm hub:build`
3. Chromium → `pnpm test:e2e` (эталонный хаб, настоящий хаб, офлайн через `file://`)
4. Офлайн-архивы игр - артефакт `offline-games` на 14 дней

Workflow `docker.yml`: `docker compose build` - образы `hub` и `play` собираются
(не публикуются), только при изменении Docker-файлов или lockfile и вручную (D-031).
CI не запускается на коммиты, где правлена только документация.

Права workflow - `contents: read`. Dependabot - раз в месяц для npm и Actions,
минорные и патчи пачкой (D-031).

## CD - как устроено (D-034…D-037)

Руками с этим работать - [OPERATIONS.md](OPERATIONS.md). Здесь - устройство.

1. **Образы.** `publish.yml` по зелёному `CI` на `main` собирает цели `hub`, `play`, `games`
   (`linux/amd64`, VPS-1 - x86_64) и кладёт в GHCR с тегами `<sha>` и `main`. Права
   `packages: write` - только у этого workflow. Пакеты GHCR публичные: токен на сервере не нужен.
2. **Игры собираются в CI**, в образ `games` (D-034). На сервере одноразовый контейнер
   только публикует их в постоянный том `gf-data` (`gf build --prebuilt && gf export`):
   ни pnpm, ни Vite на VPS-1 нет, а неизменяемость версий проверяется тем же кодом.
3. **Доставка - таймер на VPS-1** (вариант А спецификации): `gf-update.timer` раз в 5 минут
   тянет образы; если сменились - `games`, и только при его успехе `up -d play hub`.
   В GitHub нет ключей от сервера, входящих соединений нет.
4. **Прод-конфиг - копии root** в `/etc/docker/containers/game-factory/` и
   `/usr/local/sbin/gf-update` (D-035), а не файлы рабочей копии.
5. **Traefik** владельца (3.7, provider docker, сеть `traefik`): маршруты - метками в
   `deploy/compose.prod.yml`. Портов наружу у контейнеров нет.
6. **Откат** - `GF_IMAGE_TAG=<sha>` в `.env` и `gf-update --force`; он же заморозка.

Workflow `docker.yml` (на PR и при правке Docker-файлов/`deploy/`) дополнительно проверяет,
что `compose.prod.yml` разбирается и что образ `games` при повторном запуске в тот же том
говорит "без изменений".

Все команды для VPS готовит агент блоками (машина, пользователь, оболочка; откат -
отдельным блоком), выполняет владелец - правило кита про чужие машины.
