import { ru } from '../i18n/ru.ts';
import type { GameState } from './state.ts';
import { isPlant, waterPlant } from './layout.ts';
import { plantConditions } from './conditions.ts';
import { hasGlobal } from './effects.ts';
import { livingObjects } from './growth.ts';
import { fieldSize } from './shop.ts';

export const TUTORIAL = [
  {id:'accept',title:ru.tutorial.tips.accept.title,text:ru.tutorial.tips.accept.text,action:'orders',label:ru.tutorial.tips.accept.label},
  {id:'plant',title:ru.tutorial.tips.plant.title,text:ru.tutorial.tips.plant.text,action:'catalog',label:ru.tutorial.tips.plant.label},
  {id:'care',title:ru.tutorial.tips.care.title,text:ru.tutorial.tips.care.text,action:'catalog',label:ru.tutorial.tips.care.label},
  {id:'day',title:ru.tutorial.tips.day.title,text:ru.tutorial.tips.day.text,action:'continue',label:ru.tutorial.tips.day.label},
  {id:'cut',title:ru.tutorial.tips.cut.title,text:ru.tutorial.tips.cut.text,action:'orders',label:ru.tutorial.tips.cut.label},
  {id:'submit',title:ru.tutorial.tips.submit.title,text:ru.tutorial.tips.submit.text,action:'orders',label:ru.tutorial.tips.submit.label},
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
