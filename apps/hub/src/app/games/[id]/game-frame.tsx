'use client';

// Игра в iframe + мост хаба. Всё, что приходит из iframe, — недоверенный ввод:
// проверяет packages/hub-bridge (source + origin, форма, лимиты).

import { connectGame, storageHandlers, type GameDataHandlers } from '@gf/hub-bridge';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';

interface Props {
  gameId: string;
  gameOrigin: string;
  title: string;
  sandbox: string;
  allow: string;
  fullscreen: boolean;
  children?: ReactNode;
}

export function GameFrame({ gameId, gameOrigin, title, sandbox, allow, fullscreen, children }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [best, setBest] = useState<number | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setReady(false);
    // Этап 0: данные игры живут в localStorage хаба. Этап 1 — API хаба.
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
      player: null, // гость: авторизация — этап 1
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

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-3" data-game-ready={ready ? '1' : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">
          Твой рекорд: <b data-testid="hub-best">{best === null ? '—' : best}</b>
        </span>
        {!ready ? <span className="text-sm text-muted-foreground">загрузка…</span> : null}
        <span className="flex-1" />
        {fullscreen ? (
          <Button variant="secondary" size="sm" onClick={() => void iframeRef.current?.requestFullscreen()}>
            На весь экран
          </Button>
        ) : null}
        {children}
      </div>
      {/* Разметка iframe — как в tests/e2e/fixtures/mock-hub.html: sandbox и allow из манифеста (frameAttributes). */}
      <iframe
        ref={iframeRef}
        id="game"
        title={title}
        sandbox={sandbox}
        allow={allow}
        referrerPolicy="no-referrer"
        className="h-[600px] w-full rounded-lg border bg-black"
      />
    </div>
  );
}
