# Эксплуатация: как работать с проектом руками

> Руководство владельца. Как устроен прод, что делать каждый день и что - когда сломалось.
> Почему устроено именно так - [DECISIONS.md](DECISIONS.md) (D-033…D-037), домены и CI -
> [DEPLOY.md](DEPLOY.md).

## Карта: где что лежит

| Что | Где |
|---|---|
| Код | GitHub `sirrorist/game-factory`, ветка `main`, репозиторий **публичный** |
| Рабочая копия на сервере | VPS-1, `/srv/prod/games-factory` (пользователь `git-worker`, ключ `github-game-factory`) |
| Образы | GHCR: `ghcr.io/sirrorist/game-factory-{hub,play,games}`, теги `main` и `<sha коммита>` |
| Прод-конфиг на сервере | `/etc/docker/containers/game-factory/compose.yml` + `.env` (владелец `root`) |
| Скрипт выкладки | `/usr/local/sbin/gf-update` (копия `deploy/update.sh`, владелец `root`) |
| Таймер | `gf-update.timer` → `gf-update.service`, раз в 5 минут |
| Данные | том Docker `game-factory_gf-data`: опубликованные версии игр, архивы, `registry.json` |
| Адреса | хаб `https://games.youranus.ru`, игры `https://<id>.play.youranus.ru`, служебный `https://play.youranus.ru` |
| Сервер | VPS-1, адрес для веба `2.26.198.231` (отдельно от адресов ***, D-036) |

Файлы в `/etc/docker/containers/game-factory` и `/usr/local/sbin` - **копии** из `deploy/`,
а не ссылки на рабочую копию: их исполняет `root`, и правка из-под `git-worker` не должна
давать ему `root` (D-035). Поменял `deploy/` в репозитории - переустанови копии (ниже).

## Как код попадает в прод

```
git push в main → CI (типы, тесты, сборка, e2e) → зелёный → Publish: образы в GHCR с тегами <sha> и main
→ через ≤ 5 минут таймер на VPS-1: pull → games публикует игры в том → up -d play hub
```

- Правки только документации CI не запускают и в прод не едут (D-031).
- Красный CI - образов нет, прод не меняется.
- `games` упал (чаще всего "версия неизменяема") - хаб и игры остаются на прежних образах,
  таймер пробует снова каждые 5 минут и снова падает, пока не поправишь.

## Каждый день

### Посмотреть, что крутится

VPS-1, `root`, bash:

```bash
cd /etc/docker/containers/game-factory
docker compose ps
grep GF_IMAGE_TAG .env
systemctl list-timers gf-update.timer --no-pager
```

### Журнал выкладки

VPS-1, `root`, bash:

```bash
journalctl -u gf-update --since today --no-pager | tail -n 40
```

Пусто или только старт/финиш службы - образы не менялись, это норма.

### Логи хаба и сервера игр

VPS-1, `root`, bash:

```bash
cd /etc/docker/containers/game-factory
docker compose logs --tail 100 hub
docker compose logs --tail 100 play
```

### Проверить снаружи, что всё живо

