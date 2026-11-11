import type { GameState } from './state.ts';
import { isPlant, type ObjectKind, type PlantKind } from './layout.ts';
import type { FieldSize } from './field.ts';

export const PURCHASES = [
  { id:'rose', name:'Роза', level:2, price:60, text:'Новый вид · нужен полив, свет ускоряет рост.' },
  { id:'tulip', name:'Тюльпан', level:3, price:80, text:'Новый вид · нужен свет, полив ускоряет рост.' },
  { id:'main-slot', name:'Второе основное место', level:3, price:120, text:'Два заказа параллельно. Всего по-прежнему пять основных до финала.' },
  { id:'gerbera', name:'Гербера', level:4, price:100, text:'Новый вид · нужен свет, полив ускоряет рост.' },
  { id:'field', name:'Участок на 37 клеток', level:4, price:200, text:'Постоянное расширение принятого контура с 19 до 37 клеток.' },
  { id:'event-slot', name:'Второе событийное место', level:4, price:100, text:'Можно принять две срочные просьбы одновременно.' },
  { id:'lily', name:'Лилия', level:5, price:120, text:'Новый вид · нужен полив, свет ускоряет рост.' },
] as const;
export type PurchaseId = typeof PURCHASES[number]['id'];
export const LEVELS = [0,60,180,360,600] as const;
export const accessLevel = (experience:number):number => LEVELS.filter(n=>experience>=n).length;
export const fieldSize = (owned:readonly PurchaseId[]):FieldSize => owned.includes('field')?37:19;
export const mainSlots = (owned:readonly PurchaseId[]):number => owned.includes('main-slot')?2:1;
export const eventSlots = (owned:readonly PurchaseId[]):number => owned.includes('event-slot')?2:1;
export const availableKind = (owned:readonly PurchaseId[],kind:ObjectKind):boolean => !isPlant(kind)||kind==='carnation'||kind==='chrysanthemum'||owned.includes(kind as PurchaseId);
export const openFlowers = (owned:readonly PurchaseId[]):PlantKind[] => (['carnation','chrysanthemum','rose','tulip','gerbera','lily'] as PlantKind[]).filter(k=>availableKind(owned,k));
export function isOwned(value:unknown,experience:number):value is PurchaseId[] {
  return Array.isArray(value)&&new Set(value).size===value.length&&value.every(id=>PURCHASES.some(p=>p.id===id&&p.level<=accessLevel(experience)));
}
export function purchase(state:GameState,id:PurchaseId):GameState {
  if(state.season&&!state.season.board.result)throw Error('Покупки доступны только между сезонами.');
  const item=PURCHASES.find(p=>p.id===id);
  if(!item)throw Error('Покупка не найдена.');
  if(state.profile.owned.includes(id))throw Error('Уже приобретено.');
  if(accessLevel(state.profile.experience)<item.level)throw Error(`Нужен уровень ${item.level}.`);
  if(state.profile.coins<item.price)throw Error('Недостаточно монет.');
  return {...state,profile:{...state.profile,coins:state.profile.coins-item.price,owned:[...state.profile.owned,id]}};
}
