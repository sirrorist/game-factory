import { fieldSize, openFlowers, mainSlots, eventSlots } from './shop.ts';
import { boardIncome, boardExperience, type SeasonResult } from './board.ts';
import { findProductionPlan, type ProductionState } from './planner.ts';
import { requireSeasonAction, refreshStateOffers, enterGrowthDay, harvest, hasGrowthCalendar, type GameState } from './state.ts';
import type { PlantKind } from './layout.ts';
import type { Ingredient, Order } from './orders.ts';
import { closeEvents, eventIncome, eventExperience, fairGoal } from './events.ts';
import { drawReward } from './rewards.ts';
import { effectDefinition } from './effects.ts';

export const production = (s: NonNullable<GameState['season']>): ProductionState => ({day:s.day,objects:s.layout.objects,plants:s.garden.plants,stock:s.garden.stock,effects:s.effects,size:fieldSize(s.access),open:openFlowers(s.access),mainSlots:mainSlots(s.access),eventSlots:eventSlots(s.access)});
const clearUndo=(s:NonNullable<GameState['season']>):NonNullable<GameState['season']>=>({...s,layout:{...s.layout,undo:null},garden:{...s.garden,undo:null},effects:{...s.effects,undo:null}});
export const hasStock=(state:GameState,ingredients:readonly Ingredient[]):boolean=>!!state.season&&ingredients.every(i=>state.season!.garden.stock[i.kind as PlantKind]>=i.count);
export interface SpendingRisk { name:string; missing:Ingredient[] }
export function spendingRisk(state:GameState,ingredients:readonly Ingredient[],exclude:number):SpendingRisk[] {
  const s=state.season;if(!s)return [];
  // Финал завершает сезон сразу, будущие цели ярмарки снимаются.
  if(s.board.active.some(o=>o.id===exclude&&o.stage===6))return [];
  const targets=[...s.board.active.map(o=>({order:o,name:o.stage===6?'Финал':`Основной заказ ${o.stage}`})),
    ...(!s.events.fair.closed&&!s.events.fair.minimum&&s.day>=3&&s.day<=10?fairGoal(s.events,s.day).map(o=>({order:o,name:'Минимум ярмарки'})):[])];
  return targets.filter(t=>t.order.id!==exclude&&hasStock(state,t.order.ingredients)).flatMap(t=>{
    const missing=t.order.ingredients.map(i=>({kind:i.kind,count:Math.max(0,i.count-(s.garden.stock[i.kind as PlantKind]-(ingredients.find(x=>x.kind===i.kind)?.count??0)))})).filter(i=>i.count>0);
    return missing.length?[{name:t.name,missing}]:[];
  });
}
function spend(state:GameState,ingredients:readonly Ingredient[],exclude:number,confirmed:boolean):GameState {
  if(!hasStock(state,ingredients))throw Error('Для сдачи не хватает срезанных цветов.');
  if(!confirmed&&spendingRisk(state,ingredients,exclude).length)throw Error('Расход затронет уже готовую обязательную цель. Подтвердите сдачу.');
  const s=clearUndo(state.season!),stock={...s.garden.stock};
  for(const i of ingredients)stock[i.kind as PlantKind]-=i.count;
  return {...state,season:{...s,garden:{...s.garden,stock}}};
}
function reward(state:GameState,source:'main'|'urgent'|'fair',orderId:number,stage=0):GameState {
  const s=state.season!,draw=drawReward(s.effects,state.profile.progress,s.rng,openFlowers(s.access));
  return {...state,season:{...s,rng:draw.rng,board:{...s.board,pending:{source,orderId,stage,options:draw.options}}}};
}
export function chooseReward(state:GameState,index:number):GameState {
  const s=state.season,p=s?.board.pending;
  if(!s||!p||s.board.result)throw Error('Нет ожидающего выбора.');
  if(!Number.isInteger(index)||index<0||index>=p.options.length)throw Error('Вариант не найден.');
  const option=p.options[index]!,def=effectDefinition(option.effect),fx=s.effects;
  const effects=def.form==='global'?{...fx,globals:[...fx.globals,option],undo:null}:{...fx,nextId:fx.nextId+1,undo:null,modules:[...fx.modules,{id:fx.nextId,effect:option.effect as typeof fx.modules[number]['effect'],at:null}]};
  return refreshStateOffers({...state,season:{...clearUndo(s),effects,board:{...s.board,pending:null}}});
}
export function acceptOrder(state:GameState,id:number):GameState {
  const s=requireSeasonAction(state);
  if(s.board.active.length>=mainSlots(s.access))throw Error('Основное место уже занято.');
  const order=s.board.offers.find(o=>o.id===id);
  if(!order||order.deadline<s.day)throw Error('Предложение уже недоступно.');
  if(!findProductionPlan(production(s),[...s.board.active,order,...fairGoal(s.events,s.day)]))throw Error('Совместный план не найден: учтена обязательная ярмарка. Можно изменить расстановку или срезать готовые цветы.');
  return refreshStateOffers({...state,season:{...clearUndo(s),board:{...s.board,active:[...s.board.active,order],offers:[]}}});
}
export const lossShare=(income:number):{lost:number;credited:number}=>{
  if(!Number.isSafeInteger(income)||income<0)throw Error('Некорректный доход сезона.');
  const lost=Math.floor(income/4);return {lost,credited:income-lost};
};
function finish(state:GameState,reason:SeasonResult['reason'],final:Order|null=null):GameState {
  const s=state.season!;if(s.board.result)return state;
  const board={...s.board,active:[],offers:[],pending:null};
  const income=boardIncome(board)+(final?.coins??0)+eventIncome(s.events),experience=boardExperience(board)+(final?.experience??0)+eventExperience(s.events);
  const result:SeasonResult={outcome:reason==='final'?'win':'loss',reason,income,experience,final,...(reason==='final'?{lost:0,credited:income}:lossShare(income))};
  const coins=state.profile.coins+result.credited;
  if(!Number.isSafeInteger(coins))throw Error('Постоянный кошелёк превышает допустимое число.');
  const progress={...state.profile.progress,wins:state.profile.progress.wins+Number(reason==='final')};
  return {...state,profile:{...state.profile,coins,progress},season:{...clearUndo(s),events:closeEvents(s.events),board:{...board,result}}};
}
function grantExperience(state:GameState,amount:number):GameState {
  const experience=state.profile.experience+amount;
  if(!Number.isSafeInteger(experience))throw Error('Опыт превышает допустимое число.');
  return {...state,profile:{...state.profile,experience}};
}
export function submitOrder(state:GameState,id:number,confirmed=false):GameState {
  const s=requireSeasonAction(state),order=s.board.active.find(o=>o.id===id);
  if(!order)throw Error('Активный заказ не найден.');
  if(order.deadline<s.day)throw Error('Срок заказа истёк.');
  let next=grantExperience(spend(state,order.ingredients,id,confirmed),order.experience);
  const run=next.season!;
  next={...next,profile:{...next.profile,progress:{...next.profile.progress,main:next.profile.progress.main+Number(order.stage!==6)}},season:{...run,reputation:Math.min(3,s.reputation+1),board:{...run.board,active:run.board.active.filter(o=>o.id!==id),offers:order.stage===6?[]:run.board.offers,completed:order.stage===6?s.board.completed:[...s.board.completed,order]}}};
  return order.stage===6?finish(next,'final',order):reward(next,'main',order.id,order.stage);
}
export function urgentRisk(state:GameState,id:number):boolean {
  const s=state.season,r=s?.events.requests.find(r=>r.id===id);
  if(!s||!r?.card)return false;
  const solo=findProductionPlan(production(s),[r.card]);
  return !!solo&&solo.days.at(-1)!.day>s.day&&!hasGrowthCalendar(s)||!findProductionPlan(production(s),[...s.board.active,...fairGoal(s.events,s.day),r.card]);
}
export function acceptUrgent(state:GameState,id:number):GameState {
  const s=requireSeasonAction(state),r=s.events.requests.find(r=>r.id===id);
  if(s.events.requests.filter(r=>r.status==='active').length>=eventSlots(s.access))throw Error('Место срочной просьбы занято.');
  if(!r?.card||r.status!=='offer'||r.card.deadline<s.day)throw Error('Просьба недоступна.');
  const plan=findProductionPlan(production(s),[r.card]);
  if(!plan)throw Error('За оставшееся время план просьбы не найден.');
  if(plan.days.at(-1)!.day>s.day&&!hasGrowthCalendar(s))throw Error('Для выращивания просьбы сначала нужен выполнимый основной заказ. Готовые цветы можно сдать без перехода дня.');
  return {...state,season:{...clearUndo(s),events:{...s.events,requests:s.events.requests.map(x=>x.id===id?{...x,status:'active'}:x)}}};
}
export function submitUrgent(state:GameState,id:number,confirmed=false):GameState {
  const s=requireSeasonAction(state),r=s.events.requests.find(r=>r.id===id);
  if(!r?.card||r.status!=='active'||r.card.deadline<s.day)throw Error('Нет активной просьбы.');
  let next=grantExperience(spend(state,r.card.ingredients,r.card.id,confirmed),r.card.experience);
  next={...next,profile:{...next.profile,progress:{...next.profile.progress,urgent:next.profile.progress.urgent+1}},season:{...next.season!,events:{...s.events,requests:s.events.requests.map(x=>x.id===id?{...x,status:'done',delivered:s.day}:x)}}};
  return r.template==='U3'?reward(next,'urgent',r.card.id):refreshStateOffers(next);
}
export function fairIngredients(bonus:boolean):Ingredient[]{return [{kind:'carnation',count:bonus?6:8},{kind:'chrysanthemum',count:bonus?6:8}];}
export function submitFair(state:GameState,bonus=false,confirmed=false):GameState {
  const s=requireSeasonAction(state),fair=s.events.fair;
  if(s.day<6||s.day>10||fair.closed||(!bonus&&fair.minimum)||(bonus&&(!fair.minimum||fair.bonus)))throw Error('Эта цель ярмарки сейчас недоступна.');
  let next=grantExperience(spend(state,fairIngredients(bonus),bonus?20001:20000,confirmed),bonus?12:16);
  next={...next,season:{...next.season!,events:{...s.events,fair:{...fair,minimum:true,bonus:fair.bonus||bonus}}}};
  return bonus?reward(next,'fair',20001):refreshStateOffers(next);
}
export function closeDay(state:GameState):GameState {
  if(state.season?.board.result)return state;
  const s=requireSeasonAction(state);
  if(!s.board.active.length)throw Error('Для перехода дня нужен активный основной заказ.');
  const expired=s.board.active.filter(o=>o.deadline<=s.day),fairDue=s.day===10&&!s.events.fair.minimum&&!s.events.fair.closed;
  const reputation=Math.max(0,s.reputation-expired.length-Number(fairDue));
  const events={fair:{...s.events.fair,closed:s.events.fair.closed||s.day===10},requests:s.events.requests.map(r=>(r.status==='offer'||r.status==='active')&&r.card!.deadline<=s.day?{...r,status:'expired' as const}:r)};
  const next:GameState={...state,season:{...s,reputation,events,board:{...s.board,active:s.board.active.filter(o=>o.deadline>s.day),offers:s.board.offers.filter(o=>o.deadline>s.day),reason:expired.length||s.board.offers.some(o=>o.deadline<=s.day)?'expired':s.board.reason}}};
  if(!reputation||s.day===20)return finish(next,!reputation?'reputation':'calendar');
  return refreshStateOffers(enterGrowthDay(next));
}
export function canSurrenderSeason(state:GameState):boolean {
  const s=state.season;
  return !!s&&!s.board.result&&!s.board.pending&&!s.board.active.length&&!s.board.offers.some(o=>findProductionPlan(production(s),[o,...fairGoal(s.events,s.day)]));
}
export function surrenderSeason(state:GameState):GameState {
  if(state.season?.board.result)return state;
  requireSeasonAction(state);
  if(!canSurrenderSeason(state))throw Error('Добровольное завершение доступно без активного заказа, когда ни для одного предложения не найден план.');
  return finish(state,'surrender');
}
export function harvestAll(state:GameState):GameState {
  const s=requireSeasonAction(state);let next=state;
  for(const p of s.garden.plants)if(p.yield&&p.wilt<3)next=harvest(next,p);
  return next;
}
