import { ru } from '../i18n/ru.ts';
import type { GameState } from './state.ts';
import { isPlant, type ObjectKind, type PlantKind } from './layout.ts';
import type { FieldSize } from './field.ts';

export const PURCHASES = [
  { id:'rose', name:ru.shop.items.rose.name, level:2, price:60, text:ru.shop.items.rose.text },
  { id:'tulip', name:ru.shop.items.tulip.name, level:3, price:80, text:ru.shop.items.tulip.text },
  { id:'main-slot', name:ru.shop.items['main-slot'].name, level:3, price:120, text:ru.shop.items['main-slot'].text },
  { id:'gerbera', name:ru.shop.items.gerbera.name, level:4, price:100, text:ru.shop.items.gerbera.text },
  { id:'field', name:ru.shop.items.field.name, level:4, price:200, text:ru.shop.items.field.text },
  { id:'event-slot', name:ru.shop.items['event-slot'].name, level:4, price:100, text:ru.shop.items['event-slot'].text },
  { id:'lily', name:ru.shop.items.lily.name, level:5, price:120, text:ru.shop.items.lily.text },
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
  if(state.season&&!state.season.board.result)throw Error(ru.errors.shopOnlyBetween);
  const item=PURCHASES.find(p=>p.id===id);
  if(!item)throw Error(ru.errors.purchaseNotFound);
  if(state.profile.owned.includes(id))throw Error(ru.errors.alreadyBought);
  if(accessLevel(state.profile.experience)<item.level)throw Error(ru.errors.needLevel(item.level));
  if(state.profile.coins<item.price)throw Error(ru.errors.notEnoughCoins);
  return {...state,profile:{...state.profile,coins:state.profile.coins-item.price,owned:[...state.profile.owned,id]}};
}
