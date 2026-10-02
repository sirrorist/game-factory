// Лимит попыток входа по паролю - "fail2ban внутри хаба" (слайс 1.2, владелец: "fail2ban на
// пароль"). Серия неверных паролей с одного адреса - бан адреса, каждый следующий бан вдвое
// дольше. Каждый отказ пишется строкой `gf-auth: …` в журнал хаба - по ней бан на уровне сервера
// (fail2ban хоста, задание в приватной базе инфраструктуры) режет адрес ещё до хаба.
//
// Память процесса, не база: хаб - один процесс, перезапуск сбрасывает счёт (бан сервера - нет).
// Учётку не блокируем: так любой мог бы запереть владельца; passkey этим лимитом не задет.
//
// Модуль без Next и без `@/`-импортов: его гоняет node:test напрямую (test/login-guard.test.ts).

export interface GuardOptions {
  /** Сколько неверных паролей за окно - бан. */
  maxFailures: number;
  windowMs: number;
  /** Первый бан; каждый следующий - вдвое дольше, но не дольше maxBanMs. */
  banMs: number;
  maxBanMs: number;
  /** Сколько адресов помнить: дальше забываем самые старые (защита памяти от перебора адресов). */
  maxEntries: number;
}

export const DEFAULT_GUARD: GuardOptions = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  banMs: 15 * 60_000,
  maxBanMs: 24 * 60 * 60_000,
  maxEntries: 10_000,
};

interface Entry {
  failures: number[];
  bannedUntil: number;
  bans: number;
}

export type GuardVerdict = { banned: false } | { banned: true; retryAfterS: number };

export class LoginGuard {
  private readonly entries = new Map<string, Entry>();
  private readonly opts: GuardOptions;

  constructor(opts: Partial<GuardOptions> = {}) {
    this.opts = { ...DEFAULT_GUARD, ...opts };
  }

  /** Сколько адресов помнит (для теста предела памяти). */
  get size(): number {
    return this.entries.size;
  }

  check(ip: string, now = Date.now()): GuardVerdict {
    const e = this.entries.get(ip);
    if (!e || e.bannedUntil <= now) return { banned: false };
    return { banned: true, retryAfterS: Math.ceil((e.bannedUntil - now) / 1000) };
  }

  /** Неверный пароль. Вернёт срок бана, если этот отказ его включил. */
  fail(ip: string, now = Date.now()): { bannedForS: number } | null {
    const e = this.entries.get(ip) ?? { failures: [], bannedUntil: 0, bans: 0 };
    e.failures = e.failures.filter((t) => now - t < this.opts.windowMs);
    e.failures.push(now);
    // Свежая запись - в конец Map: при переполнении уходят самые давние адреса.
    this.entries.delete(ip);
    this.entries.set(ip, e);
    this.prune();
    if (e.failures.length < this.opts.maxFailures) return null;
    const ms = Math.min(this.opts.banMs * 2 ** e.bans, this.opts.maxBanMs);
    e.bans++;
    e.failures = [];
    e.bannedUntil = now + ms;
    return { bannedForS: Math.ceil(ms / 1000) };
  }

  /** Верный пароль: счёт неудач сброшен. Число прошлых банов остаётся - повторный перебор банится дольше. */
  success(ip: string): void {
    const e = this.entries.get(ip);
    if (e) e.failures = [];
  }

  private prune(): void {
    while (this.entries.size > this.opts.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Ключ счёта для адреса: IPv4 - сам адрес, IPv6 - сеть /64 (столько обычно у одного клиента:
 * иначе он меняет адрес на каждую попытку и не набирает лимит). Как ipv6Subnet у Better Auth.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Адрес клиента - из X-Real-Ip, который ставит Traefik: хаб доступен только через него (сеть
 * gf-edge), а клиентский X-Real-Ip Traefik перезаписывает (предположение о его настройке -
 * проверка в приватной базе инфраструктуры). X-Forwarded-For не берём: его первый адрес задаёт клиент.
 */
export function clientIp(headers: Headers): string {
  const ip = headers.get('x-real-ip')?.trim() ?? '';
  return IP_RE.test(ip) ? ip : 'unknown';
}
