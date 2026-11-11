import type {GameState} from './core/state.ts';
import {PURCHASES,LEVELS,accessLevel,fieldSize,mainSlots,eventSlots,openFlowers} from './core/shop.ts';
import {objectName} from './core/layout.ts';
export function progressionMarkup(state:GameState,previousExperience?:number):string {
  const p=state.profile,level=accessLevel(p.experience),previous=previousExperience===undefined?level:accessLevel(previousExperience);
  const newAccess=PURCHASES.filter(item=>item.level>previous&&item.level<=level);
  return `<div class="progression"><p><strong>Уровень мастерской ${level}</strong> · ${p.experience} опыта${level<5?`<br>До уровня ${level+1}: ${LEVELS[level]!-p.experience} опыта`:' · весь каталог доступен для покупки'}</p>${newAccess.length?`<p class="warning">Теперь можно купить: ${newAccess.map(i=>i.name).join(', ')}.</p>`:''}<p class="small">Открыто: ${openFlowers(p.owned).map(objectName).join(', ')}.<br>Участок ${fieldSize(p.owned)} клеток · основных мест ${mainSlots(p.owned)} · событийных ${eventSlots(p.owned)}.</p></div>`;
}
export function shopMarkup(state:GameState):string {
  const p=state.profile,between=!state.season||!!state.season.board.result;
  return `<h2>Развитие мастерской</h2><p>Кошелёк: <strong>${p.coins} монет</strong>. Опыт накопительный и не расходуется. Покупки независимы и сохраняются между сезонами.</p>${progressionMarkup(state)}${!between?'<p class="warning">Сейчас идёт сезон. Покупать можно после его итогов; новые открытия появятся в следующем сезоне.</p>':''}<div class="orders-list shop-list">${PURCHASES.map(item=>{
    const owned=p.owned.includes(item.id),level=accessLevel(p.experience),available=level>=item.level;
    const reason=owned?'Приобретено ✓':!available?`Нужен уровень ${item.level} · ${LEVELS[item.level-1]} опыта`:!between?'Между сезонами':p.coins<item.price?`Не хватает ${item.price-p.coins} монет`:'Доступно';
    return `<article class="order-card" data-purchase="${item.id}"><span class="eyebrow">УРОВЕНЬ ${item.level}</span><h3>${item.name}</h3><p>${item.text}</p><p><strong>${item.price} монет</strong> · ${reason}</p><button data-action="buy-${item.id}" data-unavailable="${owned||!available||!between||p.coins<item.price}">${owned?'Уже куплено':`Купить: ${item.price} монет`}</button></article>`;
  }).join('')}</div><div class="actions">${state.season?.board.result?'<button data-action="result">Итоги сезона</button>':''}<button data-action="menu">В мастерскую</button>${between?'<button class="primary" data-action="start">Начать следующий сезон</button>':'<button data-action="continue">К полю</button>'}</div>`;
}
