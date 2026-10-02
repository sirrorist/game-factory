import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, ICON_NAMES } from '@/components/icons.tsx';
import { Logo } from '@/components/logo.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { currentOwner } from '@/lib/session.ts';
import { HotbarDemo, Replay, RogueDestinyHudDemo } from './demos.tsx';

export const metadata: Metadata = { title: 'Web kit' };
// Витрина дизайн-системы - только владельцу (D-060): страница решает по сессии на каждый запрос.
export const dynamic = 'force-dynamic';

// Цвета - имена токенов из app/globals.css; образцы берут значения оттуда же, через var().
const COLORS = [
  ['bg-000', 'Фон страницы'],
  ['bg-100', 'Карточки, шапка'],
  ['bg-200', 'Наведение'],
  ['bg-300', 'Утопленное'],
  ['line-strong', 'Рамки управления'],
  ['ink', 'Текст'],
  ['ink-muted', 'Вторичный текст'],
  ['brand', 'Главное действие'],
  ['coin', 'Рекорды'],
  ['oneup', 'Успех'],
  ['danger', 'Опасное'],
] as const;

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        {note ? <p className="max-w-prose text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Подложка "сцены игры" для HUD-компонентов: они рассчитаны на картинку под собой. */
function Scene({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md ${className}`}
      style={{ background: 'linear-gradient(#5d9be8 0%, #b9dcff 58%, #6fb043 58%, #5a8f35 100%)' }}
    >
      {children}
    </div>
  );
}

export default async function KitPage() {
  if (!(await currentOwner())) redirect('/login');
  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Дизайн-система</p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Web kit</h1>
        <p className="max-w-prose text-muted-foreground">
          Интерфейс хаба и наших игр - живыми компонентами, теми же, что на страницах. Наведи и нажми: анимации
          настоящие. Тема - по системе: тёмная "Ночь" или светлый "День".
        </p>
      </header>

      <Section title="Знак">
        <div className="flex flex-wrap items-center gap-6">
          <Logo size={64} />
          <Logo size={32} />
          <span className="gf-logo">
            <Logo />
            <span className="gf-logo__word">
              Game <b>Factory</b>
            </span>
          </span>
        </div>
      </Section>

      <Section title="Цвета" note="Компоненты берут цвет только из токенов: тема меняет значения, разметка та же.">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COLORS.map(([name, role]) => (
            <li key={name} className="flex items-center gap-3 rounded-md bg-card p-2 shadow-[inset_0_0_0_1px_var(--line)]">
              <span className="size-10 shrink-0 rounded-sm shadow-[inset_0_0_0_1px_var(--line)]" style={{ background: `var(--${name})` }} />
              <span className="flex min-w-0 flex-col">
                <code className="font-mono text-xs">{name}</code>
                <span className="text-xs text-muted-foreground">{role}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Шрифты" note="Unbounded, Onest, JetBrains Mono, Press Start 2P - все с кириллицей. Пока файлов шрифтов нет, видны запасные.">
        <div className="flex flex-col gap-3">
          <p className="font-display text-4xl font-bold tracking-tight">k8s at home</p>
          <p className="font-display text-xl font-semibold">Новые игры</p>
          <p>Играй прямо здесь или скачай архив и играй без интернета.</p>
          <p className="font-mono text-sm text-muted-foreground">v1.0.1 · 157 КБ · k8s-at-home</p>
          <p style={{ font: '400 10px/14px var(--font-pixel)' }}>РЕКОРД 1284</p>
        </div>
      </Section>

      <Section title="Кнопки" note="Аркадная клавиша: нажатие - опускание на бортик, отпускание - отскок.">
        <div className="gf-row">
          <Button size="lg">
            <Icon name="play" />
            Играть
          </Button>
          <Button variant="secondary">
            <Icon name="download" />
            Скачать <span className="gf-btn__meta">157 КБ</span>
          </Button>
          <Button variant="outline">
            <Icon name="fullscreen" />
            На весь экран
          </Button>
          <Button variant="danger" size="sm">
            Новый мир
          </Button>
          <Button variant="secondary" disabled>
            Загрузка…
          </Button>
        </div>
        <div className="gf-row">
          <button type="button" className="gf-icon-btn" aria-label="Меню">
            <Icon name="menu" />
          </button>
          <button type="button" className="gf-icon-btn" aria-label="Звук">
            <Icon name="sound-on" />
          </button>
          <button type="button" className="gf-icon-btn gf-icon-btn--on" aria-label="Звук выключен">
            <Icon name="sound-off" />
          </button>
        </div>
      </Section>

      <Section title="Метки">
        <div className="gf-row">
          <Badge>sandbox</Badge>
          <Badge>3d</Badge>
          <Badge tone="version">v1.0.1</Badge>
          <Badge tone="live">онлайн</Badge>
          <Badge tone="new">NEW</Badge>
        </div>
      </Section>

      <Section title="Иконки" note="Сетка 24, обводка 2px, в каждой - пиксель brand. У трофея и пьедестала пиксель - coin.">
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {ICON_NAMES.map((name) => (
            <li key={name} className="flex flex-col items-center gap-2 rounded-md bg-card p-3 shadow-[inset_0_0_0_1px_var(--line)]">
              <Icon name={name} />
              <code className="font-mono text-[10px] text-muted-foreground">{name}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Тулбар игры" note="Над игрой на её странице: рекорд, полный экран, архив. Число прыгает при новом рекорде.">
        <Replay>
          <div className="gf-toolbar pr-28">
            <span className="gf-record gf-record--bump">
              <Icon name="trophy" />
              <span className="gf-record__label">Твой рекорд</span>
              <b className="gf-record__value">1 284</b>
            </span>
          </div>
        </Replay>
        <Scene className="h-40">
          <button type="button" className="gf-exit-pill">
            <Icon name="exit-fullscreen" />
            Выйти
          </button>
        </Scene>
      </Section>

      <Section title="Тосты">
        <Replay>
          <Scene className="flex flex-col items-start gap-2 p-4 pr-28">
            <span className="gf-toast">Полёт: вкл</span>
            <span className="gf-toast gf-toast--ok">
              Под запущен: <code>Running</code>
            </span>
            <span className="gf-toast gf-toast--warn">Полный экран включил хаб - выйти: "Назад" или Esc</span>
            <span className="gf-toast gf-toast--err">Мир не сохранился - попробуем через 10 с</span>
          </Scene>
        </Replay>
      </Section>

      <Section title="HUD игр" note="Счётчики - сверху экрана, панель блоков - снизу. Выбери ячейку.">
        <Scene className="h-72">
          <div className="gf-hud-top absolute left-3 top-3">
            <span className="gf-hud-stat">
              <Icon name="blocks" />
              <b>128</b>
            </span>
            <span className="gf-hud-stat">
              <Icon name="trophy" />
              <span>рекорд</span>
              <b>1 284</b>
            </span>
          </div>
          <div className="absolute right-3 top-3 flex gap-1.5">
            <button type="button" className="gf-icon-btn gf-icon-btn--hud" aria-label="На весь экран">
              <Icon name="fullscreen" />
            </button>
            <button type="button" className="gf-icon-btn gf-icon-btn--hud" aria-label="Меню">
              <Icon name="menu" />
            </button>
          </div>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <HotbarDemo />
          </div>
        </Scene>
      </Section>

      <Section title="Меню игры">
        <Replay>
          <div className="grid place-items-center rounded-md p-6" style={{ background: 'var(--scrim)' }}>
            <div className="gf-panel" role="dialog" aria-label="Меню игры">
              <h3 className="gf-panel__title">k8s at home</h3>
              <p className="gf-panel__sub">кластер развёрнут: 1/1 нода готова</p>
              <Button size="lg">
                <Icon name="play" />
                Продолжить
              </Button>
              <div className="gf-panel__row">
                <span>Дальность</span>
                <span className="gf-stepper">
                  <button type="button" className="gf-icon-btn" style={{ width: 32, height: 32 }} aria-label="Меньше">
                    -
                  </button>
                  <b>6</b>
                  <button type="button" className="gf-icon-btn" style={{ width: 32, height: 32 }} aria-label="Больше">
                    +
                  </button>
                </span>
              </div>
              <Button variant="danger" size="sm">
                Новый мир
              </Button>
              <p className="gf-panel__note">Мир сохраняется в хабе.</p>
            </div>
          </div>
        </Replay>
      </Section>

      <Section
        title="Rogue Destiny - Souls-like Roguelite"
        note="Специализированные компоненты хардкорного сурвайвала: интерактивная шкала Эфирного Перегрева мага с красной чертой риска (80-95%), механика серого здоровья (неизлечимой травмы плоти) и Нити Судьбы."
      >
        <Scene className="flex items-center justify-center p-8 min-h-[260px]">
          <RogueDestinyHudDemo />
        </Scene>
      </Section>
    </div>
  );
}
