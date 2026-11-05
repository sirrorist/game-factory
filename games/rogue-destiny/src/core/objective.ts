import type { DungeonFloor } from './types.ts';
export interface ChapterObjective { title: string; detail: string }
/** Подсказка обязательного пути; секреты и необязательные награды не раскрываются. */
export function chapterObjective(floor: DungeonFloor,alive: number,bossAlive: boolean,hasCipher: boolean): ChapterObjective {
  const gate=floor.rooms.find(room=>room.type==='boss_gate');
  const cipher=hasCipher||floor.rooms.some(room=>room.type==='shrine'&&room.isVisited);
  if(gate&&!gate.unlocked&&!cipher) return {title:'Найдите шифр',detail:'Исследуйте святилище за терновой печатью. Его знания откроют врата Стража.'};
  if(gate&&!gate.unlocked) return {title:'Откройте врата',detail:'У вас есть знание шифра. Подойдите к руническим вратам и используйте действие.'};
  if(bossAlive) return {title:'Победите Стража',detail:'Следите за замахом: когти можно парировать, от удара по земле нужно отойти.'};
  if(alive>0) return {title:`Осталось стражей: ${alive}`,detail:'Печать портала держится на оставшихся противниках. Проверьте исследованные залы на миникарте.'};
  return {title:'К порталу',detail:floor.floorNumber>=3?'Активируйте древний портал, чтобы завершить освобождение крипт.':'Все стражи повержены. Активируйте портал и спуститесь глубже.'};
}
