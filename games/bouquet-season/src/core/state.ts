import { fieldSize, mainSlots, eventSlots, openFlowers, availableKind, isOwned, type PurchaseId } from './shop.ts';
import { isObjects, changeLayout, type Layout, type LayoutCommand } from './layout.ts';
import { newGarden, emptyStock, editGarden, isGarden, type Garden } from './garden.ts';
import { growDay, cutPlant } from './growth.ts';
import { sameCell, type Cell } from './field.ts';
import { newBoard, refreshOffers, isBoard, boardIncome, boardExperience, type OrderBoard } from './board.ts';
import { emptyEffects, editEffectBindings, isEffects, compatible, type EffectsState } from './effects.ts';
import { startEvents, discoverEvents, fairGoal, isEvents, eventIncome, eventExperience, closeEvents, type EventsState } from './events.ts';
import { newStory, isStory, storySteps, type StoryProgress } from './progress.ts';
import { findProductionPlan } from './planner.ts';
import { drawReward } from './rewards.ts';
export interface Settings {
  tutorial: boolean;
  reducedMotion: boolean;
}
export interface GameState {
  profile: { coins: number; experience: number; seasonsStarted: number; progress: StoryProgress; owned: PurchaseId[]; tutorial: string[] };
  settings: Settings;
  season: null | { access: PurchaseId[]; number: number; day: number; reputation: number; rng: number; status: 'preparing'|'growing'; layout: Layout; garden: Garden; board: OrderBoard; effects: EffectsState; events: EventsState };
}

export function newProfile(): GameState {
  return {
    profile: { coins: 0, experience: 0, seasonsStarted: 0, progress: newStory(), owned: [], tutorial: [] },
    settings: { tutorial: true, reducedMotion: false },
    season: null,
  };
}

export function startSeason(state: GameState, seed: number): GameState {
  if (state.season && !state.season.board.result) return state;
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) throw new Error('Некорректное состояние генератора.');
  const number = state.profile.seasonsStarted + 1;
  const schedule = startEvents(seed);
  const next: GameState = {
    ...state,
    profile: { ...state.profile, seasonsStarted: number },
    season: { access: [...state.profile.owned], number, day: 1, reputation: 3, rng: schedule.rng, effects: emptyEffects(), events: schedule.events, status: 'preparing', layout: { objects: [], undo: null },garden:newGarden({objects:[],undo:null}), board: newBoard() },
  };
  if (!isGameState(next)) throw new Error('Некорректное состояние сезона.');
  return refreshStateOffers(next);
}

export function refreshStateOffers(state: GameState): GameState {
  if (!state.season) return state;
  const s = state.season;
  if (s.board.result) return state;
  const production = { day:s.day,objects:s.layout.objects,plants:s.garden.plants,stock:s.garden.stock,effects:s.effects,size:fieldSize(s.access),open:openFlowers(s.access),mainSlots:mainSlots(s.access),eventSlots:eventSlots(s.access) };
  const result = refreshOffers(s.board, production, s.rng, fairGoal(s.events,s.day));
  let calendar:boolean|undefined;
  const discovered = s.board.pending ? {events:s.events,rng:result.rng} : discoverEvents(s.events,production,result.rng,()=>calendar??=hasGrowthCalendar(s,result.board));
  return result.board===s.board&&discovered.rng===s.rng&&discovered.events===s.events ? state : {...state,season:{...s,board:result.board,rng:discovered.rng,events:discovered.events}};
}

// Просьба не создаёт календарных переходов: для будущего роста нужен основной.
export function hasGrowthCalendar(s:NonNullable<GameState['season']>,board=s.board):boolean {
  return !!board.active.length || board.offers.some(o=>findProductionPlan({day:s.day,objects:s.layout.objects,plants:s.garden.plants,stock:s.garden.stock,effects:s.effects,size:fieldSize(s.access)},[o,...fairGoal(s.events,s.day)]));
}

export function requireSeasonAction(state: GameState): NonNullable<GameState['season']> {
  if (!state.season) throw Error('Сначала начните сезон.');
  if (state.season.board.result) throw Error('Сезон уже завершён.');
  if (state.season.board.pending) throw Error('Сначала завершите выбор улучшения.');
  return state.season;
}

export function changeSettings(state: GameState, patch: Partial<Settings>): GameState {
  return { ...state, settings: { ...state.settings, ...patch } };
}

export function editLayout(state: GameState, command: LayoutCommand): GameState {
  const season = requireSeasonAction(state);
  if(command.type==='place'&&!availableKind(season.access,command.kind))throw Error('Объект ещё не открыт.');
  const layout = changeLayout(season.layout,command,fieldSize(season.access));
  return layout === season.layout ? state : refreshStateOffers({ ...state,season:{ ...season,layout,garden:editGarden(season.garden,command),effects:editEffectBindings(season.effects,command) } });
}

