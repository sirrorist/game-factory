// Мост хаба: сторона хаба в протоколе Game Factory SDK (docs/SDK.md).
//
// Файл самодостаточен (без import) и написан на стираемом подмножестве TS:
// его берёт хаб на Next.js, а e2e-тест отдаёт браузеру после
// module.stripTypeScriptTypes — без сборщика.
//
// Правило моста: всё, что пришло из iframe, — недоверенный ввод. Сообщение
// принимается, только если совпали и окно (event.source), и origin игры,
// а содержимое прошло проверку формы и лимитов.

export const PROTOCOL = 1;
export const MAX_VALUE_BYTES = 64 * 1024;
const KEY_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

export interface Player {
  id: string;
  name: string;
}

export interface ScoreResult {
  best: number;
  isBest: boolean;
}

/** Где хаб хранит данные игры. Этап 0 — localStorage браузера, этап 1 — API хаба и Postgres. */
export interface GameDataHandlers {
  save(key: string, value: string): Promise<void>;
  load(key: string): Promise<string | null>;
  submitScore(score: number): Promise<ScoreResult>;
  bestScore(): Promise<number | null>;
}

export type BridgeEvent =
  | { type: 'hello'; sdk: string }
  | { type: 'ready' }
  | { type: 'request'; method: string }
  | { type: 'rejected'; reason: string };

export interface ConnectOptions {
  /** Окно, куда смотреть сообщения (window хаба). */
  host: Window;
  iframe: HTMLIFrameElement;
  gameId: string;
  /** Точный origin игры, например https://snake.play.youranus.ru */
  gameOrigin: string;
  player: Player | null;
  handlers: GameDataHandlers;
  onEvent?: (event: BridgeEvent) => void;
  /** Лимит запросов в секунду от одной игры. */
  maxRequestsPerSecond?: number;
}

type Params = Record<string, unknown> | null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validKey(v: unknown): v is string {
  return typeof v === 'string' && KEY_RE.test(v);
}

export interface FrameAttributes {
  sandbox: string;
  allow: string;
}

// Права манифеста → Permissions Policy iframe. Чего игра не просила, того у неё нет:
// fullscreen, gamepad и autoplay для iframe с чужого origin по умолчанию закрыты.
const ALLOW_BY_PERMISSION: Record<string, string> = {
  fullscreen: 'fullscreen',
  gamepad: 'gamepad',
  audio: 'autoplay',
};

/**
 * Атрибуты iframe игры. Песочница всегда без allow-top-navigation, allow-popups,
 * allow-forms и allow-modals: игре нельзя уводить вкладку хаба и открывать окна.
 * allow-same-origin нужен игре для своего localStorage — её origin всё равно чужой хабу.
 */
export function frameAttributes(permissions: readonly string[]): FrameAttributes {
  const sandbox = ['allow-scripts', 'allow-same-origin'];
  if (permissions.includes('pointer-lock')) sandbox.push('allow-pointer-lock');
  const allow = permissions.flatMap((p) => ALLOW_BY_PERMISSION[p] ?? []);
  return { sandbox: sandbox.join(' '), allow: allow.join('; ') };
}

/** Подключить игру в iframe к хабу. Возвращает функцию отключения. */
export function connectGame(opts: ConnectOptions): () => void {
  const limit = opts.maxRequestsPerSecond ?? 20;
  let windowStart = 0;
  let windowCount = 0;
  const emit = (e: BridgeEvent): void => opts.onEvent?.(e);

  const post = (message: unknown): void => {
    // Только точный origin игры: если iframe успели увести на другой адрес,
    // браузер не доставит ответ.
    opts.iframe.contentWindow?.postMessage(message, opts.gameOrigin);
  };

  const call = (method: string, params: Params): Promise<unknown> => {
    const p = params ?? {};
    switch (method) {
      case 'save': {
        if (!validKey(p.key)) throw new Error('bad-key');
        if (typeof p.value !== 'string') throw new Error('bad-value');
        if (p.value.length > MAX_VALUE_BYTES) throw new Error('value-too-large');
        try {
          JSON.parse(p.value); // значение обязано быть JSON: иначе SDK на load сломается
        } catch {
          throw new Error('bad-json');
        }
        return opts.handlers.save(p.key, p.value);
      }
      case 'load':
        if (!validKey(p.key)) throw new Error('bad-key');
        return opts.handlers.load(p.key);
      case 'submitScore':
        if (typeof p.score !== 'number' || !Number.isFinite(p.score)) throw new Error('bad-score');
        return opts.handlers.submitScore(p.score);
      case 'bestScore':
        return opts.handlers.bestScore();
      default:
        throw new Error('unknown-method');
    }
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== opts.iframe.contentWindow || event.origin !== opts.gameOrigin) return;
    const d: unknown = event.data;
    if (!isRecord(d) || d.gf !== PROTOCOL || typeof d.type !== 'string') {
      emit({ type: 'rejected', reason: 'bad-shape' });
      return;
    }

    if (d.type === 'hello') {
      if (d.gameId !== opts.gameId) {
        emit({ type: 'rejected', reason: 'wrong-game' });
        return;
      }
      emit({ type: 'hello', sdk: String(d.sdk) });
      post({ gf: PROTOCOL, type: 'welcome', gameId: opts.gameId, player: opts.player });
      return;
    }

    if (d.type === 'ready') {
      emit({ type: 'ready' });
      return;
    }

    if (d.type === 'request' && typeof d.id === 'number' && typeof d.method === 'string') {
      const id = d.id;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > limit) {
        post({ gf: PROTOCOL, type: 'response', id, ok: false, error: 'rate-limited' });
        emit({ type: 'rejected', reason: 'rate-limited' });
        return;
      }
      emit({ type: 'request', method: d.method });
      const params = isRecord(d.params) ? d.params : null;
      Promise.resolve()
        .then(() => call(d.method as string, params))
        .then(
          (result) => post({ gf: PROTOCOL, type: 'response', id, ok: true, result: result ?? null }),
          (err: unknown) => {
            const reason = err instanceof Error ? err.message : 'error';
            post({ gf: PROTOCOL, type: 'response', id, ok: false, error: reason });
            emit({ type: 'rejected', reason });
          },
        );
      return;
    }

    emit({ type: 'rejected', reason: 'unknown-type' });
  };

  opts.host.addEventListener('message', onMessage);
  return () => opts.host.removeEventListener('message', onMessage);
}

/** Хранение в Storage браузера хаба (этап 0). Ключи разведены по игре. */
export function storageHandlers(storage: Storage, gameId: string): GameDataHandlers {
  const prefix = `gf-hub:${gameId}:`;
  return {
    async save(key, value) {
      storage.setItem(`${prefix}save:${key}`, value);
    },
    async load(key) {
      return storage.getItem(`${prefix}save:${key}`);
    },
    async submitScore(score) {
      const raw = storage.getItem(`${prefix}best`);
      const best = raw === null ? null : Number(raw);
      const isBest = best === null || score > best;
      if (isBest) storage.setItem(`${prefix}best`, String(score));
      return { best: isBest ? score : (best as number), isBest };
    },
    async bestScore() {
      const raw = storage.getItem(`${prefix}best`);
      return raw === null ? null : Number(raw);
    },
  };
}
