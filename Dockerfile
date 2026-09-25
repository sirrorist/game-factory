# syntax=docker/dockerfile:1
# Образы хаба, сервера игр и публикатора игр.
# Локально (docker-compose.yml) игры собираются на хосте и монтируются в /data.
# В проде (deploy/compose.prod.yml) их публикует в том одноразовый контейнер games (D-034).

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# --- хаб: зависимости только его и пакетов рабочей области, от которых он зависит
FROM base AS hub-build
COPY . .
# extra_ca - необязательный корневой сертификат, если сеть идёт через TLS-прокси
# (облачная среда агента, корпоративный прокси): `docker build --secret id=extra_ca,src=…`.
# В образ он не попадает. Без секрета шаг работает как обычно.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --filter "@gf/hub..."
RUN GF_HUB_STANDALONE=1 pnpm --filter @gf/hub build

FROM ${NODE_IMAGE} AS hub
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 GF_DATA_DIR=/data
WORKDIR /app
COPY --from=hub-build /repo/apps/hub/.next/standalone ./
COPY --from=hub-build /repo/apps/hub/.next/static ./apps/hub/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/hub/server.js"]

# --- сервер игр: ядро без зависимостей (D-013), node_modules не нужен вовсе
FROM ${NODE_IMAGE} AS play
ENV GF_PLAY_HOST=0.0.0.0 GF_DATA_DIR=/data
WORKDIR /app
# package.json нужны ради "type": "module": по ним Node решает, как исполнять .ts.
COPY package.json ./
COPY apps/play-server/package.json apps/play-server/
COPY apps/play-server/src apps/play-server/src/
COPY packages/manifest/package.json packages/manifest/
COPY packages/manifest/src packages/manifest/src/
COPY packages/registry/package.json packages/registry/
COPY packages/registry/src packages/registry/src/
USER node
EXPOSE 4100
CMD ["node", "apps/play-server/src/main.ts"]

# --- игры: сборка Vite здесь, в CI; на сервере - только публикация (D-034)
FROM base AS games-build
COPY . .
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --filter "@gf-game/*..."
RUN pnpm --filter "@gf-game/*" --if-present run build \
    && rm -rf games/*/node_modules

# Публикатор: gf build --prebuilt && gf export в постоянный том /data. Версия, опубликованная
# с другим содержимым, валит запуск ("неизменяема") - и выкладка останавливается на старом.
FROM ${NODE_IMAGE} AS games
ENV GF_DATA_DIR=/data
WORKDIR /app
# package.json нужны ради "type": "module": по ним Node решает, как исполнять .ts.
COPY package.json ./
COPY tools/gf.ts tools/
COPY tools/lib/files.ts tools/lib/zip.ts tools/lib/
COPY packages/manifest/package.json packages/manifest/
COPY packages/manifest/src packages/manifest/src/
COPY packages/registry/package.json packages/registry/
COPY packages/registry/src packages/registry/src/
COPY packages/game-sdk/gf-sdk.js packages/game-sdk/
COPY --from=games-build /repo/games games/
# Новый именованный том Docker заполняет из образа вместе с владельцем: /data - пользователя node.
RUN mkdir /data && chown node:node /data
USER node
CMD ["sh", "-c", "node tools/gf.ts build --prebuilt && node tools/gf.ts export"]
