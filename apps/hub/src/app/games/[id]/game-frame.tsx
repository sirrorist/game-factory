'use client';

// Игра в iframe + мост хаба. Всё, что приходит из iframe, - недоверенный ввод:
// проверяет packages/hub-bridge (source + origin, форма, лимиты).

import { connectGame, storageHandlers, type GameDataHandlers } from '@gf/hub-bridge';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons.tsx';
import { Button } from '@/components/ui/button.tsx';

interface Props {
  gameId: string;
  gameOrigin: string;
  title: string;
  sandbox: string;
  allow: string;
  children?: ReactNode;
}

export function GameFrame({ gameId, gameOrigin, title, sandbox, allow, children }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Полный экран хаба разворачивает обёртку, а не игру: права игры "fullscreen" ему не нужно -
  // кнопка есть у всех игр, где браузер это умеет (на iPhone - нет). Узнаём после монтирования: на сервере document нет.
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [best, setBest] = useState<number | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setReady(false);
    // Этап 0: данные игры живут в localStorage хаба. Этап 1 - API хаба.
    const base = storageHandlers(window.localStorage, gameId);
    void base.bestScore().then(setBest);
    const handlers: GameDataHandlers = {
      ...base,
      async submitScore(score) {
        const r = await base.submitScore(score);
        setBest(r.best);
        return r;
      },
    };
    const disconnect = connectGame({
      host: window,
      iframe,
      gameId,
      gameOrigin,
      player: null, // гость: авторизация - этап 1
      handlers,
      onEvent: (e) => {
        if (e.type === 'ready') setReady(true);
        if (e.type === 'rejected') console.warn(`gf: мост отклонил сообщение игры (${e.reason})`);
      },
    });
    // src ставится после подписки: иначе hello игры может прийти раньше слушателя.
    iframe.src = `${gameOrigin}/`;
    return () => {
      disconnect();
      iframe.removeAttribute('src');
    };
  }, [gameId, gameOrigin]);

  useEffect(() => {
    setCanFullscreen(document.fullscreenEnabled);
    const sync = (): void => setIsFullscreen(!!wrapRef.current && document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  return (
    // Рамка игры - во всю ширину колонки хаба: игры сами центруют себя внутри iframe.
    <div className="flex w-full flex-col gap-3" data-game-ready={ready ? '1' : undefined}>
      <div className="gf-toolbar">
        <span className={best === null ? 'gf-record' : 'gf-record gf-record--bump'}>
          <Icon name="trophy" />
          <span className="gf-record__label">Твой рекорд</span>
          {/* key - число перерисовывается при новом рекорде, и анимация прыжка играет снова. */}
          <b key={best ?? 'none'} className="gf-record__value" data-testid="hub-best">
            {best === null ? '-' : best}
          </b>
        </span>
        {!ready ? <span className="text-sm text-muted-foreground">загрузка…</span> : null}
        <span className="gf-toolbar__spacer" />
        {canFullscreen ? (
          <Button variant="outline" size="sm" onClick={() => void wrapRef.current?.requestFullscreen().catch(() => undefined)}>
            <Icon name="fullscreen" />
            На весь экран
          </Button>
        ) : null}
        {children}
      </div>
      {/* Разметка iframe - как в tests/e2e/fixtures/mock-hub.html: sandbox и allow из манифеста (frameAttributes). */}
      {/* На весь экран разворачивается обёртка, а не сам iframe: поверх игры остаётся кнопка
          выхода хаба. Изнутри iframe полноэкранный режим хаба не виден - игра его не выключит. */}
      <div ref={wrapRef} className={isFullscreen ? 'relative h-full w-full bg-black' : 'relative w-full'}>
        <iframe
          ref={iframeRef}
          id="game"
          title={title}
          sandbox={sandbox}
          allow={allow}
          referrerPolicy="no-referrer"
          className={isFullscreen ? 'h-full w-full bg-black' : 'h-[min(75dvh,680px)] min-h-[420px] w-full rounded-md border bg-black'}
        />
        {isFullscreen ? (
          <button
            type="button"
            data-testid="exit-fullscreen"
            className="gf-exit-pill"
            onClick={() => void document.exitFullscreen().catch(() => undefined)}
          >
            <Icon name="exit-fullscreen" />
            Выйти
          </button>
        ) : null}
      </div>
    </div>
  );
}
