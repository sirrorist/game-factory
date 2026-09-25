import { GameFactory } from '@gf/game-sdk';
import './style.css';

// Без top-level await: офлайн-сборка — классический скрипт (IIFE), там его нет.
async function main(): Promise<void> {
  // Id игры подставляется из game.json при сборке: так он не разъедется с манифестом.
  const session = await GameFactory.init({ gameId: __GF_GAME_ID__ });

  const $ = (id: string): HTMLElement => document.getElementById(id)!;
  $('mode').textContent = session.mode === 'hub' ? 'в хабе' : 'без хаба';
  const best = await session.bestScore();
  $('best').textContent = best === null ? '—' : String(best);

  let score = 0;
  $('click').addEventListener('click', async () => {
    score += 1;
    $('score').textContent = String(score);
    const r = await session.submitScore(score);
    $('best').textContent = String(r.best);
  });

  session.ready();
}

void main();
