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

const button = (action: string, label: string, primary = false, unavailable = false): string =>
  `<button data-action="${action}" class="${primary ? 'primary' : ''}" data-unavailable="${unavailable}">${label}</button>`;

function orderCard(state: GameState, order: Order, active: boolean): string {
  const stock = state.season!.garden.stock;
  const ready = order.ingredients.every(i => stock[i.kind as PlantKind] >= i.count);
  return `<article class="order-card" data-order="${order.id}">${active ? '<span class="note" aria-hidden="true">в работе</span>' : ''}<h3>${orderTitle(order)}</h3>
    <p class="order-deadline">До конца дня ${order.deadline} · предложение дня ${order.appeared}</p>
    <p>${order.ingredients.map(i => `${flowerName(i.kind)}: <strong>${stock[i.kind as PlantKind]} / ${i.count}</strong>`).join('<br>')}</p>
    <p class="small">Награда: ${order.coins} монет · ${order.experience} опыта</p>
    ${active ? button(`deliver-${order.id}`, ready ? 'Сдать заказ' : 'Не хватает цветов', true, !ready) : button(`accept-${order.id}`, 'Принять заказ', true)}
    </article>`;
}

export function boardMarkup(state: GameState): string {
  const s = state.season!, b = s.board;
  const empty = !b.active.length && !b.offers.length;
  const stalled = canSurrenderSeason(state);
  const description = b.active.length ? 'Срок не меняется при перезагрузке. Сдача доступна весь день дедлайна; просрочка — при его завершении.'
    : empty ? 'Поиск пока не нашёл план выращивания в оставшийся срок. Это не доказательство невозможности: можно срезать готовые цветы (кнопка на поле) и изменить расстановку. Бесплатного перехода дня нет.'
      : stalled ? 'Для показанных карточек план в оставшийся срок больше не найден. Составы и сроки сохранены. Можно изменить расстановку, срезать готовые цветы или добровольно закончить сезон.'
      : 'Выберите один заказ. Для каждого найден план выращивания на доступном участке. Для выполнения потребуется подходящая расстановка и уход; результат зависит от ваших действий.';
  return `<h2>Доска заказов</h2><p class="small">День ${s.day} / 20 · репутация ${s.reputation} / 3 · основных выполнено ${b.completed.length} / 5 · мест занято ${b.active.length} / ${mainSlots(s.access)}</p>
    <p class="small">Доход сезона: ${boardIncome(b)+eventIncome(s.events)} монет · опыт сезона: ${boardExperience(b)+eventExperience(s.events)}</p>
    ${b.reason === 'expired' ? '<p class="warning">Предыдущий заказ просрочен: −1 репутация. Эта ступень остаётся незавершённой; новые сроки указаны на карточках.</p>' : ''}
    <p>${description}</p><div class="orders-list">${[...b.active.map(o => orderCard(state, o, true)), ...b.offers.map(o => orderCard(state, o, false))].join('')}</div>
    ${stalled ? '<p class="warning">Можно добровольно закончить сезон поражением. Старые накопления и весь опыт сохранятся; потеряется 25% дохода этого сезона с округлением вниз.</p>' : ''}
    <div class="actions">${button('events','Просьбы, ярмарка и сюжет')}${button('modules','Сезонные улучшения')}${stalled ? button('surrender-confirm', 'Закончить сезон…') : ''}${button('continue', 'К полю')}</div>`;
}

