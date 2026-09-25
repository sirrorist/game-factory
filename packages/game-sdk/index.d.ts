// Типы Game Factory SDK. Реализация — gf-sdk.js (классический скрипт).

declare global {
  namespace GF {
    type Mode = 'hub' | 'standalone';

    interface Player {
      id: string;
      name: string;
    }

    interface ScoreResult {
      /** Лучший результат игрока после этой отправки. */
      best: number;
      isBest: boolean;
    }

    interface Session {
      /** hub — игра в хабе; standalone — открыта сама по себе (офлайн-архив). */
      readonly mode: Mode;
      readonly gameId: string;
      /** null в standalone и для гостя в хабе. */
      readonly player: Player | null;
      /** false, если сохранения живут только до закрытия вкладки. */
      readonly persistent: boolean;
      /** Сохранить JSON-значение до 64 КБ под ключом a-z A-Z 0-9 _ . - (до 64 символов). */
      save(key: string, value: unknown): Promise<void>;
      load<T = unknown>(key: string): Promise<T | null>;
      submitScore(score: number): Promise<ScoreResult>;
      /** Лучший результат игрока или null, если очков ещё не было. */
      bestScore(): Promise<number | null>;
      /** Игра загрузилась и готова к вводу. Ставит data-gf-ready на <html>. */
      ready(): void;
    }

    interface Api {
      readonly version: string;
      readonly protocol: number;
      init(options: { gameId: string }): Promise<Session>;
    }
  }

  // eslint-disable-next-line no-var
  var GameFactory: GF.Api;

  interface Window {
    GameFactory: GF.Api;
  }
}

export type Session = GF.Session;
export type Player = GF.Player;
export type ScoreResult = GF.ScoreResult;
export declare const GameFactory: GF.Api;
