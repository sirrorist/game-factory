# Официальный Node 22; digest индекса сверен с Docker Hub, linux/amd64 присутствует.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY apps/mail-relay/src apps/mail-relay/src/
USER node
CMD ["node", "apps/mail-relay/src/main.ts"]
