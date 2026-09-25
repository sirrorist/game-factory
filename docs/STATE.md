# Состояние проекта

> Переписывается в конце каждой сессии. Каждое утверждение - с источником:
> **проверено** (команда и итог) / **со слов владельца** / **предположение**.

Обновлено: 2026-09-25, сессия №3 (на VPS-1: деплой, шаг 1 спецификации).

## Где мы

Этап **0а** - принят владельцем. Этап **0б** - сделан, **ждёт приёмки** на проде.
Деплой по [`specs/deploy-vps.md`](specs/deploy-vps.md): разведка ✅, изменения в репозитории ✅,
DNS ✅, **выкладка ✅ 2026-09-25** (`d381ef1`), таймер включён; сертификат `*.play` - П-037, приёмка - не закончена.
В ROADMAP у 0б всё ещё ⛔ "registry.npmjs.org" - снять и сменить статус решает владелец.

## Что сделано в сессии №3

- Разведка VPS-1 (ниже, раздел "VPS").
- Репозиторий сделан **публичным** (владелец: "давай сделаем репу публичной"; D-037) -
  после проверки всей истории на токены, ключи, адреса и почту: чисто.
- Рабочая копия `/srv/prod/games-factory`, remote `github-game-factory:…` по своему ключу
  (П-035). Ключ `~/.ssh/github-game-factory` создан и добавлен владельцем в GitHub с правом записи.
- `gf build --prebuilt` + тест; стадии `games-build` и `games` в `Dockerfile` (D-034).
- `deploy/compose.prod.yml` (метки Traefik, ужесточение, лимиты памяти, `games` без сети),
  `deploy/update.sh`, `deploy/gf-update.{service,timer}`, `deploy/.env.example` (D-035).
- `.github/workflows/publish.yml` - образы в GHCR после зелёного CI с `main` (П-033);
  `docker.yml` - проверка `compose.prod.yml` и повторного запуска `games`.
- Документы: новый [OPERATIONS.md](OPERATIONS.md) (руководство владельца), DEPLOY (как устроено),
  DECISIONS D-034…D-037, PITFALLS П-032…П-036, SECURITY "Прод", спецификация (итог разведки),
  CLAUDE.md ("Где работает агент"), карта документов.
- В базе инфраструктуры `infra-ctl`: карточка проекта `docs/projects/game-factory/README.md`,
  строки в сервисах и сети.

## Что проверено и чем

| Что | Как | Итог |
|---|---|---|
| ОС и архитектура VPS-1 | `uname -m`, `/etc/os-release` | x86_64, Ubuntu 24.04.4 |
| Ресурсы | `df -h /`, `free -m` | диск 69 %; свободно ~1,5 ГБ памяти, swap занят 1,4 ГБ |
| Traefik | `***/traefik.yml`, `traefik_dynamic.yml`; версия - база `infra-ctl` | 3.7.10; provider docker через `***`, сеть `traefik`, `exposedByDefault: false`; резолверы `letsencrypt` (HTTP-01) и `dns01` (Timeweb); на `websecure` - `compress` и HSTS 30 дней без `includeSubDomains`; `sniStrict: true` |
| DNS до правки | `dig @ns1.timeweb.ru` | `games` → `***` (**ошибка: ***, вход *****); `play`, `*.play` - нет |
| Новый веб-адрес | `ip -4 addr`, `/etc/network/interfaces`, `curl --resolve … 2.26.198.231` | `2.26.198.231` на `***`, переживёт перезагрузку; Traefik отвечает на нём (401 дашборда, сертификат валиден) - **только изнутри**, снаружи не проверено |
| Репозиторий | `gh api repos/sirrorist/game-factory` | был `private`, стал `public` |
| DNS после правки (владелец, Timeweb API: `games` id ***, `play` id ***, `*.play` id ***) | `dig @ns1.timeweb.ru` и `@1.1.1.1`: `games`, `play`, `snake.play`, `xyz.play` | все → `2.26.198.231` |
| Ключ развёртывания | `ssh -T github-game-factory` | "successfully authenticated" для `sirrorist/game-factory` |
| Секреты в истории | `git log --all -p` + шаблоны токенов/ключей, адресов, почты | ничего |
| `gf build --prebuilt` | `node --test tools/gf.test.ts` | 8 / 8 |
| Публикатор `games` без Docker | набор файлов как в образе, `gf build --prebuilt && gf export` дважды, затем правка без смены version | "опубликована" → "без изменений" → "неизменяема", exit 1 |
| `update.sh` | `shellcheck`, `bash -n` | чисто |
| `compose.prod.yml` | `docker compose config` | разбирается |
| Агент и Docker | `id` | `git-worker` не в группе `docker` (П-036) |

### Выкладка и приёмка на проде (2026-09-25)

| Что | Как | Итог |
|---|---|---|
| CI, Docker, Publish на `d381ef1` | `gh run list` | все `success` |
| Образы GHCR без токена | анонимный токен GHCR + манифест `:main` | 200 у `hub`, `play`, `games` |
| Первая выкладка (владелец) | `gf-update --force` | 3 игры "опубликована", 3 архива; `play` healthy, `hub` Up |
| Таймер | `systemctl list-timers`, `systemctl status gf-update.service` | следующий запуск через 5 мин; прогон по таймеру `status=0/SUCCESS` |
| 1. Каталог | `curl https://games.youranus.ru/` | Змейка, Звездопад, Три полосы |
| 3. Архивы | ссылки из хаба, `curl` | `play.youranus.ru/exports/<id>-1.0.0.zip`, 200 |
| 4. Заголовки хаба | `curl -sI` | `frame-ancestors 'none'`, `nosniff`, HSTS 30 дней, `X-Powered-By` нет |
| 5. Служебный хост | `curl` | `/index.html` 404, `/registry.json` 404, `/healthz` 200 |
| 7. Порты | `ss -tlnH` | 4100 нет; `127.0.0.1:3000` - Grafana инфраструктуры, не наш |
| 6. Сертификат `x.play` | `openssl s_client -servername snake.play…` | ✅ `*.play.youranus.ru` + `play.youranus.ru`, Let's Encrypt YR2, до 2026-12-24; выпуск занял ~55 мин (П-037) |