export function pendingMarkup(state:GameState):string {
  const s=state.season!,p=s.board.pending!;
  return `<h2>Выберите улучшение</h2><p>${p.source==='main'?`Заказ ${p.stage} / 5 выполнен`:p.source==='fair'?'Дополнительная цель ярмарки выполнена':'Срочная просьба выполнена'}. Цветы списаны, награда сохранена.</p>
    <p class="small">Один вариант действует до конца этого сезона. Модули попадают в запас: установите их через «Сезонные улучшения». Эти три варианта сохраняются при перезагрузке.</p>
    <div class="orders-list reward-list">${p.options.map((option,i)=>{
      const def=effectDefinition(option.effect);
      return `<article class="order-card reward-card" data-effect="${option.effect}"><span class="eyebrow">${def.category==='plant'?'РАСТЕНИЯ':'ОБОРУДОВАНИЕ'} · ${def.form==='module'?'МОДУЛЬ':'ЭФФЕКТ ВИДА'}</span><h3>${def.name}</h3><p><strong>${option.target?objectName(option.target):def.category==='plant'?'На одно растение':'На одно устройство'}</strong></p><p>${def.text}</p>${button(`reward-${i}`,'Выбрать это улучшение',true)}</article>`;
    }).join('')}</div><p class="small">${s.board.completed.length===5?'После выбора откроются финальные композиции.':'Продолжение сезона — после выбора.'}</p><div class="actions">${button('menu','Меню и настройки')}</div>`;
}
export function eventsMarkup(state:GameState):string {
  const s=state.season!,fair=s.events.fair,steps=storySteps(state.profile.progress),progress=state.profile.progress;
  const requests=s.events.requests.filter(r=>r.status!=='scheduled');
  const fairCard=s.day<3?'Ярмарка ещё не объявлена.':fair.closed?`Ярмарка закрыта. ${fair.minimum?'Минимум выполнен.':'Минимум не выполнен.'}`:s.day<6?'Ярмарка откроется в день 6. До конца дня 10 нужны 8 гвоздик и 8 хризантем.':'Приём цветов открыт до конца дня 10.';
  return `<h2>Просьбы и ярмарка</h2><h3>Срочные просьбы · занято ${s.events.requests.filter(r=>r.status==='active').length} / ${eventSlots(s.access)}</h3><p class="small">Две разные просьбы за сезон. Отказ и просрочка не снижают репутацию. Запас общий с основными заказами.</p>
    <div class="orders-list">${requests.length?requests.map(r=>{
      const card=r.card,active=r.status==='active';
      return `<article class="order-card"><h3>${urgentName(r.template)}</h3>${r.status==='waiting'?'<p>Ожидает: место занято или план пока не найден. Срок начнётся при появлении карточки.</p>':card?`<p>До конца дня ${card.deadline} · появилась в день ${card.appeared}</p><p>${card.ingredients.map(i=>`${flowerName(i.kind)}: <strong>${s.garden.stock[i.kind as PlantKind]} / ${i.count}</strong>`).join('<br>')}</p><p class="small">${card.coins} монет · ${card.experience} опыта${r.template==='U3'?' · выбор улучшения':''}</p>${['offer','active'].includes(r.status)?`${urgentRisk(state,r.id)?'<p class="warning">Риск конкуренции: совместный план с обязательными целями не найден. Просьбу можно принять на свой риск.</p>':''}${active?button(`urgent-submit-${r.id}`,'Сдать просьбу',true,!hasStock(state,card.ingredients)):button(`urgent-accept-${r.id}`,'Принять просьбу',true,s.events.requests.filter(x=>x.status==='active').length>=eventSlots(s.access))}`:`<p><strong>${r.status==='done'?'Выполнено':r.status==='expired'?'Срок истёк · без штрафа':'Закрыта'}</strong></p>`}`:'<p>Закрыта.</p>'}</article>`;
    }).join(''):'<p>Пока нет просьб.</p>'}</div>
    <h3>Районная ярмарка</h3><article class="order-card"><p>${fairCard}</p>${s.day>=3?`<p class="small">Минимум: 8 гвоздик + 8 хризантем → 48 монет, 16 опыта. Пропуск минимума: −1 репутация в конце дня 10.</p><p class="small">Затем дополнительно: 6 + 6 → 36 монет, 12 опыта и улучшение. За пропуск допцели штрафа нет. Финальная победа закрывает будущие цели ярмарки.</p>`:''}${s.day>=6&&!fair.closed?`<p>Гвоздики: <strong>${s.garden.stock.carnation}</strong> · Хризантемы: <strong>${s.garden.stock.chrysanthemum}</strong></p>${fair.minimum?'<p>Минимум выполнен ✓</p>':button('fair-minimum','Сдать минимум',true,!hasStock(state,fairIngredients(false)))}${fair.minimum&&!fair.bonus?button('fair-bonus','Сдать дополнительную цель',true,!hasStock(state,fairIngredients(true))):fair.bonus?'<p>Дополнительная цель выполнена ✓</p>':''}`:''}</article>
    <h3>История мастерской</h3><div class="orders-list">${['Первый основной заказ → «Подпорка у устройства» (P5)','Три основных и одна срочная просьба → «Парная установка» (E3)','После предыдущих шагов: одна победа → «Двойной уход» (E4)'].map((text,i)=>`<article class="order-card"><p>${steps[i]?'✓ Открыто':'В процессе'} · ${text}</p></article>`).join('')}</div><p class="small">За всё время: основных ${progress.main}, просьб ${progress.urgent}, побед ${progress.wins}. Открытия сохраняются при поражении и добавляют варианты в будущие выборы; сами эффекты не выдаются.</p>
    <div class="actions">${button('orders','К заказам')}${button('continue','К полю')}</div>`;
}
export function modulesMarkup(state:GameState,selectedModule:number|null=null):string {
  const s=state.season!,fx=s.effects,module=fx.modules.find(m=>m.id===selectedModule);
  return `<h2>${module?'Установить модуль':'Сезонные улучшения'}</h2>${module?`<p><strong>${effectDefinition(module.effect).name}</strong></p><p>${effectDefinition(module.effect).text}</p><p class="small">Один слот на объект. Снятие возвращает модуль в запас. Перенос следует за объектом; установка не вызывает адаптацию.</p><div class="orders-list">${s.layout.objects.filter(o=>compatible(module.effect,o.kind)).map(o=>`<button data-action="attach-${o.q},${o.r}" data-unavailable="${fx.modules.some(m=>m.id!==module.id&&m.at&&m.at.q===o.q&&m.at.r===o.r)}">${objectName(o.kind)} · клетка ${o.q}, ${o.r}${fx.modules.some(m=>m.id!==module.id&&m.at&&m.at.q===o.q&&m.at.r===o.r)?' · слот занят':''}</button>`).join('')||'<p>Сначала разместите подходящее растение или устройство.</p>'}</div>`:`<p class="small">До конца сезона. Эффекты вида применяются сразу; модули нужно установить на один объект. Всё можно найти здесь после перезагрузки.</p><h3>Эффекты вида</h3><div class="orders-list">${fx.globals.map(e=>`<article class="order-card"><h3>${effectDefinition(e.effect).name}</h3><p>${objectName(e.target!)} · ${effectDefinition(e.effect).text}</p></article>`).join('')||'<p>Пока нет.</p>'}</div><h3>Модули · один слот</h3><div class="orders-list">${fx.modules.map(m=>`<article class="order-card"><h3>${effectDefinition(m.effect).name}</h3><p>${effectDefinition(m.effect).text}</p><p>${m.at?`Установлен · клетка ${m.at.q}, ${m.at.r}`:'В запасе'}</p>${button(`module-${m.id}`,m.at?'Переставить':'Установить',true)}${m.at?button(`detach-${m.id}`,'Снять в запас'):''}</article>`).join('')||'<p>Пока нет.</p>'}</div>`}<div class="actions">${module?button('modules','Назад к улучшениям'):button('orders','К заказам')}${button('continue','К полю')}</div>`;
}

