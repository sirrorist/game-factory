'use client';

// Интерактив витрины: перезапуск анимаций и выбор ячейки панели блоков.

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';

/** Обёртка с кнопкой "Ещё раз": перемонтирует содержимое - CSS-анимации играют заново. */
export function Replay({ children }: { children: ReactNode }) {
  const [round, setRound] = useState(0);
  return (
    <div className="relative">
      <Button variant="outline" size="sm" className="gf-replay" onClick={() => setRound((r) => r + 1)}>
        Ещё раз
      </Button>
      <div key={round}>{children}</div>
    </div>
  );
}

const BLOCKS: [string, string, string, string][] = [
  ['Трава', '#6fb043', '#7a5636', '#5e4128'],
  ['Земля', '#8a6442', '#6e4f33', '#563d27'],
  ['Камень', '#8a8a8a', '#6e6e6e', '#575757'],
  ['Булыжник', '#9a9a9a', '#7a7a7a', '#606060'],
  ['Доски', '#c8a26a', '#a07a46', '#83633a'],
  ['Бревно', '#b8915a', '#6b4f2c', '#523a1f'],
  ['Стекло', '#dbeef5', '#a9c7d4', '#86a7b5'],
  ['Контейнер', '#3b7fcc', '#2a62a3', '#1f4c80'],
  ['Сервер', '#3a3e46', '#2b2e34', '#1f2125'],
];

function Cube({ top, left, right }: { top: string; left: string; right: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,2 22,7 12,12 2,7" fill={top} />
      <polygon points="2,7 12,12 12,22 2,17" fill={left} />
      <polygon points="12,12 22,7 22,17 12,22" fill={right} />
    </svg>
  );
}

/** Панель блоков k8s at home: выбранная ячейка выезжает, над лотком - название. */
export function HotbarDemo() {
  const [slot, setSlot] = useState(7);
  return (
    <div className="gf-hotbar">
      <span key={slot} className="gf-hotbar__name">
        {BLOCKS[slot]![0]}
      </span>
      {BLOCKS.map(([name, top, left, right], i) => (
        <button key={name} type="button" className="gf-slot" aria-label={name} aria-pressed={i === slot} onClick={() => setSlot(i)}>
          <Cube top={top} left={left} right={right} />
          <span className="gf-slot__key">{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

/** Демо HUD Rogue Destiny: шкала перегрева мага с красной чертой (80-95%) и серое HP */
export function RogueDestinyHudDemo() {
  const [heat, setHeat] = useState(85);
  const [hp, setHp] = useState(68);
  const greyHp = 22; // травма плоти 22%

  const inRedline = heat >= 80 && heat <= 95;
  const isOverloaded = heat >= 100;

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-[rgba(8,11,18,0.85)] p-5 border border-[rgba(255,255,255,0.18)] backdrop-blur-md max-w-md w-full shadow-2xl text-slate-100">
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.1)] pb-2">
        <span className="font-display text-sm font-bold tracking-wider text-sky-400">ROGUE DESTINY HUD</span>
        <span className="font-mono text-xs text-amber-400 font-semibold tracking-widest">НИТИ: ✦ ✦ ✧</span>
      </div>

      {/* Шкала HP с серым здоровьем */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs font-bold text-slate-300">
          <span>ПЛОТЬ (HP)</span>
          <span className="font-mono text-slate-200">{hp} / 100 <span className="text-slate-400 text-[10px]">(Травма: {greyHp}%)</span></span>
        </div>
        <div className="relative h-3 w-full rounded bg-slate-900 overflow-hidden border border-slate-700">
          {/* Серое HP (травма) */}
          <div className="absolute right-0 top-0 bottom-0 bg-slate-500 opacity-70" style={{ width: `${greyHp}%` }} />
          {/* Текущее HP */}
          <div className="h-full bg-gradient-to-r from-red-600 to-red-500 transition-all duration-200" style={{ width: `${Math.min(hp, 100 - greyHp)}%` }} />
        </div>
      </div>

      {/* Шкала Эфирного Перегрева */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs font-bold">
          <span className="text-slate-300">ЭФИРНЫЙ ПЕРЕГРЕВ</span>
          <span className={`font-mono font-bold ${inRedline ? 'text-amber-400 animate-pulse' : isOverloaded ? 'text-red-500' : 'text-sky-300'}`}>
            {heat}% {inRedline ? '🔥 КРАСНАЯ ЗОНА (+50% КРИТ)!' : isOverloaded ? '⚡ ПЕРЕГРУЗКА!' : ''}
          </span>
        </div>
        <div className="relative h-3.5 w-full rounded bg-slate-900 overflow-hidden border border-slate-700">
          {/* Зона красной черты 80-95% */}
          <div className="absolute left-[80%] w-[15%] top-0 bottom-0 bg-amber-500/35 border-x border-amber-500 z-10" />
          <div
            className={`h-full transition-all duration-200 ${
              inRedline
                ? 'bg-gradient-to-r from-sky-500 via-amber-400 to-red-500 shadow-[0_0_12px_rgba(245,158,11,0.8)]'
                : 'bg-gradient-to-r from-sky-600 to-sky-400'
            }`}
            style={{ width: `${heat}%` }}
          />
        </div>
      </div>

      {/* Кнопки интерактива */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className="gf-btn gf-btn--primary gf-btn--sm flex-1"
          onClick={() => setHeat((h) => Math.min(100, h + 15))}
        >
          Каст (+15%)
        </button>
        <button
          type="button"
          className="gf-btn gf-btn--ghost gf-btn--sm flex-1"
          onClick={() => setHeat((h) => Math.max(0, h - 20))}
        >
          Удар (-20%)
        </button>
        <button
          type="button"
          className="gf-btn gf-btn--danger gf-btn--sm"
          onClick={() => {
            setHeat(0);
            setHp((val) => Math.max(5, val - 12));
          }}
        >
          Сброс тепла
        </button>
      </div>
    </div>
  );
}