### Аудит "из веба в Docker" (2026-09-25)

| Что | Как | Итог |
|---|---|---|
| Docker API снаружи | `ss -tlnH` | `2375`/`2376` на хосте не слушаются |
| `***` | compose Traefik, `docker network inspect ***` (владелец) | только `traefik` и `***`; из хаба имя не резолвится |
| Соседи по сети `traefik` | `docker network inspect traefik` (владелец) | бот ***, ***, ***, ***, ***, *** + наши |
| Досягаемость из хаба | `docker exec game-factory-hub-1 node -e net.connect…` (владелец) | **открыты** `***:80`, `***:80`, хост `22`, `***`, интернет `1.1.1.1:443`; `9100` - таймаут → D-038 |
| После `gf-edge` (2026-09-26) | тот же зонд из хаба | `***`, `***` - `EAI_AGAIN`; `***:22`, `1.1.1.1:443` - `ENETUNREACH`; **но** шлюз `***:22` и `:***` открыты - хост отвечает в любой сети |
| После `ufw deny in from ***` | тот же зонд | `***:22`, `:***` - таймаут; игра 200; `vault` 200, `get/i/` 404 - соседи не задеты |
| Веб-адрес только 80/443 (`ufw deny in to 2.26.198.231`) | проверка с *** (***) | *** не достаёт до VPS-1 **ни на одном** адресе (и `***:443` закрыт) - проверка непоказательна; правило владелец откатил на всякий случай, **возвращается** с проверкой с телефона |

## Что НЕ проверено

- Образы `hub`/`play`/`games` через Docker и `publish.yml` - Docker агенту на VPS-1 недоступен;
  проверит CI (`docker.yml`, `publish.yml`) после пуша.
- Полный `pnpm check` на VPS-1 не гонялся (pnpm здесь не установлен); после пуша - CI.
- Всё, что после выкладки: 10 критериев приёмки спецификации.
- Выдаст ли Traefik `*.play.youranus.ru` через `dns01`: TXT пойдёт в `_acme-challenge.play`,
  а Timeweb держит поддомены отдельными сущностями - смотреть журнал Traefik при первом запросе.
- Публичность пакетов GHCR: новые пакеты по умолчанию могут создаться приватными.

## VPS

| Что | Значение |
|---|---|
| Сервер | VPS-1 (`nx`), x86_64 → образы `linux/amd64` |
| Веб-адрес | `2.26.198.231` (D-036); *** - `***`, `***` |
| Traefik | 3.7.10, `/etc/docker/containers/traefik/`, сеть `traefik` |
| Сертификаты | `gf-play`: `dns01` → только `*.play.youranus.ru` (П-037); `play`, `games` - действующий `*.youranus.ru` |
| Прод-конфиг | `/etc/docker/containers/game-factory/{compose.yml,.env}`, `/usr/local/sbin/gf-update` - установлены 2026-09-25 |
| Данные | том `game-factory_gf-data`; в restic **не** входит (воспроизводим из образов) - записано в `infra-ctl` |

## Блокеры

Нет. DNS исправлен и заведён, ключ добавлен, "да" на коммит и пуш получено (2026-09-25).

## Следующий шаг

1. П-037: пуш правки `compose.prod.yml` → переустановка копии (`OPERATIONS.md`, "Изменил deploy/")
   → сертификат `*.play.youranus.ru` выдан (проверка `openssl s_client -servername snake.play…`).
2. Остальные критерии: 2 (игра в хабе, рекорд), 4 (заголовки игры), 5 (`nope.play` 404,
   `Service-Worker: script` 403), 8 (выкладка по пушу ≤ 10 мин), 9 (откат), 10 (неизменяемость).
3. Владелец принимает 0б и решает про ⛔ в ROADMAP.

## Открытые вопросы к владельцу

- Приёмка 0б и снятие ⛔ в ROADMAP - после деплоя.
- Перевод остальных веб-сервисов VPS-1 на `2.26.198.231` - задача `infra-ctl` (T-180).

## Хэндовер: новая сессия

1. Первая строка ответа - канарейка (правило кита), нумерация ходов с 1.
2. `CLAUDE.md` ("Где работает агент"), этот файл, `docs/ROADMAP.md`, `docs/PITFALLS.md`.
3. **VPS-1:** продолжить с "Следующий шаг"; Docker - только через владельца (П-036).
4. **Облако:** `pnpm install && GF_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm check` -
   ожидается 45 юнит (добавлен тест `--prebuilt`), 20 e2e.

Контекст решений, который легко потерять:
- Игры собираются в CI, сервер только публикует (D-034); прод-конфиг - копии root (D-035).
- Веб - на отдельном адресе от *** (D-036). Репозиторий и образы публичные (D-037).
- Домен игр сейчас `*.play.youranus.ru`; новый домен - перед открытием (D-010).
- Офлайн-архив - только для статических игр (D-012). Хаб - гость без авторизации (D-024).
- MVP: коммит прямо в `main`, один на сессию, с "да" владельца (D-030). Минуты CI беречь (D-031).
