// Явный локальный стенд настоящего Next + play-server. Ничего не публикует; конфигурацию Next обрабатывает его штатный запуск.
import { resolve } from 'node:path';
import { createPlayServer } from '../../../../apps/play-server/src/server.ts';
import { startHub } from '../../../e2e/helpers.ts';

const option = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const data = option('--data');
if (!data) throw new Error('Укажи --data с каталогом уже собранных и экспортированных тестовых игр');
const hubPort = Number(option('--hub-port') ?? 3012), playPort = Number(option('--play-port') ?? 3013);
for (const port of [hubPort, playPort]) if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Неверный локальный порт');
const origin = `http://localhost:${hubPort}`;
const play = createPlayServer({ baseHost: 'play.localhost', port: playPort, host: '127.0.0.1', hubOrigins: [origin], dataDir: resolve(data) });
await new Promise<void>((accept, reject) => { play.once('error', reject); play.listen(playPort, '127.0.0.1', accept); });
let hub: Awaited<ReturnType<typeof startHub>>;
try { hub = await startHub({ port: hubPort, dataDir: resolve(data), playPort }); }
catch (error) { play.close(); throw error; }
console.log(`Настоящий хаб: ${origin}/\nИгра: ${origin}/games/snake\nADB: adb reverse tcp:${hubPort} tcp:${hubPort}\nADB: adb reverse tcp:${playPort} tcp:${playPort}`);
const stop = async () => { await hub.stop(); play.closeAllConnections(); play.close(); };
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