Любая машина, любой пользователь, bash:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://games.youranus.ru/
curl -sS -o /dev/null -w '%{http_code}\n' https://snake.play.youranus.ru/
curl -sS -o /dev/null -w '%{http_code}\n' https://play.youranus.ru/healthz
```

Ожидается `200` все три раза.

## Игры

### Выпустить новую версию игры

1. Правишь игру в `games/<id>/`.
2. **Поднимаешь `version` в `games/<id>/game.json`** (например `1.0.0` → `1.0.1`).
   Без этого прод откажется публиковать: опубликованная версия неизменяема.
3. Локально: `pnpm check`. Потом коммит и пуш в `main`.

### Добавить новую игру

```bash
pnpm gf new <id>          # копия шаблона templates/vite-ts в games/<id>
pnpm install
pnpm --filter @gf-game/<id> dev    # разработка с перезагрузкой
pnpm check                          # перед пушем
```

Подробности про манифест и офлайн - [GAMES.md](GAMES.md). Поддомен появится сам:
`<id>.play.youranus.ru` покрыт wildcard-записью и wildcard-сертификатом.

### "версия X уже опубликована с другим содержимым"

В журнале `gf-update` это выглядит так:

```
gf: игра "snake": версия 1.0.0 уже опубликована с другим содержимым.
games упал - выкладка остановлена, работают прежние образы
```

Причина - игра изменилась без смены `version`. Бывает и без правки игры: обновление
Phaser/Three/Vite меняет собранный бандл (П-034). Лечение - поднять `version` у этой
игры и запушить. **Не** чистить том и **не** запускать `--replace` на сервере: это и есть
подмена опубликованной версии, от которой защищает проверка.

## Откат и заморозка

Откат - закрепить прошлый тег. Он же замораживает автообновление: тег `<sha>` больше не
меняется, таймер ничего не тянет.

1. Найти sha: GitHub → Actions → Publish, или `git log --oneline` в рабочей копии.
2. VPS-1, `root`, bash (sha спрашивается вводом, чтобы не вставлять в команду руками):

```bash
cd /etc/docker/containers/game-factory
read -r -p 'sha коммита для отката: ' SHA
sed -i "s/^GF_IMAGE_TAG=.*/GF_IMAGE_TAG=$SHA/" .env
grep GF_IMAGE_TAG .env
gf-update --force
```

Вернуться на автообновление - тем же блоком, введя `main` вместо sha.

⚠️ Откат образов не откатывает игры в томе: версия игры, опубликованная позже, останется
опубликованной, а реестр покажет то, что лежит в образе `games` выбранного тега.

## Изменил `deploy/` - переустановить на сервере

Нужно, когда поменялись `deploy/compose.prod.yml`, `deploy/update.sh` или unit-файлы.
Сначала подтянуть рабочую копию.

VPS-1, `git-worker`, fish:

```fish
cd /srv/prod/games-factory
git pull --ff-only
```

VPS-1, `root`, bash:

```bash
cd /srv/prod/games-factory/deploy
install -m 0644 compose.prod.yml /etc/docker/containers/game-factory/compose.yml
install -m 0755 update.sh /usr/local/sbin/gf-update
install -m 0644 gf-update.service gf-update.timer /etc/systemd/system/
systemctl daemon-reload
gf-update --force
```

`.env` этим блоком не трогается - тег остаётся прежним.

## Перезапуск и остановка

VPS-1, `root`, bash:

```bash
cd /etc/docker/containers/game-factory
docker compose restart hub play
```

Остановить прод целиком (таймер тоже, иначе он поднимет обратно):

```bash
systemctl stop gf-update.timer
cd /etc/docker/containers/game-factory
docker compose down
```

Откат остановки - отдельно:

```bash
cd /etc/docker/containers/game-factory
docker compose up -d play hub
systemctl start gf-update.timer
```

## Локальная работа

| Задача | Команда |
|---|---|
| Всё, как в CI | `pnpm check` |
| Хаб с перезагрузкой | `pnpm play` в одном окне, `pnpm hub` в другом |
| Игры в хранилище | `pnpm games:build && pnpm games:export` |
| Прод-образы у себя | `docker build --target games .` и т. д. - см. `deploy/compose.prod.yml` |

Полный список - [README.md](../README.md), ход работы - [DEVELOPMENT.md](DEVELOPMENT.md).

## Сессии агентов

- **Облачная сессия** (claude.ai/code) - код и документы. Коммит в `main` с твоим "да".
- **Сессия на VPS-1** (`/srv/prod/games-factory`) - всё про сервер. Агент на VPS-1 -
  пользователь `git-worker`: **нет `root` и нет доступа к Docker**. Команды, меняющие
  сервер, он выдаёт блоками, выполняешь ты.
- Начало любой сессии - `docs/STATE.md`; конец - STATE переписан (правило `CLAUDE.md`).
- Проект описан и в базе инфраструктуры: `infra-ctl/docs/projects/game-factory/README.md` -
  там то, что касается сервера целиком (адреса, Traefik, память, бэкап).
