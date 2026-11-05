import type { GameState } from './state.ts';
import { isPlant, waterPlant } from './layout.ts';
import { plantConditions } from './conditions.ts';
import { hasGlobal } from './effects.ts';
import { livingObjects } from './growth.ts';
import { fieldSize } from './shop.ts';

export const TUTORIAL = [
  {id:'accept',title:'Выберите настоящий заказ',text:'На доске выберите состав и срок, затем примите заказ. Только активный основной заказ разрешает менять день.',action:'orders',label:'Открыть доску'},
  {id:'plant',title:'Посадите нужные цветы',text:'Откройте каталог и поставьте растения из состава заказа на свободные клетки. Размещение бесплатно; выбранный предмет можно ставить несколько раз. ПКМ отменяет посадку, на телефоне — «Отмена».',action:'catalog',label:'Открыть каталог'},
  {id:'care',title:'Обеспечьте уход',text:'Обязательный уход указан в каталоге: полив или свет. Поставьте нужное устройство рядом с растением. Значки у горшка показывают действующие условия. Сосед своего вида ускоряет рост, другого — даёт +1 урожай за весь цикл.',action:'catalog',label:'Выбрать устройство'},
  {id:'day',title:'Дайте растениям вырасти',text:'Нажмите «Следующий день» на поле. Растения растут только при смене дня, автоматически время не идёт. Следите за сроком заказа и репутацией.',action:'continue',label:'К полю'},
  {id:'cut',title:'Срежьте готовые цветы',text:'Когда шкала заполнится, откройте растение и нажмите «Срезать» или используйте «Срезать всё готовое» на доске. При хорошем уходе урожай готов через 2–4 дня роста. Цветы попадут в общий запас, растение останется для следующего цикла.',action:'orders',label:'Открыть доску'},
  {id:'submit',title:'Соберите букет',text:'Накопите в запасе весь состав и нажмите «Сдать заказ» на его карточке. Если цветов мало, продолжайте выращивание и срезку до срока. После сдачи выберите одно сезонное улучшение.',action:'orders',label:'Проверить состав'},
] as const;
// История дополняется и при выключенных подсказках: включение не повторяет уже освоенное.
export function recordTutorial(state:GameState):GameState {
  const s=state.season;if(!s||s.number!==1)return state;
  const order=[...s.board.completed,...s.board.active].find(o=>o.stage===1);
  if(!order)return state;
  const objects=s.layout.objects.filter(o=>isPlant(o.kind)&&order.ingredients.some(i=>i.kind===o.kind));
  const living=livingObjects(s.layout.objects,s.garden.plants);
  const met=[true,objects.length>0,objects.length>0&&objects.every(o=>{
    const c=plantConditions(living,o,s.effects,fieldSize(s.access));return c&&((waterPlant(o.kind as Parameters<typeof waterPlant>[0])!==hasGlobal(s.effects,'P1',o.kind))?c.water:c.light);
  }),s.day>order.appeared,order.ingredients.some(i=>s.garden.stock[i.kind]>0),s.board.completed.some(o=>o.stage===1)];
  const done=[...new Set([...state.profile.tutorial,...TUTORIAL.filter((_,i)=>met[i]).map(t=>t.id)])];
  return done.length===state.profile.tutorial.length?state:{...state,profile:{...state.profile,tutorial:done}};
}
export function tutorialTip(state:GameState){
  const s=state.season;if(!state.settings.tutorial||!s||s.number!==1||s.board.result||s.board.pending||s.board.completed.length)return null;
  const done=recordTutorial(state).profile.tutorial;
  return TUTORIAL.find(t=>!done.includes(t.id))??null;
}
