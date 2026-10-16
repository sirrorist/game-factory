'use client';

// Игра в iframe + мост хаба. Всё, что приходит из iframe, - недоверенный ввод:
// проверяет packages/hub-bridge (source + origin, форма, лимиты).

import { connectGame, storageHandlers, type GameDataHandlers } from '@gf/hub-bridge';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';

interface Props {
  gameId: string;
  gameOrigin: string;
  title: string;
  sandbox: string;
  allow: string;
  metadata?: ReactNode;
  children?: ReactNode;
}

export function GameFrame({ gameId, gameOrigin, title, sandbox, allow, metadata, children }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const primary = primaryRef.current;
    const heading = headingRef.current;
    if (!primary || !heading) return;
    function measure() {
      if (!primary) return;
      // Считаем от начала документа: прокрутка к сведениям не растягивает игру.
      const top = primary.getBoundingClientRect().top + window.scrollY;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const summaryInFirstScreen = getComputedStyle(primary).getPropertyValue('--game-summary-in-first-screen').trim() === '1';
      const page = primary.parentElement!;
      const summary = summaryRef.current;
      const reserved = summaryInFirstScreen && summary
        ? summary.getBoundingClientRect().height + parseFloat(getComputedStyle(page).rowGap) : 0;
      primary.style.setProperty('--game-primary-height', `${Math.max(0, viewport - top - reserved)}px`);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    if (summaryRef.current) observer.observe(summaryRef.current);
    const header = document.querySelector('.gf-header');
    if (header) observer.observe(header);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    let active = true;
    void document.fonts.ready.then(() => { if (active) measure(); });
    measure();
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);

  return (
    // Рамка игры - во всю ширину колонки хаба: игры сами центруют себя внутри iframe.
    <div className="gf-game-page" data-game-ready={ready ? '1' : undefined}>
      <div className="gf-game-primary" ref={primaryRef}>
        <header className="gf-game-heading" ref={headingRef}>
          <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}
            aria-label="Вернуться в каталог" title="Вернуться в каталог">
            <Icon name="back" />
            <span className="gf-game-control-label">Каталог</span>
          </Link>
          <h1 title={title}>{title}</h1>
          {canFullscreen ? (
            <Button variant="outline" size="sm" aria-label="На весь экран" title="На весь экран"
              onClick={() => void wrapRef.current?.requestFullscreen().catch(() => undefined)}>
              <Icon name="fullscreen" />
              <span className="gf-game-control-label">На весь экран</span>
            </Button>
          ) : null}
        </header>
        {/* sandbox/allow и источник iframe сохраняются: меняется только компоновка. */}
        {/* Полный экран разворачивает обёртку: выход хаба остаётся поверх игры,
            а сама игра не получает вложенного полноэкранного режима. */}
        <div ref={wrapRef} className={isFullscreen ? 'relative h-full w-full bg-black' : 'gf-game-surface'}>
          <iframe
            ref={iframeRef}
            id="game"
            title={title}
            sandbox={sandbox}
            allow={allow}
            referrerPolicy="no-referrer"
            className={isFullscreen ? 'h-full w-full bg-black' : 'gf-game-viewport w-full rounded-md border bg-black'}
          />
          {!ready ? <span className="gf-game-loading" role="status">Загрузка…</span> : null}
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
      <section className="gf-game-details" aria-label="Об игре">
        <h2 className="gf-game-full-title">{title}</h2>
        <div className="gf-game-summary" ref={summaryRef}>
          <span className={best === null ? 'gf-record' : 'gf-record gf-record--bump'}>
            <Icon name="trophy" />
            <span className="gf-record__label">Твой рекорд</span>
            {/* key - число перерисовывается при новом рекорде, и анимация прыжка играет снова. */}
            <b key={best ?? 'none'} className="gf-record__value" data-testid="hub-best">
              {best === null ? '-' : best}
            </b>
          </span>
          {metadata}
        </div>
        {children}
      </section>
    </div>
  );
}
