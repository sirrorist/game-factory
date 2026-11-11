import { nextRandom, portions, OPEN_FLOWERS, type FlowerKind, type Order } from './orders.ts';
import { findProductionPlan, type ProductionState, type ProductionGoal } from './planner.ts';

export type UrgentTemplate = 'U1' | 'U2' | 'U3';
export interface UrgentRequest {
  id: number;
  day: number;
  template: UrgentTemplate;
  status: 'scheduled' | 'waiting' | 'offer' | 'active' | 'done' | 'expired' | 'closed';
  card: Order | null;
  delivered: number | null;
}
export interface EventsState { requests: UrgentRequest[]; fair: { minimum: boolean; bonus: boolean; closed: boolean } }
export const urgentName = (template: UrgentTemplate): string => ({ U1: 'Подарок ко дню рождения', U2: 'Неожиданный подарок', U3: 'Свадебный букет' })[template];
export function startEvents(seed: number, day = 1): { events: EventsState; rng: number } {
  let rng = nextRandom(seed); const first = 3 + rng % 3;
  rng = nextRandom(rng); const second = 8 + rng % 3;
  const choices: UrgentTemplate[] = ['U1','U2','U3'];
  rng = nextRandom(rng); const t1 = choices.splice(rng % choices.length,1)[0]!;
  rng = nextRandom(rng); const t2 = choices[rng % choices.length]!;
  return { rng, events: { requests: [first,second].map((d,i)=>({id:i+1,day:d,template:i?t2:t1,status:d<day?'closed':d===day?'waiting':'scheduled',card:null,delivered:null})), fair: { minimum:false,bonus:false,closed:day>10 } } };
}
export function urgentCandidates(request: Pick<UrgentRequest,'id'|'template'>, day: number, open:readonly FlowerKind[] = OPEN_FLOWERS): Order[] {
  const single = request.template === 'U1', total = request.template === 'U3' ? 13 : 9;
  const alternatives: FlowerKind[][] = single ? open.map(k=>[k]) : open.flatMap(a=>open.filter(b=>b!==a).map(b=>[a,b]));
  return alternatives.map(kinds=>({id:10000+request.id,stage:0,recipe:request.template,format:'gift',appeared:day,deadline:Math.min(20,day+(request.template==='U3'?4:3)),
    ingredients:kinds.map((kind,i)=>({kind,count:portions(total,kinds.map(()=>1))[i]!})),coins:total*3,experience:total}));
}
export function fairGoal(events: EventsState, day: number): ProductionGoal[] {
  return events.fair.minimum || events.fair.closed || day>10 ? [] : [{id:20000,stage:0,recipe:'fair',format:'supply',appeared:3,deadline:10,earliest:6,
    ingredients:[{kind:'carnation',count:8},{kind:'chrysanthemum',count:8}],coins:48,experience:16}];
}
export const eventIncome = (events: EventsState): number => events.requests.reduce((n,r)=>n+(r.status==='done'?r.card!.coins:0),0)+(events.fair.minimum?48:0)+(events.fair.bonus?36:0);
export const eventExperience = (events: EventsState): number => events.requests.reduce((n,r)=>n+(r.status==='done'?r.card!.experience:0),0)+(events.fair.minimum?16:0)+(events.fair.bonus?12:0);
export function closeEvents(events: EventsState): EventsState {
  return { fair:{...events.fair,closed:true},requests:events.requests.map(r=>r.status==='done'||r.status==='expired'?r:{...r,status:'closed'}) };
}

const exact = (v: unknown, keys: string[]): v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const int = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && (v as number)>=min && (v as number)<=max;
export function isEvents(value: unknown, day: number, ended: boolean, slots=1, open:readonly FlowerKind[] = OPEN_FLOWERS): value is EventsState {
  if (!exact(value,['requests','fair']) || !exact(value.fair,['minimum','bonus','closed']) || !Object.values(value.fair).every(v=>typeof v==='boolean')
    || value.fair.bonus && !value.fair.minimum || day<6 && (value.fair.minimum || value.fair.bonus)
    || value.fair.closed && day<=10 && !ended
    || !value.fair.closed && (day>10 || ended) || !Array.isArray(value.requests) || value.requests.length!==2) return false;
  const templates=new Set<string>(); let active=0;
  for (let index=0;index<2;index++) {
    const r=value.requests[index];
    if (!exact(r,['id','day','template','status','card','delivered']) || r.id!==index+1 || !int(r.day,index?8:3,index?10:5)
      || !['U1','U2','U3'].includes(r.template as string) || templates.has(r.template as string)
      || !['scheduled','waiting','offer','active','done','expired','closed'].includes(r.status as string)) return false;
    templates.add(r.template as string);
    if (r.status==='active') active++;
    if (ended && !['done','expired','closed'].includes(r.status as string)) return false;
    if ((r.status==='scheduled' && (r.day as number)<=day) || (r.status!=='scheduled' && (r.day as number)>day && !ended)) return false;
    if (r.card===null) { if (!['scheduled','waiting','closed'].includes(r.status as string) || r.delivered!==null) return false; continue; }
    const card=r.card;
    if (!exact(card,['id','stage','recipe','format','appeared','deadline','ingredients','coins','experience']) || !int(card.appeared,r.day as number,day)) return false;
    const candidates=urgentCandidates(r as unknown as UrgentRequest,card.appeared,open);
    const ingredients=card.ingredients;
    if (!Array.isArray(ingredients) || !candidates.some(c=>Object.keys(c).every(k=>k==='ingredients' ? ingredients.length===c.ingredients.length && c.ingredients.every((i,n)=>exact(ingredients[n],['kind','count']) && ingredients[n].kind===i.kind && ingredients[n].count===i.count) : c[k as keyof Order]===card[k]))) return false;
    if (r.status==='done') { if (!int(r.delivered,card.appeared,Math.min(day,card.deadline as number))) return false; }
    else if (r.delivered!==null || r.status==='scheduled'||r.status==='waiting') return false;
    if ((r.status==='offer'||r.status==='active') && (card.deadline as number)<day) return false;
    if (r.status==='expired' && (card.deadline as number)>day) return false;
  }
  return active<=slots;
}

// Срок начинается при фактическом появлении карточки, а не в день уведомления.
export function discoverEvents(events: EventsState, state: ProductionState, seed: number, canGrow:()=>boolean=()=>true): { events: EventsState; rng: number } {
  let rng=seed;
  const requests=events.requests.map(r=>r.status==='scheduled' && r.day<=state.day ? {...r,status:'waiting' as const} : r);
  if (requests.filter(r=>r.status==='active').length<(state.eventSlots??1)) for (let i=0;i<requests.length;i++) {
    const r=requests[i]!;
    if(r.status!=='waiting')continue;
    const candidates=urgentCandidates(r,state.day,state.open??OPEN_FLOWERS).filter(card=>{const plan=findProductionPlan(state,[card]);return plan&&(plan.days.at(-1)!.day===state.day||canGrow());});
    if(!candidates.length)continue;
    rng=nextRandom(rng);
    requests[i]={...r,status:'offer',card:candidates[rng%candidates.length]!};
  }
  return {events:requests.every((r,i)=>r===events.requests[i])?events:{...events,requests},rng};
}
