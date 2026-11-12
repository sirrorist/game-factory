import { ru } from './i18n/ru.ts';
import type {GameState} from './core/state.ts';
import {PURCHASES,LEVELS,accessLevel,fieldSize,mainSlots,eventSlots,openFlowers} from './core/shop.ts';
import {objectName} from './core/layout.ts';
export function progressionMarkup(state:GameState,previousExperience?:number):string {
  const p=state.profile,level=accessLevel(p.experience),previous=previousExperience===undefined?level:accessLevel(previousExperience);
  const newAccess=PURCHASES.filter(item=>item.level>previous&&item.level<=level);
  return `<div class="progression"><p>${ru.shop.progression.level(level,p.experience)}${level<5?ru.shop.progression.toNext(level+1,LEVELS[level]!-p.experience):ru.shop.progression.allOpen}</p>${newAccess.length?`<p class="warning">${ru.shop.progression.newAccess(newAccess.map(i=>i.name).join(', '))}</p>`:''}<p class="small">${ru.shop.progression.opened(openFlowers(p.owned).map(objectName).join(', '))}<br>${ru.shop.progression.slots(fieldSize(p.owned),mainSlots(p.owned),eventSlots(p.owned))}</p></div>`;
}
export function shopMarkup(state:GameState):string {
  const p=state.profile,between=!state.season||!!state.season.board.result;
  return `<h2>${ru.shop.screen.title}</h2><p>${ru.shop.screen.wallet(p.coins)}</p>${progressionMarkup(state)}${!between?`<p class="warning">${ru.shop.screen.duringSeason}</p>`:''}<div class="orders-list shop-list">${PURCHASES.map(item=>{
    const owned=p.owned.includes(item.id),level=accessLevel(p.experience),available=level>=item.level;
    const reason=owned?ru.shop.screen.owned:!available?ru.shop.screen.needLevel(item.level,LEVELS[item.level-1]!):!between?ru.shop.screen.betweenOnly:p.coins<item.price?ru.shop.screen.notEnough(item.price-p.coins):ru.shop.screen.available;
    return `<article class="order-card" data-purchase="${item.id}"><span class="eyebrow">${ru.shop.screen.levelEyebrow(item.level)}</span><h3>${item.name}</h3><p>${item.text}</p><p><strong>${ru.shop.screen.price(item.price)}</strong> · ${reason}</p><button data-action="buy-${item.id}" data-unavailable="${owned||!available||!between||p.coins<item.price}">${owned?ru.shop.screen.alreadyBought:ru.shop.screen.buy(item.price)}</button></article>`;
  }).join('')}</div><div class="actions">${state.season?.board.result?`<button data-action="result">${ru.ui.common.seasonResults}</button>`:''}<button data-action="menu">${ru.ui.common.toWorkshop}</button>${between?`<button class="primary" data-action="start">${ru.ui.common.startNextSeason}</button>`:`<button data-action="continue">${ru.ui.common.toField}</button>`}</div>`;
}