// Часть календарного перехода. Контроллер сезона сначала проверяет активный заказ
// и дедлайны. В обычном UI этапа 3 эта функция не вызывается без доски заказов.
export function enterGrowthDay(state: GameState): GameState {
  requireSeasonAction(state);
  if(!state.season)throw Error('Сначала начните сезон.');
  if(state.season.day===20)throw Error('Рост дня 21 не допускается.');
  const grown=growDay(state.season.layout.objects,state.season.garden.plants,state.season.effects,fieldSize(state.season.access));
  return {...state,season:{...state.season,day:state.season.day+1,status:'growing',
    effects:{...state.season.effects,undo:null},layout:{objects:grown.objects,undo:null},garden:{...state.season.garden,plants:grown.plants,undo:null}}};
}
export function harvest(state: GameState, cell: Cell): GameState {
  requireSeasonAction(state);
  if(!state.season)throw Error('Сначала начните сезон.');
  const result=cutPlant(state.season.layout.objects,state.season.garden.plants,cell);
  const count=state.season.garden.stock[result.kind]+result.amount;
  if(!Number.isSafeInteger(count))throw Error('Запас цветов превышает допустимое число.');
  return refreshStateOffers({...state,season:{...state.season,effects:{...state.season.effects,undo:null},layout:{...state.season.layout,undo:null},garden:{
    plants:result.plants,undo:null,stock:{...state.season.garden.stock,[result.kind]:count},
  }}});
}

