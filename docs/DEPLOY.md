# Домены, CI/CD и будущий деплой

> Деплоя на VPS пока **нет** (D-017): владелец запускает на нём сессии агентов и собирает
> там же. Этот документ — план и то, что уже можно подготовить.

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

1. `pnpm install` (pnpm в CI сам включает `--frozen-lockfile`, если lockfile есть;
   пока его нет — предупреждение в логе, STATE.md)
2. `pnpm typecheck` → `pnpm test` → `pnpm games:build` → `pnpm games:export`
3. Chromium → `pnpm test:e2e`
4. Офлайн-архивы игр — артефакт `offline-games` на 14 дней

Права workflow — `contents: read`. Dependabot — раз в неделю для npm и Actions.

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
