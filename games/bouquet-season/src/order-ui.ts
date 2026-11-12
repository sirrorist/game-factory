import { ru } from './i18n/ru.ts';
import {mainSlots,eventSlots} from './core/shop.ts';
import {progressionMarkup} from './shop-ui.ts';
import { boardIncome, boardExperience } from './core/board.ts';
import { flowerName, orderTitle, type Order } from './core/orders.ts';
import type { GameState } from './core/state.ts';
import type { PlantKind, PlacedObject } from './core/layout.ts';
import { canSurrenderSeason, urgentRisk, hasStock, fairIngredients } from './core/calendar.ts';
import { eventIncome, eventExperience, urgentName } from './core/events.ts';
import { effectDefinition, compatible, moduleAt } from './core/effects.ts';
import { objectName } from './core/layout.ts';
import { storySteps } from './core/progress.ts';
import { cellCenter, RADIUS, sameCell, type Cell } from './core/field.ts';

// Координаты клетки игроку ничего не говорят: называем часть поля словами.
const where = (cell: Cell): string => {
  const { x, y } = cellCenter(cell);
  return ru.effects.object.where(Math.abs(y) < RADIUS ? 0 : Math.sign(y), Math.abs(x) < RADIUS ? 0 : Math.sign(x));
};

const button =(action: string, label: string, primary = false, unavailable = false): string =>
  `<button data-action="${action}" class="${primary ? 'primary' : ''}" data-unavailable="${unavailable}">${label}</button>`;

function orderCard(state: GameState, order: Order, active: boolean): string {
  const stock = state.season!.garden.stock;
  const ready = order.ingredients.every(i => stock[i.kind as PlantKind] >= i.count);
  return `<article class="order-card" data-order="${order.id}">${active ? `<span class="note" aria-hidden="true">${ru.orders.card.inProgress}</span>` : ''}<h3>${orderTitle(order)}</h3>
    <p class="order-deadline">${ru.orders.card.deadline(order.deadline, order.appeared)}</p>
    <p>${order.ingredients.map(i => ru.orders.card.ingredient(flowerName(i.kind), stock[i.kind as PlantKind], i.count)).join('<br>')}</p>
    <p class="small">${ru.orders.card.reward(order.coins, order.experience)}</p>
    ${active ? button(`deliver-${order.id}`, ready ? ru.orders.card.deliver : ru.orders.card.missing, true, !ready) : button(`accept-${order.id}`, ru.orders.card.accept, true)}
    </article>`;
}

export function boardMarkup(state: GameState): string {
  const s = state.season!, b = s.board;
  const empty = !b.active.length && !b.offers.length;
  const stalled = canSurrenderSeason(state);
  const description = b.active.length ? ru.orders.board.descActive
    : empty ? ru.orders.board.descEmpty
      : stalled ? ru.orders.board.descStalled
      : ru.orders.board.descNormal;
  return `<h2>${ru.orders.board.title}</h2><p class="small">${ru.orders.board.summary(s.day, s.reputation, b.completed.length, b.active.length, mainSlots(s.access))}</p>
    <p class="small">${ru.orders.board.income(boardIncome(b)+eventIncome(s.events), boardExperience(b)+eventExperience(s.events))}</p>
    ${b.reason === 'expired' ? `<p class="warning">${ru.orders.board.expired}</p>` : ''}
    <p>${description}</p><div class="orders-list">${[...b.active.map(o => orderCard(state, o, true)), ...b.offers.map(o => orderCard(state, o, false))].join('')}</div>
    ${stalled ? `<p class="warning">${ru.orders.board.surrenderWarning}</p>` : ''}
    <div class="actions">${button('events',ru.orders.board.eventsStory)}${button('modules',ru.ui.common.seasonUpgrades)}${stalled ? button('surrender-confirm', ru.orders.board.surrender) : ''}${button('continue', ru.ui.common.toField)}</div>`;
}

