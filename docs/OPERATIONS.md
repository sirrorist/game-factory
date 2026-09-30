# Эксплуатация: как работать с проектом руками

> Руководство владельца. Как устроен прод, что делать каждый день и что - когда сломалось.
> Почему устроено именно так - [DECISIONS.md](DECISIONS.md) (D-033…D-037), домены и CI -
> [DEPLOY.md](DEPLOY.md).

## Карта: где что лежит

| Что | Где |
|---|---|
| Код | GitHub `sirrorist/game-factory`, ветка `main`, репозиторий **публичный** |
| Рабочая копия на сервере | VPS-1, у пользователя агента (путь - в приватной базе инфраструктуры, D-043) |
| Образы | GHCR: `ghcr.io/sirrorist/game-factory-{hub,play,games,migrate}`, теги `main` и `<sha коммита>`; база - `postgres:17-alpine` |
| Прод-конфиг на сервере | `/etc/docker/containers/game-factory/compose.yml` + `.env` (владелец `root`) |
| Скрипт выкладки | `/usr/local/sbin/gf-update` (копия `deploy/update.sh`, владелец `root`) |
| Таймер | `gf-update.timer` → `gf-update.service`, раз в 5 минут |
| Сеть | `gf-edge` - внутренняя, только наши контейнеры и Traefik (D-038); создаётся владельцем один раз |
| Данные | том Docker `game-factory_gf-data`: опубликованные версии игр, архивы, `registry.json` |
| База хаба (этап 1) | том `game-factory_gf-db`; сеть `gf-db` - внутренняя, только хаб и миграции; пароль - `secrets/db_password` рядом с `compose.yml` (D-047, D-051) |
| Адреса | хаб `https://games.youranus.ru`, игры `https://<id>.play.youranus.ru`, служебный `https://play.youranus.ru` |
| Сервер | VPS-1, адрес для веба `2.26.198.231` (отдельный, D-036) |

Файлы в `/etc/docker/containers/game-factory` и `/usr/local/sbin` - **копии** из `deploy/`,
а не ссылки на рабочую копию: их исполняет `root`, и правка из-под пользователя агента не должна
давать ему `root` (D-035). Поменял `deploy/` в репозитории - переустанови копии (ниже).

## Как код попадает в прод

```
коммиты → dev → CI (проверка, в прод не едет)
"да" владельца → dev переносится в main → CI → зелёный → Publish: образы в GHCR с тегами <sha> и main
→ через ≤ 5 минут таймер на VPS-1: pull → games публикует игры в том → up db → migrate → up -d play hub
```

- Работа идёт в `dev`, прод - это `main` (D-042). Выкатить `dev` на прод
  (только перемоткой, без force; ваш терминал, bash):

  ```bash
  git fetch origin
  git push origin origin/dev:main
  ```

  Отказ `non-fast-forward` значит, что в `main` есть коммиты, которых нет в `dev`, -
  не форсить, сначала разобраться.
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
3. Локально: `pnpm check`. Потом коммит и пуш в `dev`; на прод - переносом `dev` в `main` (выше).

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

Что откатывается: хаб, сервер игр и **реестр** - после отката каталог показывает версии игр
из образа `games` выбранного тега. Файлы более новой версии игры остаются в томе (опубликованная
версия неизменяема), но на них никто не ссылается; при возврате на `main` она снова станет
текущей - "без изменений", без повторной публикации.

### Проверить откат и возврат (критерий приёмки 9)

Делать, когда в GHCR есть хотя бы два тега (два пуша с кодом). Займёт минут пять.

1. Узнать текущий тег и предыдущий sha: GitHub → Actions → Publish, два последних
   успешных запуска; или `git log --oneline` - второй сверху коммит, который менял код.
2. Откатиться блоком выше, введя **предыдущий** sha.
3. Проверить: `docker compose ps` показывает образы с этим sha; в хабе - прошлая версия
   того, что менялось (например, версия игры в каталоге).
4. Вернуться тем же блоком, введя `main`.
5. Проверить: снова свежая версия; `journalctl -u gf-update` без ошибок.

## Изменил `deploy/` - переустановить на сервере

Нужно, когда поменялись `deploy/compose.prod.yml`, `deploy/update.sh` или unit-файлы.
Сначала подтянуть рабочую копию.

VPS-1, пользователь агента, fish (путь к рабочей копии спрашивается вводом):

```fish
read -P 'путь к рабочей копии: ' WC
cd $WC
git pull --ff-only
```

VPS-1, `root`, bash:

```bash
read -r -p 'путь к рабочей копии: ' WC
cd "$WC/deploy"
install -m 0644 compose.prod.yml /etc/docker/containers/game-factory/compose.yml
install -m 0755 update.sh /usr/local/sbin/gf-update
install -m 0644 gf-update.service gf-update.timer /etc/systemd/system/
systemctl daemon-reload
gf-update --force
```

