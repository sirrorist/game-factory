import { relayConfigFromEnv } from './config.ts';
import { createRelayServer } from './server.ts';

try {
  const config = relayConfigFromEnv();
  const server = createRelayServer(config, {
    log: (entry) => console.info('gf-mail: ' + entry.outcome + ' ' + entry.code),
  });
  server.on('error', () => { console.error('gf-mail: ошибка запуска'); process.exitCode = 1; });
  server.listen(4102, '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
} catch {
  console.error('gf-mail: обязательная конфигурация отсутствует или неверна');
  process.exitCode = 1;
}
