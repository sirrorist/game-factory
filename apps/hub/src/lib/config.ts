// Настройки хаба из окружения. Читаются на каждый запрос (страницы динамические),
// поэтому один и тот же образ работает и локально, и на сервере.

import { resolve } from 'node:path';

export interface HubConfig {
  /** Где лежат registry.json и хранилище игр (общее с play-server). */
  dataDir: string;
  /** Origin игры, как его видит браузер: http://snake.play.localhost:4100 */
  gameOrigin(id: string): string;
  /** Служебный хост игр: архивы и обложки. */
  playRootOrigin: string;
}

const DEFAULT_TEMPLATE = 'http://{id}.play.localhost:4100';

export function hubConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const template = env.GF_PLAY_PUBLIC_ORIGIN_TEMPLATE || DEFAULT_TEMPLATE;
  // Игра — ровно поддомен служебного хоста: шаблон вида <схема>://{id}.<хост>[:порт].
  if (!/^https?:\/\/\{id\}\.[a-z0-9.-]+(:\d+)?\/?$/.test(template)) {
    throw new Error(`GF_PLAY_PUBLIC_ORIGIN_TEMPLATE: "${template}" — нужен вид http(s)://{id}.<хост>[:порт]`);
  }
  const playRootOrigin = new URL(template.replace('{id}.', '')).origin;
  return {
    // pnpm запускает хаб из apps/hub, данные по умолчанию — в корне репозитория, как у play-server.
    // turbopackIgnore: путь — данные во время работы, а не файлы сборки; без пометки Next
    // решит, что нужен весь проект, и потащит его в standalone-сборку.
    dataDir: resolve(/*turbopackIgnore: true*/ env.GF_DATA_DIR || resolve(/*turbopackIgnore: true*/ process.cwd(), '..', '..', '.data')),
    gameOrigin: (id) => new URL(template.replace('{id}', id)).origin,
    playRootOrigin,
  };
}