export function pendingMarkup(state:GameState):string {
  const s=state.season!,p=s.board.pending!;
  return `<h2>${ru.orders.reward.title}</h2><p>${ru.orders.reward.intro(p.source==='main'?ru.orders.reward.doneMain(p.stage):p.source==='fair'?ru.orders.reward.doneFair:ru.orders.reward.doneUrgent)}</p>
    <p class="small">${ru.orders.reward.note}</p>
    <div class="orders-list reward-list">${p.options.map((option,i)=>{
      const def=effectDefinition(option.effect);
      return `<article class="order-card reward-card" data-effect="${option.effect}"><span class="eyebrow">${def.category==='plant'?ru.orders.reward.categoryPlant:ru.orders.reward.categoryDevice} · ${def.form==='module'?ru.orders.reward.formModule:ru.orders.reward.formGlobal}</span><h3>${def.name}</h3><p><strong>${option.target?objectName(option.target):def.category==='plant'?ru.orders.reward.targetPlant:ru.orders.reward.targetDevice}</strong></p><p>${def.text}</p>${button(`reward-${i}`,ru.orders.reward.pick,true)}</article>`;
    }).join('')}</div><p class="small">${s.board.completed.length===5?ru.orders.reward.afterFive:ru.orders.reward.afterOther}</p><div class="actions">${button('menu',ru.ui.common.menuAndSettings)}</div>`;
}
export function eventsMarkup(state:GameState):string {
  const s=state.season!,fair=s.events.fair,steps=storySteps(state.profile.progress),progress=state.profile.progress;
  const requests=s.events.requests.filter(r=>r.status!=='scheduled');
  const fairCard=s.day<3?ru.events.fair.notAnnounced:fair.closed?ru.events.fair.closed(!!fair.minimum):s.day<6?ru.events.fair.opensDay6:ru.events.fair.open;
  return `<h2>${ru.ui.common.eventsAndFair}</h2><h3>${ru.events.requests.title(s.events.requests.filter(r=>r.status==='active').length, eventSlots(s.access))}</h3><p class="small">${ru.events.requests.note}</p>
    <div class="orders-list">${requests.length?requests.map(r=>{
      const card=r.card,active=r.status==='active';
      return `<article class="order-card"><h3>${urgentName(r.template)}</h3>${r.status==='waiting'?`<p>${ru.events.requests.waiting}</p>`:card?`<p>${ru.events.requests.deadline(card.deadline, card.appeared)}</p><p>${card.ingredients.map(i=>ru.orders.card.ingredient(flowerName(i.kind), s.garden.stock[i.kind as PlantKind], i.count)).join('<br>')}</p><p class="small">${ru.events.requests.reward(card.coins, card.experience, r.template==='U3')}</p>${['offer','active'].includes(r.status)?`${urgentRisk(state,r.id)?`<p class="warning">${ru.events.requests.risk}</p>`:''}${active?button(`urgent-submit-${r.id}`,ru.events.requests.submit,true,!hasStock(state,card.ingredients)):button(`urgent-accept-${r.id}`,ru.events.requests.accept,true,s.events.requests.filter(x=>x.status==='active').length>=eventSlots(s.access))}`:`<p><strong>${r.status==='done'?ru.events.requests.statusDone:r.status==='expired'?ru.events.requests.statusExpired:ru.events.requests.statusClosed}</strong></p>`}`:`<p>${ru.events.requests.closed}</p>`}</article>`;
    }).join(''):`<p>${ru.events.requests.none}</p>`}</div>
    <h3>${ru.events.fair.title}</h3><article class="order-card"><p>${fairCard}</p>${s.day>=3?`<p class="small">${ru.events.fair.minimumRule}</p><p class="small">${ru.events.fair.bonusRule}</p>`:''}${s.day>=6&&!fair.closed?`<p>${ru.events.fair.stock(s.garden.stock.carnation, s.garden.stock.chrysanthemum)}</p>${fair.minimum?`<p>${ru.events.fair.minimumDone}</p>`:button('fair-minimum',ru.events.fair.submitMinimum,true,!hasStock(state,fairIngredients(false)))}${fair.minimum&&!fair.bonus?button('fair-bonus',ru.events.fair.submitBonus,true,!hasStock(state,fairIngredients(true))):fair.bonus?`<p>${ru.events.fair.bonusDone}</p>`:''}`:''}</article>
    <h3>${ru.events.story.title}</h3><div class="orders-list">${ru.events.story.steps.map((text,i)=>`<article class="order-card"><p>${steps[i]?ru.events.story.opened:ru.events.story.inProgress} · ${text}</p></article>`).join('')}</div><p class="small">${ru.events.story.total(progress.main, progress.urgent, progress.wins)}</p>
    <div class="actions">${button('orders',ru.ui.common.toOrders)}${button('continue',ru.ui.common.toField)}</div>`;
}
export function modulesMarkup(state:GameState,selectedModule:number|null=null):string {
  const s=state.season!,fx=s.effects,module=fx.modules.find(m=>m.id===selectedModule);
  return `<h2>${module?ru.effects.attach.title:ru.effects.list.title}</h2>${module?`<p><strong>${effectDefinition(module.effect).name}</strong></p><p>${effectDefinition(module.effect).text}</p><p class="small">${ru.effects.attach.rules}</p><div class="orders-list">${s.layout.objects.filter(o=>compatible(module.effect,o.kind)).map(o=>`<button data-action="attach-${o.q},${o.r}" data-unavailable="${fx.modules.some(m=>m.id!==module.id&&m.at&&m.at.q===o.q&&m.at.r===o.r)}">${ru.effects.attach.target(objectName(o.kind),where(o),fx.modules.some(m=>m.id!==module.id&&m.at&&m.at.q===o.q&&m.at.r===o.r))}</button>`).join('')||`<p>${ru.effects.attach.noTargets}</p>`}</div>`:`<p class="small">${ru.effects.list.note}</p><h3>${ru.effects.list.globalsTitle}</h3><div class="orders-list">${fx.globals.map(e=>`<article class="order-card"><h3>${effectDefinition(e.effect).name}</h3><p>${objectName(e.target!)} · ${effectDefinition(e.effect).text}</p></article>`).join('')||`<p>${ru.effects.list.none}</p>`}</div><h3>${ru.effects.list.modulesTitle}</h3><div class="orders-list">${fx.modules.map(m=>`<article class="order-card"><h3>${effectDefinition(m.effect).name}</h3><p>${effectDefinition(m.effect).text}</p><p>${m.at?ru.effects.list.installedAt(objectName(s.layout.objects.find(o=>sameCell(o,m.at!))!.kind),where(m.at)):ru.effects.list.inStock}</p>${button(`module-${m.id}`,m.at?ru.effects.list.move:ru.effects.list.install,true)}${m.at?button(`detach-${m.id}`,ru.effects.list.detach):''}</article>`).join('')||`<p>${ru.effects.list.none}</p>`}</div>`}<div class="actions">${module?button('modules',ru.effects.list.backToUpgrades):button('orders',ru.ui.common.toOrders)}${button('continue',ru.ui.common.toField)}</div>`;
}

