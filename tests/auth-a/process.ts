import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { requireCheck, standaloneArgs } from './guards.ts';

export class ManagedProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private output = '';
  private spawnError = false;
  private groupId: number | undefined;
  private groupRetired = false;
  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    this.groupId = this.child.pid;
    for (const stream of [this.child.stdout, this.child.stderr]) stream?.on('data', (chunk: Buffer) => {
      // Храним ограниченный хвост только в памяти; не выдаём его в TAP/артефакты.
      this.output = (this.output + chunk.toString()).slice(-32_768);
    });
    this.exited = new Promise(resolve => {
      this.child.once('error', () => { this.spawnError = true; resolve({ code: null, signal: null }); });
      this.child.once('exit', (code, signal) => resolve({ code, signal }));
    });
  }
  get running() { return !this.spawnError && this.child.exitCode === null && this.child.signalCode === null; }
  get denied() { return this.output.includes('ERR_ACCESS_DENIED'); }
  hasOutput(text: string) { return this.output.includes(text); }
  async completed(timeout: number) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([this.exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('дочерний процесс превысил срок')), timeout);
      })]);
    } finally { clearTimeout(timer); }
  }
  signal(signal: NodeJS.Signals) {
    // Лидер может уже завершиться, пока его потомок держит порт в этой же группе.
    if (!this.groupAlive()) return;
    try { process.kill(-this.groupId!, signal); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') this.groupRetired = true;
      else throw new Error('не удалось отправить сигнал группе стенда');
    }
  }
  private groupAlive(): boolean {
    if (!this.groupId || this.groupRetired) return false;
    requireCheck(process.platform === 'linux', 'контроль групп стенда требует Linux /proc');
    const pids = new Set(readdirSync('/proc'));
    for (const pid of pids) {
      if (!/^\d+$/.test(pid)) continue;
      let stat: string;
      try { stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); }
      catch (error) {
        // Исчезнувшая строка — нормальная гонка с завершением процесса.
        if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
        throw new Error('не удалось проверить участников группы стенда');
      }
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === this.groupId && !['Z', 'X'].includes(fields[0]!)) return true;
    }
    // Лидер мог успеть создать потомка после первого списка PID и исчезнуть до
    // чтения stat. Новый PID требует ещё одного прохода, а не раннего успеха.
    if (readdirSync('/proc').some(pid => /^\d+$/.test(pid) && !pids.has(pid))) return true;
    // Не сигналим номеру повторно после исчезновения группы. Зомби уже не
    // исполняются и не держат FD; осиротевших зомби должен собрать init runner.
    this.groupRetired = true;
    return false;
  }
  private async waitGroup(ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    do {
      if (!this.groupAlive()) return true;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < until);
    return !this.groupAlive();
  }
  async stop(signal: NodeJS.Signals = 'SIGTERM', ms = 10_000) {
    try {
      this.signal(signal);
      if (!await this.waitGroup(ms)) {
        this.signal('SIGKILL');
        requireCheck(await this.waitGroup(2000), 'группа стенда пережила принудительную остановку');
        await this.completed(2000);
        throw new Error('штатная остановка превысила срок; группа завершена принудительно');
      }
      return await this.completed(2000);
    } finally { this.output = ''; }
  }
}
/** Все попытки очистки выполняются; ни одна ошибка не превращается в успех. */
export async function settleCleanup(tasks: (() => Promise<unknown>)[]): Promise<void> {
  const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task)));
  requireCheck(results.every(result => result.status === 'fulfilled'), 'не все ресурсы стенда очищены');
}
export function abortResources(processes: Pick<ManagedProcess, 'stop'>[], browserClosers: Iterable<() => Promise<void>>) {
  return settleCleanup([
    ...[...browserClosers].map(close => () => close()), ...processes.map(child => () => child.stop('SIGKILL')),
  ]);
}
/** Общая реальная граница spawn для сервера и отрицательной внешней зависимости. */
export function launchRuntime(layout: string, fixtures: string, env: NodeJS.ProcessEnv, entry?: string) {
  return new ManagedProcess(process.execPath, standaloneArgs(layout, fixtures, entry), layout, env);
}
export async function command(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, ms: number, track?: (child: ManagedProcess) => void) {
  const child = new ManagedProcess(command, args, cwd, env);
  track?.(child);
  try {
    const outcome = await child.completed(ms);
    requireCheck(outcome.code === 0, 'подготовительная команда завершилась ошибкой');
  } finally { await child.stop(); }
}