export function objectModulesMarkup(state: GameState, object: PlacedObject): string {
  const season = state.season!, current = moduleAt(season.effects, object);
  const choices = season.effects.modules.filter(m => m.id !== current?.id && compatible(m.effect, object.kind));
  const installed = current ? `<article class="order-card"><h3>${effectDefinition(current.effect).name}</h3><p>${effectDefinition(current.effect).text}</p><p class="small">Установлен здесь · №${current.id}</p>${button('object-detach','Снять в запас')}</article>` : '<p>Слот свободен.</p>';
  const options = choices.map(module => {
    const source = module.at && season.layout.objects.find(o => o.q === module.at!.q && o.r === module.at!.r);
    const location = source ? `${objectName(source.kind)} · клетка ${source.q}, ${source.r}. После перестановки прежний объект останется без модуля.` : 'В запасе.';
    return `<article class="order-card"><h3>${effectDefinition(module.effect).name}</h3><p>${effectDefinition(module.effect).text}</p><p class="small">№${module.id} · ${location}</p>${button(`object-module-${module.id}`,source?'Переставить сюда':'Установить сюда',true,!!current)}</article>`;
  }).join('');
  return `<h2>Модуль: ${objectName(object.kind)}</h2><p class="small">Клетка ${object.q}, ${object.r} · Один слот на объект. Эффекты вида действуют автоматически.</p>${installed}${current&&choices.length?'<p class="small">Чтобы установить другой модуль, сначала снимите текущий в запас.</p>':''}<div class="orders-list">${options||'<p>Других подходящих модулей пока нет. Модули получают при выборе сезонного улучшения.</p>'}</div><div class="actions">${button('object','Назад к объекту')}${button('continue','К полю')}</div>`;
}

export function resultMarkup(state: GameState): string {
  const s = state.season!, r = s.board.result!;
  const reason = { final: 'Финальная композиция сдана.', reputation: 'Репутация опустилась до нуля.', calendar: 'День 20 завершён без финальной композиции.', surrender: 'Сезон завершён добровольно.' }[r.reason];
  return `<h2>${r.outcome === 'win' ? 'Сезон завершён: победа' : 'Сезон завершён: поражение'}</h2><p>${reason}</p>
    <div class="season-result"><p>Доход сезона: <strong>${r.income}</strong> монет.</p><p>Потеря: <strong>${r.lost}</strong> монет.</p>
    <p>Зачислено: <strong>${r.credited}</strong> монет.</p><p>Опыт сезона: <strong>${r.experience}</strong>.</p>
    <p>Всего: <strong>${state.profile.coins}</strong> монет · <strong>${state.profile.experience}</strong> опыта.</p></div>
    ${progressionMarkup(state,state.profile.experience-r.experience)}<p class="small">Итог уже сохранён. Повторное открытие и перезагрузка ничего не начисляют.</p>
    <div class="actions">${button('shop','Развитие мастерской',true)}${button('start', 'Начать новый сезон')}${button('menu', 'В мастерскую')}</div>`;
}
