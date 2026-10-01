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
