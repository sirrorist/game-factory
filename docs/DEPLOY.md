# Домены, CI/CD и будущий деплой

> Деплой на VPS решён (D-033), настраивается по [`specs/deploy-vps.md`](specs/deploy-vps.md)
> в сессии агента на VPS. Пока та сессия не отчиталась, раздел «CD» ниже — план.

## Домены

| Имя | Назначение | Запись |
|---|---|---|
| `games.youranus.ru` | хаб | A / AAAA → IP VPS |
| `play.youranus.ru` | служебный хост игр: архивы, обложки | A / AAAA → IP VPS |
| `*.play.youranus.ru` | игры, `<id>.play.youranus.ru` | A / AAAA → IP VPS |

- `*-play.youranus.ru` невозможен (П-004); `*.play.youranus.ru` — правильная форма.
- Wildcard-запись **не покрывает** сам `play.youranus.ru` — для него нужна отдельная запись.
- Wildcard резолвит любые имена, поэтому сервер игр обязан отвечать 404 на неизвестный
  id — так и сделано (`server.test.ts`).
- Перед открытием платформы — отдельный регистрируемый домен для игр (D-010).

## Сертификаты

- Let's Encrypt, **бесплатно**. Wildcard `*.play.youranus.ru` выдаётся только через
  DNS-01 (TXT-запись `_acme-challenge.play.youranus.ru`).
- Сертификат живёт 90 дней, поэтому нужен API DNS-провайдера: Traefik (через lego)
  сам создаёт TXT-запись и продлевает. Поддерживаются, среди прочих, Cloudflare,
  REG.RU, Selectel, Yandex Cloud DNS.
- ❓ **Открытый вопрос:** у какого провайдера DNS-зона `youranus.ru` и есть ли у него API.
- Токен API DNS — секрет: вводится скрыто на сервере, в репозиторий и в командную
  строку не попадает (правило кита).

## CI (GitHub Actions)

`.github/workflows/ci.yml`, на пуш в `main` и на PR:

Задача `check`:

1. `pnpm install --frozen-lockfile` — lockfile обязателен
2. `pnpm typecheck` → `pnpm test` → `pnpm games:build` → `pnpm games:export` → `pnpm hub:build`
3. Chromium → `pnpm test:e2e` (эталонный хаб, настоящий хаб, офлайн через `file://`)
4. Офлайн-архивы игр — артефакт `offline-games` на 14 дней

Workflow `docker.yml`: `docker compose build` — образы `hub` и `play` собираются
(не публикуются), только при изменении Docker-файлов или lockfile и вручную (D-031).
CI не запускается на коммиты, где правлена только документация.

Права workflow — `contents: read`. Dependabot — раз в месяц для npm и Actions,
минорные и патчи пачкой (D-031).

## CD — план

Когда владелец решит разворачивать:

1. **Образы** — CI собирает образы `hub` и `play-server` и кладёт в GHCR (`ghcr.io`)
   с тегом коммита.
2. **Доставка** — один из вариантов, выбрать при деплое:
   - self-hosted runner GitHub на VPS: `docker compose pull && up -d`;
   - или workflow по SSH с ключом только на деплой (ключ — секрет GitHub Environment
     `production` с ручным подтверждением).
3. **На VPS** — `docker compose`: Traefik (TLS, wildcard), hub, play-server; позже Postgres,
   Valkey, MinIO. Данные — именованные тома; бэкап — отдельной задачей.
4. **Откат** — предыдущий тег образа; версии игр откатываются в админке (этап 2).

Все команды для VPS готовит агент блоками (машина, пользователь, оболочка; откат —
отдельным блоком), выполняет владелец — правило кита про чужие машины.
