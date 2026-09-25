#!/usr/bin/env bash
# Выкладка Game Factory на VPS-1: подтянуть образы и, если сменились, опубликовать игры
# и перезапустить хаб и сервер игр. Запускается таймером gf-update.timer раз в 5 минут.
#
# На сервере - копия root: /usr/local/sbin/gf-update (D-035). Руководство - docs/OPERATIONS.md.
#
#   gf-update            # обычный прогон: ничего не делает, если образы не сменились
#   gf-update --force    # публикация и up -d без сравнения (первый запуск, после отката)
set -euo pipefail

DIR=${GF_DEPLOY_DIR:-/etc/docker/containers/game-factory}
SERVICES=(games play hub)

[[ $EUID -eq 0 ]] || { echo "нужен root" >&2; exit 1; }
cd "$DIR"

# Второй запуск, пока идёт первый, просто выходит: таймер догонит следующим тиком.
exec 9> /run/gf-update.lock
flock -n 9 || { echo "уже идёт другой прогон"; exit 0; }

compose() { docker compose --profile publish "$@"; }

image_ids() {
  local s img
  for s in "${SERVICES[@]}"; do
    img=$(compose config --images "$s")
    docker image inspect --format '{{.Id}}' "$img" 2>/dev/null || echo "нет:$img"
  done
}

before=$(image_ids)
compose pull --quiet "${SERVICES[@]}"
after=$(image_ids)

if [[ $before == "$after" && ${1:-} != --force ]]; then
  exit 0
fi

echo "образы сменились, тег $(sed -n 's/^GF_IMAGE_TAG=//p' .env): публикация игр"
# Неизменяемость версий: при отказе games хаб и игры остаются на прежних образах.
if ! compose run --rm games; then
  echo "games упал - выкладка остановлена, работают прежние образы" >&2
  exit 1
fi

compose up -d --remove-orphans play hub
docker image prune -f --filter "label=org.opencontainers.image.source=https://github.com/sirrorist/game-factory" > /dev/null
echo "выложено: $(compose ps --format '{{.Service}} {{.Image}}' play hub | tr '\n' ' ')"