function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function baseState(value: unknown, version: 1|2|3|4|5|6 = 6): boolean {
  if (!object(value, ['profile', 'settings', 'season'])) return false;
  const { profile: p, settings: settings, season: run } = value;
  if (!object(p, version<5 ? ['coins','experience','seasonsStarted'] : version===5 ? ['coins','experience','seasonsStarted','progress'] : ['coins','experience','seasonsStarted','progress','owned','tutorial'])
    || !natural(p.coins) || !natural(p.experience) || !natural(p.seasonsStarted) || version>=5 && !isStory(p.progress)) return false;
  if(version===6&&(!isOwned(p.owned,p.experience as number)||!Array.isArray(p.tutorial)||new Set(p.tutorial).size!==p.tutorial.length||!p.tutorial.every(t=>['accept','plant','care','day','cut','submit'].includes(t))))return false;
  if (!object(settings, ['tutorial','reducedMotion']) || typeof settings.tutorial!=='boolean' || typeof settings.reducedMotion!=='boolean') return false;
  if (run===null) return p.seasonsStarted===0 && (version<5 || Object.values(p.progress as StoryProgress).every(n=>n===0));
  const keys=[...(version===6?['access']:[]),'number','day','reputation','rng','status',...(version>=2?['layout']:[]),...(version>=3?['garden']:[]),...(version>=4?['board']:[]),...(version>=5?['effects','events']:[])];
  if (!object(run,keys) || !natural(run.number) || run.number<1 || run.number!==p.seasonsStarted
    || !natural(run.day) || run.day<1 || run.day>20 || (version<4 ? run.reputation!==3 : !natural(run.reputation) || run.reputation>3)
    || (version<3 ? run.day!==1 || run.status!=='preparing' : run.status!==(run.day===1?'preparing':'growing'))
    || !natural(run.rng) || run.rng<1 || run.rng>0xffffffff) return false;
  const access=version===6?run.access as PurchaseId[]:[];
  if(version===6&&(!isOwned(access,p.experience as number)||access.some(id=>!(p.owned as PurchaseId[]).includes(id))||!(run.board as OrderBoard)?.result&&JSON.stringify(access)!==JSON.stringify(p.owned)))return false;
  const open=openFlowers(access), size=fieldSize(access);
  const kinds=[...open,'lamp','sprinkler'] as const;
  const layout=run.layout as Layout;
  if (version>=2 && (!object(layout,['objects','undo']) || !isObjects(layout.objects,size,kinds) || layout.undo!==null && !isObjects(layout.undo,size,kinds))) return false;
  if (version>=3 && !isGarden(run.garden,layout,run.day,version<5,version<6)) return false;
  if (version<4) return true;
  const events=run.events as EventsState;
  if (version>=5 && (!isEffects(run.effects,layout) || !isEvents(events,run.day,!!(run.board as OrderBoard)?.result,eventSlots(access),open))) return false;
  if (!isBoard(run.board,run.day,run.reputation as number,version<5,version>=5?eventIncome(events):0,version>=5?eventExperience(events):0,mainSlots(access),open)) return false;
  const board=run.board;
  if ((p.experience as number)<boardExperience(board)+(version>=5?eventExperience(events):0) || version<6&&(p.coins as number)<(board.result?.credited??0)) return false;
  if (version>=5) {
    if(version===6&&Object.entries((run.garden as Garden).stock).some(([k,n])=>n>0&&!open.includes(k as typeof open[number])))return false;
    const progress=p.progress as StoryProgress, fx=run.effects as EffectsState;
    if(progress.main<board.completed.length || progress.urgent<events.requests.filter(r=>r.status==='done').length || progress.wins<Number(board.result?.outcome==='win'))return false;
    const pending=board.pending;
    const steps=storySteps(progress),allowed=(effect:string)=>effect!=='P5'||steps[0];
    const unlocked=(effect:string)=>allowed(effect)&&(effect!=='E3'||steps[1])&&(effect!=='E4'||steps[2]);
    if([...fx.globals,...fx.modules,...(pending?.options??[])].some(e=>!unlocked(e.effect)||'target' in e&&e.target!==null&&!availableKind(access,e.target))
      ||fx.globals.length+fx.modules.length>board.completed.length+Number(events.fair.bonus)+events.requests.filter(r=>r.status==='done'&&r.template==='U3').length-Number(!!pending))return false;
    if(pending && (pending.options.some(o=>fx.globals.some(g=>g.effect===o.effect&&g.target===o.target))
      || pending.source==='urgent' && !events.requests.some(r=>r.status==='done'&&r.template==='U3'&&r.card!.id===pending.orderId)
      || pending.source==='fair' && (!events.fair.bonus || pending.orderId!==20001)))return false;
  }
  return true;
}
export function isGameState(value: unknown): value is GameState { return baseState(value); }
// Старую форму проверяем до преобразования. Чтение не пишет и не перебрасывает RNG.
export function readState(value: unknown, version: 1|2|3|4|5|6): GameState | null {
  if(version===6)return isGameState(value)?value:null;
  if(!baseState(value,version))return null;
  const old=structuredClone(value) as GameState;
  if(version===5){
    old.profile={...old.profile,owned:[],tutorial:[]};
    if(old.season){old.season.access=[];old.season.garden.stock={...emptyStock(),...old.season.garden.stock};}
    return isGameState(old)?old:null;
  }
  const progress={main:version===4?(old.season?.board.completed.length??0):0,urgent:0,wins:version===4&&old.season?.board.result?.outcome==='win'?1:0};
  const profile={...old.profile,progress,owned:[],tutorial:[]};
  if(!old.season)return {...old,profile};
  const s=old.season, layout:Layout=version===1?{objects:[],undo:null}:s.layout;
  const garden=version>=3?s.garden:newGarden(layout);
  garden.stock={...emptyStock(),...garden.stock};
  if(version>=3) {
    garden.plants=garden.plants.map(p=>({...p,supportBonus:false}));
    if(garden.undo)garden.undo=garden.undo.map(p=>({...p,supportBonus:false}));
  }
  const board=version===4?s.board:newBoard(), effects=emptyEffects();
  effects.undo=layout.undo?[]:null;
  const schedule=startEvents(s.rng,s.day);
  let rng=schedule.rng;
  if(board.pending) {const draw=drawReward(effects,progress,rng);rng=draw.rng;board.pending={...board.pending,source:'main',options:draw.options};}
  const next:GameState={...old,profile,season:{...s,access:[],layout,garden,board,effects,events:board.result?closeEvents(schedule.events):schedule.events,rng}};
  return refreshStateOffers(next);
}

export function installModule(state:GameState,id:number,at:Cell|null):GameState {
  const s=requireSeasonAction(state), module=s.effects.modules.find(m=>m.id===id);
  if(!module)throw Error('Модуль не найден.');
  if(at) {
    const obj=s.layout.objects.find(o=>sameCell(o,at));
    if(!obj || !compatible(module.effect,obj.kind))throw Error('Модуль не подходит этому объекту.');
    if(s.effects.modules.some(m=>m.id!==id&&m.at&&sameCell(m.at,at)))throw Error('Слот занят. Сначала снимите установленный модуль.');
  }
  if(at===null&&module.at===null || at&&module.at&&sameCell(at,module.at))return state;
  return refreshStateOffers({...state,season:{...s,layout:{...s.layout,undo:null},garden:{...s.garden,undo:null},effects:{...s.effects,undo:null,modules:s.effects.modules.map(m=>m.id===id?{...m,at:at&&{...at}}:m)}}});
}