export function objectModulesMarkup(state: GameState, object: PlacedObject): string {
  const season = state.season!, current = moduleAt(season.effects, object);
  const choices = season.effects.modules.filter(m => m.id !== current?.id && compatible(m.effect, object.kind));
  const installed = current ? `<article class="order-card"><h3>${effectDefinition(current.effect).name}</h3><p>${effectDefinition(current.effect).text}</p><p class="small">${ru.effects.object.installedHere(current.id)}</p>${button('object-detach',ru.effects.object.detach)}</article>` : `<p>${ru.effects.object.slotFree}</p>`;
  const options = choices.map(module => {
    const source = module.at && season.layout.objects.find(o => o.q === module.at!.q && o.r === module.at!.r);
    const location = source ? ru.effects.object.location(objectName(source.kind), where(source)) : ru.effects.object.inStock;
    return `<article class="order-card"><h3>${effectDefinition(module.effect).name}</h3><p>${effectDefinition(module.effect).text}</p><p class="small">${ru.effects.object.moduleLine(module.id, location)}</p>${button(`object-module-${module.id}`,source?ru.effects.object.moveHere:ru.effects.object.installHere,true,!!current)}</article>`;
  }).join('');
  return `<h2>${ru.effects.object.title(objectName(object.kind))}</h2><p class="small">${ru.effects.object.rules}</p>${installed}${current&&choices.length?`<p class="small">${ru.effects.object.detachFirst}</p>`:''}<div class="orders-list">${options||`<p>${ru.effects.object.noOthers}</p>`}</div><div class="actions">${button('object',ru.effects.object.backToObject)}${button('continue',ru.ui.common.toField)}</div>`;
}

export function resultMarkup(state: GameState): string {
  const s = state.season!, r = s.board.result!;
  const reason = { final: ru.orders.result.reasonFinal, reputation: ru.orders.result.reasonReputation, calendar: ru.orders.result.reasonCalendar, surrender: ru.orders.result.reasonSurrender }[r.reason];
  return `<h2>${r.outcome === 'win' ? ru.orders.result.win : ru.orders.result.loss}</h2><p>${reason}</p>
    <div class="season-result"><p>${ru.orders.result.income(r.income)}</p><p>${ru.orders.result.lost(r.lost)}</p>
    <p>${ru.orders.result.credited(r.credited)}</p><p>${ru.orders.result.experience(r.experience)}</p>
    <p>${ru.orders.result.total(state.profile.coins, state.profile.experience)}</p></div>
    ${progressionMarkup(state,state.profile.experience-r.experience)}<p class="small">${ru.orders.result.saved}</p>
    <div class="actions">${button('shop',ru.ui.common.workshopDevelopment,true)}${button('start', ru.ui.common.startNewSeason)}${button('menu', ru.ui.common.toWorkshop)}</div>`;
}
