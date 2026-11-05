import {orderFixture,readyOrderFixture,activeOrderFixture} from './order-fixtures.ts';
import {submitOrder,closeDay} from '../src/core/calendar.ts';
import {urgentCandidates} from '../src/core/events.ts';
import {editLayout,type GameState} from '../src/core/state.ts';
import {newPlant} from '../src/core/growth.ts';

export function moduleFixture():GameState {
  let s=orderFixture(3,6,30);
  for(const [kind,q,r] of [['sprinkler',1,0],['lamp',0,-1],['carnation',0,0],['chrysanthemum',-1,0]] as const)s=editLayout(s,{type:'place',kind,to:{q,r}});
  s.season!.layout.undo=null;s.season!.garden.undo=null;
  s.season!.effects={globals:[{effect:'P1',target:'carnation'}],modules:[{id:1,effect:'P6',at:null},{id:2,effect:'E5',at:null}],nextId:3,undo:null};
  return s;
}
export function eventFixture(day=6,urgent='U3' as 'U1'|'U2'|'U3',stock=100):GameState {
  const s=readyOrderFixture(2,day);
  s.season!.garden.stock={carnation:stock,chrysanthemum:stock,rose:0,tulip:0,gerbera:0,lily:0};
  const r=s.season!.events.requests[0]!;
  r.template=urgent;r.status='offer';r.card=urgentCandidates(r,day)[0]!;
  s.season!.events.requests[1]!.template=urgent==='U1'?'U2':'U1';
  return s;
}
export function moduleRewardFixture():GameState {
  const s=submitOrder(readyOrderFixture(0,1),20);
  // Отдельная валидная тройка: интерфейс не зависит от конкретного RNG выбранной подготовки.
  s.season!.board.pending!.options=[{effect:'P6',target:null},{effect:'E5',target:null},{effect:'P2',target:'carnation'}];
  return s;
}

export function noCalendarRequestFixture():GameState {
  let s=activeOrderFixture(4,17,12);
  for(const [kind,q,r] of [['sprinkler',0,0],['carnation',1,0],['carnation',1,-1],['carnation',0,-1],['carnation',-1,0],['carnation',-1,1]] as const)s=editLayout(s,{type:'place',kind,to:{q,r}});
  for(const p of s.season!.garden.plants)Object.assign(p,{growth:3,growthDays:1,bonus:false,supportBonus:false});
  s.season!.layout.undo=null;s.season!.garden.undo=null;s.season!.effects.undo=null;
  s.season!.events.requests=[{id:1,day:3,template:'U2',status:'active',card:urgentCandidates({id:1,template:'U2'},14)[0]!,delivered:null},{id:2,day:8,template:'U1',status:'waiting',card:null,delivered:null}];
  return closeDay(s);
}