`.env` этим блоком не трогается - тег остаётся прежним.

## Изоляция прода (D-038) - если сервер поднимают заново

Один раз при установке; `gf-update` и переустановка `deploy/` это не трогают.
Внутренняя сеть, общая только с Traefik:

VPS-1, `root`, bash:

```bash
docker network create --internal gf-edge
docker network connect gf-edge traefik
```

Правила файрвола хоста для `gf-edge` и веб-адреса - в приватной базе инфраструктуры
(это настройка сервера, а не проекта; D-043).

Чтобы Traefik не потерял сеть при пересоздании, `gf-edge` вписана и в его compose
(список сетей сервиса и `external: true` внизу) - это настройка Traefik владельца, а не этого
репозитория. Проверка: хаб и игра открываются с телефона через мобильную сеть.

## База хаба (этап 1) - установка один раз

Порядок важен: сначала пароль и сеть, потом новый `compose.yml` (раздел выше). Пока их нет,
новый хаб работает и без базы - `/healthz` отвечает 503 "db: не настроена".

VPS-1, `root`, bash. Пароль вводится скрыто и в историю команд не попадает:

```bash
cd /etc/docker/containers/game-factory
install -d -m 0700 secrets
read -rs -p 'пароль базы (длинный, случайный): ' P; echo
printf '%s' "$P" > secrets/db_password; unset P
chmod 0644 secrets/db_password
wc -c secrets/db_password
```

Права: каталог `0700` закрывает файл на хосте; `0644` нужен, потому что compose монтирует
файл с правами хоста, а читают его внутри postgres и node (П-044).

Сеть - внутренняя, с подсетью из приватной базы инфраструктуры: на неё там же правило
файрвола, иначе хаб дотянется через неё до хоста (как у `gf-edge`, D-038):

```bash
read -r -p 'подсеть gf-db: ' S
docker network create --internal --subnet "$S" gf-db
```

Проверка после `gf-update --force`:

```bash
curl -s https://games.youranus.ru/healthz        # ok
cd /etc/docker/containers/game-factory
GW=$(docker network inspect gf-db -f '{{(index .IPAM.Config 0).Gateway}}')
# Хаб через gf-db до хоста не дотягивается: ждём closed на 22 и на порт Docker API.
for port in 22 2375 2376; do
  docker compose exec -T hub node -e '
    const [h, p] = process.argv.slice(1);
    const s = require("node:net").connect({ host: h, port: +p, timeout: 3000 });
    const say = (x) => { console.log(h, p, x); process.exit(0); };
    s.on("connect", () => say("OPEN - правило файрвола не работает"));
    s.on("error", () => say("closed")); s.on("timeout", () => say("closed"));' "$GW" "$port"
done
```

Первая публикация образа `game-factory-migrate` в GHCR может оказаться приватной - тогда
`gf-update` на `pull` остановится целиком (и `play`, и `hub`). Агент проверяет анонимный
доступ после первого Publish; если приватный - в GitHub: Packages → `game-factory-migrate` →
Package settings → Change visibility → Public.

## База хаба - бэкап и восстановление

Перед каждой миграцией `gf-update` сам снимает дамп в `/var/backups/game-factory/`
(последние 10, только root): миграции идут только вперёд, это точка возврата.

Дамп снимается внутри контейнера и уходит ежедневным бэкапом сервера (как - приватная база
инфраструктуры, D-047). Снять дамп руками (VPS-1, `root`, bash):

```bash
cd /etc/docker/containers/game-factory
docker compose exec -T db pg_dump -U gf -d gf | gzip > /root/gf-db-$(date +%F).sql.gz
```

Восстановить в пустую базу (хаб на это время остановлен):

```bash
cd /etc/docker/containers/game-factory
systemctl stop gf-update.timer
docker compose stop hub
docker compose exec -T db dropdb -U gf gf
docker compose exec -T db createdb -U gf gf
read -r -p 'файл дампа: ' F
gunzip -c "$F" | docker compose exec -T db psql -U gf -d gf -v ON_ERROR_STOP=1
docker compose up -d hub
systemctl start gf-update.timer
```

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

- **Только сессия на VPS-1** (D-049) - и код, и сервер. Коммит в `dev` с твоим "да", пуш -
  твоим блоком; в `main` (прод) - перемоткой `dev`, отдельным "да". Новых веток агент не
  создаёт (D-042). У агента **нет `root` и нет доступа к Docker**: команды, меняющие сервер,
  он выдаёт блоками, выполняешь ты. Сборку хаба и e2e гоняет CI на пуше в `dev`.
- Начало любой сессии - `docs/STATE.md`; конец - STATE переписан (правило `CLAUDE.md`).
- Проект описан и в приватной базе инфраструктуры - там то, что касается сервера целиком
  (адреса, Traefik, файрвол, память, бэкап).
