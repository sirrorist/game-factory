import { configFromEnv } from './config.ts';
import { createPlayServer } from './server.ts';

const config = configFromEnv();
const server = createPlayServer(config);
server.listen(config.port, config.host, () => {
  console.log(`play-server: http://<id>.${config.baseHost}:${config.port}/ (данные: ${config.dataDir})`);
  console.log(`play-server: встраивать разрешено: ${config.hubOrigins.join(' ')}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
