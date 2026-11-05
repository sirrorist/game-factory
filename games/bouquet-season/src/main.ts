import { purchase, fieldSize, availableKind, openFlowers, accessLevel, type PurchaseId } from './core/shop.ts';
import { shopMarkup } from './shop-ui.ts';
import { recordTutorial, tutorialTip } from './core/tutorial.ts';
import { GameFactory, type Session } from '@gf/game-sdk';
import * as Phaser from 'phaser';
import { newProfile, startSeason, changeSettings, editLayout, harvest, installModule, type GameState } from './core/state.ts';
import { CATALOG, objectName, isPlant, waterPlant, type ObjectKind, type LayoutCommand } from './core/layout.ts';
import { sameCell, type Cell } from './core/field.ts';
import { plantConditions } from './core/conditions.ts';
import { livingObjects } from './core/growth.ts';
import { readCopies, SaveSession, type Copy } from './core/saves.ts';
import { WorkshopScene, type FieldTool } from './scene.ts';
import { Drawer } from './drawer.ts';
import { Notices } from './notices.ts';
import { bindTouchButtons } from './touch-buttons.ts';
import { acceptOrder, submitOrder, closeDay, surrenderSeason, harvestAll, chooseReward, acceptUrgent, submitUrgent, submitFair, fairIngredients, spendingRisk, type SpendingRisk } from './core/calendar.ts';
import { boardMarkup, pendingMarkup, resultMarkup, eventsMarkup, modulesMarkup, objectModulesMarkup } from './order-ui.ts';
import { effectDefinition, moduleAt, hasGlobal, type EffectsState } from './core/effects.ts';
import { flowerName, type Ingredient } from './core/orders.ts';
import './style.css';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const button = (action: string, text: string, style = ''): string => `<button data-action="${action}" class="${style}">${text}</button>`;
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const careDescription=(kind:ObjectKind,fx:EffectsState):string=>isPlant(kind)&&hasGlobal(fx,'P1',kind)?waterPlant(kind)?'Нужен свет · полив ускоряет рост':'Нужен полив · свет ускоряет рост':CATALOG.find(c=>c.kind===kind)!.care;

async function main(): Promise<void> {
  bindTouchButtons($('app'));
  let sdk: Session;
  let saves: SaveSession | null = null;
  let copies: { current: Copy; previous: Copy };
  let screenName: 'menu' | 'settings' | 'workshop' | 'recovery' | 'restore-confirm' | 'reset-confirm' | 'catalog' | 'object' | 'object-modules' | 'remove-confirm' | 'orders' | 'pending' | 'result' | 'surrender-confirm' | 'events' | 'modules' | 'spend-confirm' | 'shop' | 'tutorial' = 'menu';
  let selectedModule:number|null=null;
  let spending:{kind:'main'|'urgent'|'fair';id:number;bonus?:boolean;risks:SpendingRisk[]}|null=null;
  let fieldTool: FieldTool = null;
  let selected: Cell | null = null;
  let catalogTarget: Cell | null = null;
  let working = true;
  let touch = matchMedia('(pointer: coarse)').matches;
  let fps = 0;
  let objects = 0;
  let scene: WorkshopScene | undefined;
  const notices = new Notices($('notice'));
  const drawer = new Drawer({
    reducedMotion: () => !!saves?.state.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
    dismiss: () => {
      if (working) return;
      if (canDismiss()) { drawer.setOpen(false); return; }
      if (screenName === 'restore-confirm' || screenName === 'reset-confirm') void action('recovery');
    },
    onBlockingChange: () => { syncInput(); dockNotices(); },
  });
  const coarse = matchMedia('(pointer: coarse)');
  coarse.addEventListener('change', event => { touch ||= event.matches; });
  document.addEventListener('pointerdown', event => { touch ||= event.pointerType === 'touch'; }, { passive: true });

  function canDismiss(): boolean {
    if (!sdk || !copies || working || saves?.hasPending || !sdk.persistent) return false;
    if (saves?.state.season?.board.pending || saves?.state.season?.board.result) return false;
    return copies.current.status === 'valid' || (saves?.savedRevision ?? 0) > 0
      || (copies.current.status === 'missing' && copies.previous.status === 'missing');
  }
  function syncInput(): void {
    const run = saves?.state.season;
    const blocked = drawer.blocking || working || !!saves?.hasPending || !!run?.board.pending || !!run?.board.result;
    $('world').dataset.inputPaused = String(blocked);
    scene?.setInputBlocked(blocked);
    for(const b of $('field-tools').querySelectorAll<HTMLButtonElement>('button')) b.disabled=blocked || !run || (b.id==='next-day-button'&&!run.board.active.length) || (b.id==='undo-button'&&!run.layout.undo);
  }
  function showWorkshop(): void {
    const s = saves?.state.season;
    screenName = s?.board.result ? 'result' : s?.board.pending ? 'pending' : s ? 'workshop' : 'menu';
    drawer.setOpen(!s || !!s.board.result || !!s.board.pending || !!saves?.hasPending);
  }

  function notify(message: string): void {
    notices.push(message);
  }
  function dockNotices(): void {
    const parent = drawer.blocking ? $('panel-body').querySelector<HTMLElement>('.panel-content') ?? $('panel-body') : $('app');
    notices.dock(parent, drawer.blocking);
  }
  function debug(): void {
    if (!sdk) return;
    $('debug').textContent = `FPS: ${fps.toFixed(1)} · Canvas 2D\nВызовы: н/д · Треугольники: неприменимо\nОбъектов сцены: ${objects} · DPR: 1\nВвод: ${touch ? 'касания' : 'мышь / клавиатура'}\nSDK: ${sdk.mode} · persistent: ${sdk.persistent}\nЗапись: ${saves?.savedRevision ?? 0} · ${saves?.hasPending ? 'ожидает повтора' : 'нет ожидающей записи'}`;
  }
  function render(): void {
    const state = saves?.state;
    const currentOK = copies.current.status === 'valid' || (saves?.savedRevision ?? 0) > 0;
    const damaged = !currentOK && !(copies.current.status === 'missing' && copies.previous.status === 'missing');
    const backup = saves?.backup ?? (copies.previous.status === 'valid' ? copies.previous.record : null);
    const paused = !!saves?.hasPending;
    const controlsText=touch
      ? 'Выберите объект в каталоге и коснитесь клетки. Перенос — одним пальцем или через карточку объекта. Камера — двумя пальцами. «Всё поле» возвращает обзор.'
      : 'ЛКМ — выбор и перенос объектов. ПКМ — отмена посадки/переноса; по пустой клетке — каталог для неё. Колесо — масштаб; средняя кнопка, WASD или стрелки — перемещение камеры. «Всё поле» возвращает обзор.';
    const selectedObject=state?.season?.layout.objects.find(o=>selected&&sameCell(o,selected));
    $('world').classList.toggle('in-season',!!state?.season);
    $('field-tools').hidden=!state?.season;
    $('scene-caption').hidden=!!state?.season;
    const run = state?.season, active = run?.board.active[0];
    $('placement-status').textContent=fieldTool ? ('kind'in fieldTool ? `${objectName(fieldTool.kind)} · выберите клетку` : 'Перенос · выберите свободную клетку') : active ? `${active.stage===6?'Финал':`Заказ ${active.stage} / 5`} · до конца дня ${active.deadline} · репутация ${run!.reputation} / 3` : 'Выберите основной заказ на доске';
    $('orders-button').classList.toggle('primary',!!run && !active);
    $('next-day-button').textContent=run?.day===20?'Конец дня 20':'Следующий день';
    $('next-day-button').title=active?'Завершить текущий день: сначала сроки, затем рост следующего дня':'Для перехода дня нужен активный основной заказ';
    const stock=state?.season?.garden.stock;
    $('stock-status').textContent=stock&&run?`Срезано · ${openFlowers(run.access).map(k=>`${flowerName(k)}: ${stock[k]}`).join(' · ')}`:'';
    const tip=state&&tutorialTip(state);
    $('tutorial-button').hidden=!tip;
    $('tutorial-button').title=tip?.title??'';
    $('cancel-placement').hidden=!fieldTool;
    $('catalog-button').hidden=!!fieldTool;
    scene?.setState(state??null,fieldTool);
    let html = '';
    if (paused) {
      html = `<h2>Прогресс в памяти</h2><p class="warning">Запись не завершена. Новые действия приостановлены. Не закрывайте эту вкладку.</p><p>${escape(saves?.error ?? 'Сохраняем…')}</p><div class="actions">${button('retry-save', 'Повторить сохранение', 'primary')}</div>`;
    } else if (!sdk.persistent) {
      html = `<h2>Нужно постоянное хранение</h2><p class="warning">Сейчас прогресс исчезнет после закрытия вкладки. Начало сезона недоступно.</p><p>Разрешите браузеру сохранять данные и повторите проверку.</p><div class="actions">${button('recheck', 'Проверить ещё раз', 'primary')}${button('recovery', 'Восстановление')}</div>`;
      if (screenName === 'recovery') html += '<p>Восстановление станет доступно после успешной проверки постоянного хранения.</p>';
    } else if (screenName === 'reset-confirm') {
      html = `<h2>Создать новый профиль?</h2><p class="warning">Текущий прогресс будет заменён пустым профилем. Старую основную запись восстановить не получится.</p><div class="actions">${button('reset', 'Подтверждаю замену профиля', 'danger')}${button('recovery', 'Отмена')}</div>`;
    } else if (screenName === 'restore-confirm' && backup) {
      html = `<h2>Восстановить копию?</h2><p>Будет восстановлен весь профиль на ${escape(new Date(backup.savedAt).toLocaleString('ru-RU'))}, запись №${backup.revision}. Более поздние действия потеряются. Деньги и награды не суммируются.</p><div class="actions">${button('restore', 'Подтверждаю восстановление', 'primary')}${button('recovery', 'Отмена')}</div>`;
    } else if (screenName === 'recovery' || damaged) {
      html = `<h2>Восстановление</h2><p>${damaged ? 'Основная запись не читается. Данные оставлены на месте.' : 'Можно вернуться к предыдущей корректной записи.'}</p><p>${backup ? `Предыдущая копия: №${backup.revision}, ${escape(new Date(backup.savedAt).toLocaleString('ru-RU'))}.` : 'Исправная предыдущая копия не найдена.'}</p><div class="actions">${backup ? button('restore-confirm', 'Выбрать копию') : ''}${button('recheck', 'Повторить проверку')}${damaged ? button('reset-confirm', 'Создать новый профиль', 'danger') : button('menu', 'Назад')}</div>`;
    } else if(screenName==='shop'&&state){html=shopMarkup(state);
    } else if(screenName==='tutorial'&&state){
      html=`<h2>Подсказка: ${tip?.title??'Первые шаги завершены'}</h2><p>${tip?.text??'Можно продолжать сезон. Подсказки не меняют заказ и не выдают награды.'}</p><div class="actions">${tip?button(tip.action,tip.label,'primary'):button('continue','К полю')}${button('skip-tutorial','Пропустить обучение')}${button('continue','Вернуться к полю')}</div>`;
    } else if (screenName === 'orders' && state?.season) {
      html = boardMarkup(state);
    } else if(screenName==='events'&&state?.season){html=eventsMarkup(state);
    } else if(screenName==='modules'&&state?.season){html=modulesMarkup(state,selectedModule);
    } else if(screenName==='spend-confirm'&&spending){
      html=`<h2>Потратить общий запас?</h2><p class="warning">После этой сдачи другая уже готовая обязательная цель потеряет готовность.</p>${spending.risks.map(r=>`<p><strong>${r.name}</strong><br>Будет не хватать: ${r.missing.map(i=>`${flowerName(i.kind)} — ${i.count}`).join(', ')}.</p>`).join('')}<div class="actions">${button('confirm-spend','Да, сдать и потратить цветы','danger')}${button('cancel-spend','Отмена')}</div>`;
    } else if (screenName === 'pending' && state?.season?.board.pending) {
      html = pendingMarkup(state);
    } else if (screenName === 'result' && state?.season?.board.result) {
      html = resultMarkup(state);
    } else if (screenName === 'surrender-confirm' && state?.season) {
      html = `<h2>Закончить сезон поражением?</h2><p>Будет потеряно 25% дохода этого сезона с округлением вниз. Старые накопления и весь опыт сохранятся. Вернуться к этому сезону будет нельзя.</p><div class="actions">${button('surrender','Подтвердить поражение','danger')}${button('orders','Назад к заказам')}</div>`;
    } else if (screenName === 'catalog' && state?.season) {
      html = `<h2>Каталог</h2><p class="small catalog-note">${catalogTarget?'Выберите предмет: он будет поставлен на выбранную клетку.':'Размещение бесплатно. Растения и устройства занимают по клетке.'}</p><div class="catalog-grid">${CATALOG.filter(c=>availableKind(state.season!.access,c.kind)).map(c=>`<button data-action="pick-${c.kind}"><strong>${c.name}</strong><span>${careDescription(c.kind,state.season!.effects)}</span></button>`).join('')}</div><div class="actions">${button('continue','Вернуться к полю')}</div>`;
    } else if (screenName === 'remove-confirm' && selectedObject) {
      html = `<h2>Удалить растение?</h2><p class="warning">${objectName(selectedObject.kind)} будет убрана с участка. Прогресс растения потеряется. Последнее изменение можно отменить.</p><div class="actions">${button('remove','Удалить растение','danger')}${button('object','Отмена')}</div>`;
    } else if (screenName === 'object-modules' && state?.season && selectedObject) {
      html = objectModulesMarkup(state, selectedObject);
    } else if (screenName === 'object' && selectedObject) {
      const plant=isPlant(selectedObject.kind);
      const season=state!.season!,crop=season.garden.plants.find(p=>sameCell(p,selectedObject));
      const conditions=plantConditions(livingObjects(season.layout.objects,season.garden.plants),selectedObject,season.effects,fieldSize(season.access));
      const status=conditions?`<p class="small plant-conditions">☀ Свет: ${conditions.light?'есть':'нет'} · 💧 Полив: ${conditions.water?'есть':'нет'}<br>Значки у горшка показывают действующие условия.</p>`:'';
      const phase=crop?.wilt===3?'Погибло':crop?.yield?`Готово к срезке: ${crop.yield} цветка`:crop?.growth?'Растёт':'Начало цикла';
      const health=crop?.wilt===3?'Растение не восстановится. Удалите его, чтобы посадить новое.':crop?.wilt?`Увядание: ${crop.wilt} из 3 плохих дней. Исправьте обязательный уход; восстановление займёт 1 день.`:selectedObject.adaptation?'Адаптация · 1 день без роста. После пересадки прогресс сохранён.':crop?.recovering?'Восстановление · день без роста. Цикл сохранён.':'Пересадка пропустит один день роста.';
      const swapped=plant&&hasGlobal(season.effects,'P1',selectedObject.kind),mod=moduleAt(season.effects,selectedObject);
      const effectInfo=`${swapped?'<p class="small">Предпочтения изменены: обязательный и дополнительный уход поменялись местами.</p>':''}<article class="order-card"><h3>Сезонный модуль</h3><p class="small">${mod?`Модуль: <strong>${effectDefinition(mod.effect).name}</strong>.`:'Модуль: свободный слот.'}</p>${button('object-modules',mod?'Управлять модулем':'Установить модуль')}</article>`;
      const details=crop?`<div class="plant-info"><p class="small">${careDescription(selectedObject.kind,season.effects)}.</p><p class="small plant-growth"><strong>${phase}</strong><br>Рост: ${crop.growth/2} / 4 · Дней роста: ${crop.growthDays}<br>${crop.wilt===3?'Урожай потерян. Срезка недоступна.':crop.yield?'Урожай уже зафиксирован.':`Срезка: 2 цветка${crop.bonus?' + 1 за другой вид весь цикл':crop.supportBonus?' + 1 возможен с подпоркой и устройством весь цикл':'; бонус урожая в этом цикле потерян'}.`}</p><p class="small plant-health">${health}</p>${status}</div>`:`<p>Зона показана при наведении и переносе; улучшения могут менять её. Устройства передают условия растениям. Парная установка заимствует только собственную зону соседа, без цепочек.</p>`;
      const cut=crop?`<button data-action="harvest" class="primary" data-unavailable="${crop.yield===0||crop.wilt===3}">${crop.yield?`Срезать: ${crop.yield}`:crop.wilt===3?'Нет урожая':'Пока не готово'}</button>`:'';
      html = `<h2>${objectName(selectedObject.kind)}</h2> <div class="object-details">${details}<div class="object-module-summary">${effectInfo}</div></div><div class="actions">${cut}${button('move-object','Переместить')}${button(plant?'remove-confirm':'remove',plant?'Удалить растение':'Убрать устройство','danger')}${button('continue','Назад к полю')}</div>`;
    } else if (screenName === 'settings') {
      html = `<h2>Настройки</h2><label><input id="tutorial" type="checkbox" ${state?.settings.tutorial ? 'checked' : ''}>Показывать обучение</label><label><input id="motion" type="checkbox" ${state?.settings.reducedMotion ? 'checked' : ''}>Сокращать переходы</label><p class="small settings-note">Подсказки ведут через первый настоящий заказ. Их можно пропустить в любой момент. Повторное включение покажет только ещё нужные шаги. Настройки сохраняются.</p><div class="actions">${button('menu', 'Назад')}</div>`;
    } else if (screenName === 'workshop' && state?.season) {
      html = `<span class="eyebrow">СЕЗОН ${state.season.number}</span><h2>День ${state.season.day} · ${state.season.day===1?'Подготовка':'Выращивание'}</h2><div class="stats"><span><strong>${state.season.reputation} / 3</strong>Репутация</span><span><strong>${state.season.layout.objects.length} / ${fieldSize(state.season.access)}</strong>Занято клеток</span></div><p>Прогресс растений и срезанные цветы сохраняются. Для смены дня нужен активный основной заказ.</p><p class="small">${touch?'Выберите объект в каталоге и коснитесь клетки. Перенос — одним пальцем; камера — двумя.':'Выберите объект и нажмите клетку. Перенос — левой кнопкой; камера — колёсиком, средней кнопкой, WASD или стрелками.'}</p><div class="actions">${button('orders','Доска заказов')}${button('catalog','Каталог')}${button('modules','Сезонные улучшения')}${button('events','Просьбы и ярмарка')}${button('shop','Развитие мастерской')}${tip?button('tutorial','Подсказка'):''}${button('menu', 'Меню и настройки')}</div>`;
    } else {
      html = `<span class="eyebrow">ДОБРО ПОЖАЛОВАТЬ</span><h2>Ваша мастерская</h2><p class="menu-intro">Постепенно вырастите небольшую оранжерею в мастерскую букетов.</p><div class="stats"><span><strong>${state?.profile.coins ?? 0}</strong>Монеты</span><span><strong>${state?.profile.experience ?? 0}</strong>Опыт</span></div><p class="small">Уровень ${accessLevel(state?.profile.experience??0)} · покупки открываются за опыт и монеты.</p><p class="small controls-help"><strong>Управление</strong><br>${controlsText}</p><div class="actions menu-actions">${button(!state?.season||run?.board.result ? 'start' : 'continue', run?.board.result ? 'Начать новый сезон' : state?.season ? 'Продолжить сезон' : 'Начать сезон', 'primary')}${run?.board.result?button('result','Итоги сезона'):''}${button('shop','Развитие мастерской')}${button('settings', 'Настройки')}${button('fullscreen', 'На весь экран')}${button('recovery', 'Восстановление')}</div>`;
    }
    const focused = document.activeElement instanceof HTMLInputElement ? document.activeElement.id : '';
    $('panel-body').innerHTML = html;
    const actions = $('panel-body').querySelector('.actions');
    const content = document.createElement('div');
    content.className = 'panel-content';
    while ($('panel-body').firstChild) content.append($('panel-body').firstChild!);
    const heading = document.createElement('div');
    heading.className = 'panel-heading';
    for (const element of content.querySelectorAll(':scope > .eyebrow, :scope > h2')) heading.append(element);
    heading.querySelector('h2')!.id = 'panel-title';
    $('panel-body').append(heading, content);
    if (actions) $('panel-body').append(actions);
    dockNotices();
    $('panel').dataset.screen = paused ? 'save-error' : screenName;
    for (const element of $('panel').querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) element.disabled = working || element.dataset.unavailable==='true';
    ($('menu-button') as HTMLButtonElement).disabled = working || paused;
    ($('debug-button') as HTMLButtonElement).disabled = false;
    ($('drawer-debug') as HTMLButtonElement).disabled = false;
    $('season-status').textContent = state?.season ? `День ${state.season.day} · ${state.season.day===1?'Подготовка':'Выращивание'} · ${state.season.layout.objects.length} / ${fieldSize(state.season.access)}` : 'Мастерская · Между сезонами';
    $('storage-status').textContent = `${sdk.mode === 'hub' ? 'Game Factory' : 'Самостоятельный запуск'} · ${sdk.persistent ? 'постоянное хранение' : 'хранение недоступно'}${saves?.savedRevision ? ` · запись №${saves.savedRevision}` : ''}`;
    $('app').setAttribute('aria-busy', String(working));
    if (paused || !sdk.persistent || damaged) drawer.setOpen(true);
    drawer.refresh(canDismiss());
    if (focused && drawer.blocking) document.getElementById(focused)?.focus({ preventScroll: true });
    syncInput();
    debug();
  }
  async function refreshStorage(): Promise<Session> {
    // При таймауте повторного hello SDK мог бы перейти из hub в standalone и скрыть откат.
    if (sdk?.mode === 'hub') return sdk;
    const candidate = await GameFactory.init({ gameId: __GF_GAME_ID__ });
    if (sdk && (candidate.mode !== sdk.mode || candidate.gameId !== sdk.gameId)) {
      throw new Error('Исходное хранилище не подтверждено. Данные оставлены на месте.');
    }
    return candidate;
  }
  async function load(): Promise<void> {
    fieldTool=null;selected=null;catalogTarget=null;spending=null;selectedModule=null;
    sdk = await refreshStorage();
    copies = await readCopies(sdk);
    saves = copies.current.status === 'valid'
      ? new SaveSession(sdk, copies.current.state, copies.current.record, copies.previous.status === 'valid' ? copies.previous.record : null)
      : copies.current.status === 'missing' && copies.previous.status === 'missing'
        ? new SaveSession(sdk, newProfile(), null, null) : null;
    const run = saves?.state.season;
    screenName = run?.board.result ? 'result' : run?.board.pending ? 'pending' : run ? 'workshop' : 'menu';
    drawer.setOpen(!run || !!run.board.result || !!run.board.pending, !!scene);
  }
  async function persist(transition: (state: GameState) => GameState): Promise<void> {
    await saves?.act(state=>recordTutorial(transition(state)));
  }
  async function boardEdit(command: LayoutCommand): Promise<void> {
    if(working || drawer.blocking || !saves || saves.blocked)return;
    try {
      const next=editLayout(saves.state,command);
      if(next===saves.state)return;
      working=true;screenName='workshop';render();
      await persist(()=>next);
      if(command.type!=='place')fieldTool=null;
    }catch(error){notify(error instanceof Error?error.message:'Изменение не завершено.');}
    finally{working=false;render();}
  }
  function fieldTap(cell:Cell): void {
    if(working || drawer.blocking || !saves || saves.blocked)return;
    if(fieldTool&&'from'in fieldTool){void boardEdit({type:'move',from:fieldTool.from,to:cell});return;}
    const object=saves.state.season?.layout.objects.find(o=>sameCell(o,cell));
    if(object){selected=cell;fieldTool=null;screenName='object';drawer.setOpen(true);render();}
    else if(fieldTool&&'kind'in fieldTool)void boardEdit({type:'place',kind:fieldTool.kind,to:cell});
    else notify('Выберите растение или устройство в каталоге.');
  }
  function cancelPlacement(): void {
    if(working || drawer.blocking || saves?.blocked)return;
    fieldTool=null;scene?.cancelGesture();render();
  }
  function fieldContext(cell:Cell|null,cancelDrag:boolean): void {
    if(working || drawer.blocking || !saves || saves.blocked)return;
    if(fieldTool){cancelPlacement();return;}
    if(cancelDrag)return;
    if(!cell || saves.state.season?.layout.objects.some(o=>sameCell(o,cell)))return;
    catalogTarget=cell;screenName='catalog';drawer.setOpen(true);render();
  }
  async function deliver(kind:'main'|'urgent'|'fair',id:number,bonus=false,confirmed=false):Promise<void>{
    const state=saves!.state,s=state.season!;
    const card=kind==='main'?s.board.active.find(o=>o.id===id):kind==='urgent'?s.events.requests.find(r=>r.id===id)?.card:null;
    const ingredients:Ingredient[]=kind==='fair'?fairIngredients(bonus):card?.ingredients??[];
    const exclude=kind==='urgent'?card!.id:kind==='fair'?(bonus?20001:20000):id;
    const risks=spendingRisk(state,ingredients,exclude);
    if(!confirmed&&risks.length){spending={kind,id,bonus,risks};screenName='spend-confirm';return;}
    await persist(value=>kind==='main'?submitOrder(value,id,confirmed):kind==='urgent'?submitUrgent(value,id,confirmed):submitFair(value,bonus,confirmed));
    if(!saves?.hasPending)spending=null;
    if(saves?.state.season?.board.pending||saves?.state.season?.board.result)showWorkshop();
    else {screenName=kind==='main'?'orders':'events';drawer.setOpen(true);}
  }
  async function action(name: string): Promise<void> {
    if (working) return;
    working = true;
    render();
    try {
      if (name === 'retry-save') {
        const candidate = await refreshStorage();
        saves?.rebind(candidate);
        sdk = candidate;
        if (await saves?.retry()) {
          if (screenName === 'restore-confirm' || screenName === 'workshop') showWorkshop();
        }
      } else if (saves?.hasPending) return;
      else if (name === 'recheck') await load();
      else if (name === 'recovery') screenName = 'recovery';
      else if (name === 'fullscreen') {
        if (document.fullscreenElement) {
          screen.orientation?.unlock();
          await document.exitFullscreen();
        } else if (window.innerWidth >= window.screen.width - 2 && window.innerHeight >= window.screen.height - 2) {
          notify('Полный экран уже включён хабом или браузером. Для выхода используйте «Назад» или Esc.');
        } else {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
          if (touch) await (window.screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> }).lock?.('landscape').catch(() => undefined);
        }
      } else if (!sdk.persistent) return;
      else if(name==='next-day'){fieldTool=null;selected=null;await persist(closeDay);showWorkshop();}
      else if(name==='orders'){fieldTool=null;selected=null;screenName='orders';drawer.setOpen(true);}
      else if(name==='shop'){fieldTool=null;screenName='shop';drawer.setOpen(true);}
      else if(name.startsWith('buy-')){await persist(state=>purchase(state,name.slice(4) as PurchaseId));screenName='shop';}
      else if(name==='tutorial'){screenName='tutorial';drawer.setOpen(true);}
      else if(name==='skip-tutorial'){await persist(state=>changeSettings(state,{tutorial:false}));showWorkshop();}
      else if(name==='events'){fieldTool=null;screenName='events';drawer.setOpen(true);}
      else if(name==='modules'){selectedModule=null;screenName='modules';drawer.setOpen(true);}
      else if(name.startsWith('module-')){selectedModule=Number(name.slice(7));screenName='modules';}
      else if(name.startsWith('attach-')&&selectedModule!==null){const [q,r]=name.slice(7).split(',').map(Number);await persist(state=>installModule(state,selectedModule!,{q:q!,r:r!}));selectedModule=null;}
      else if(name.startsWith('detach-'))await persist(state=>installModule(state,Number(name.slice(7)),null));
      else if(name.startsWith('reward-')){await persist(state=>chooseReward(state,Number(name.slice(7))));showWorkshop();}
      else if(name.startsWith('urgent-accept-')){await persist(state=>acceptUrgent(state,Number(name.slice(14))));screenName='events';}
      else if(name.startsWith('urgent-submit-'))await deliver('urgent',Number(name.slice(14)));
      else if(name==='fair-minimum'||name==='fair-bonus')await deliver('fair',20000,name==='fair-bonus');
      else if(name==='confirm-spend'&&spending)await deliver(spending.kind,spending.id,!!spending.bonus,true);
      else if(name==='cancel-spend'){screenName=spending?.kind==='main'?'orders':'events';spending=null;}
      else if(name==='result')screenName='result';
      else if(name.startsWith('accept-')){await persist(state=>acceptOrder(state,Number(name.slice(7))));showWorkshop();}
      else if(name.startsWith('deliver-'))await deliver('main',Number(name.slice(8)));
      else if(name==='harvest-all')await persist(harvestAll);
      else if(name==='surrender-confirm')screenName='surrender-confirm';
      else if(name==='surrender'){await persist(surrenderSeason);showWorkshop();}
      else if(name==='harvest' && selected)await persist(state=>harvest(state,selected!));
      else if(name==='catalog' && saves?.state.season){fieldTool=null;catalogTarget=null;screenName='catalog';drawer.setOpen(true);}
      else if(name.startsWith('pick-') && saves?.state.season){
        const item=CATALOG.find(c=>`pick-${c.kind}`===name);
        if(item){
          if(catalogTarget){
            const to=catalogTarget;catalogTarget=null;
            await persist(state=>editLayout(state,{type:'place',kind:item.kind,to}));
            fieldTool=null;showWorkshop();
          }else{fieldTool={kind:item.kind};screenName='workshop';drawer.setOpen(false);}
        }
      }else if(name==='move-object' && selected){fieldTool={from:selected};screenName='workshop';drawer.setOpen(false);}
      else if(name==='object')screenName='object';
      else if(name==='object-modules'&&selected)screenName='object-modules';
      else if(name.startsWith('object-module-')&&selected){
        await persist(state=>installModule(state,Number(name.slice(14)),selected!));screenName='object';
      }
      else if(name==='object-detach'&&selected){
        const module=saves&&moduleAt(saves.state.season!.effects,selected);
        if(module)await persist(state=>installModule(state,module.id,null));
      }
      else if(name==='remove-confirm')screenName='remove-confirm';
      else if(name==='remove' && selected){
        const object=saves?.state.season?.layout.objects.find(o=>sameCell(o,selected!));
        if(object && (!isPlant(object.kind)||screenName==='remove-confirm')){
          await persist(s=>editLayout(s,{type:'remove',from:selected!}));selected=null;fieldTool=null;showWorkshop();
        }
      }
      else if (name === 'restore-confirm' || name === 'reset-confirm') screenName = name;
      else if (name === 'restore') {
        fieldTool=null;selected=null;
        if (!saves && copies.previous.status === 'valid') saves = new SaveSession(sdk, copies.previous.state, null, copies.previous.record);
        if (saves && await saves.restore()) showWorkshop();
      } else if (name === 'reset') {
        fieldTool=null;selected=null;
        saves = new SaveSession(sdk, newProfile(), null, copies.previous.status === 'valid' ? copies.previous.record : null);
        await persist(() => newProfile());
        screenName = 'menu';
        drawer.setOpen(true);
      } else if (name === 'start') {
        const seed = crypto.getRandomValues(new Uint32Array(1))[0]! || 1;
        await persist(state => startSeason(state, seed));
        showWorkshop();
      } else if (name === 'continue') {fieldTool=null;showWorkshop();}
      else if (name === 'menu') { screenName = 'menu'; drawer.setOpen(true); }
      else if (name === 'settings') screenName = 'settings';
    } catch (error) { notify(error instanceof Error ? error.message : 'Действие не завершено.'); }
    finally { working = false; render(); }
  }

  $('panel').addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (target) void action(target.dataset.action!);
  });
  $('panel').addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (working || !saves || saves.blocked || !['tutorial', 'motion'].includes(input.id)) return;
    working = true;
    const patch = input.id === 'tutorial' ? { tutorial: input.checked } : { reducedMotion: input.checked };
    const result = persist(state => changeSettings(state, patch));
    render();
    void result.catch(() => notify('Настройки не сохранены.')).finally(() => { working = false; render(); });
  });
  $('menu-button').addEventListener('click', () => { void action('menu'); });
  $('catalog-button').addEventListener('click',()=>void action('catalog'));
  $('orders-button').addEventListener('click',()=>void action('orders'));
  $('overview-button').addEventListener('click',()=>{if(!working&&!drawer.blocking)scene?.overview();});
  $('undo-button').addEventListener('click',()=>void boardEdit({type:'undo'}));
  $('next-day-button').addEventListener('click',()=>void action('next-day'));
  $('tutorial-button').addEventListener('click',()=>void action('tutorial'));
  $('cancel-placement').addEventListener('click',cancelPlacement);
  const toggleDebug = (): void => { $('debug').hidden = !$('debug').hidden; debug(); };
  // Высота HUD меняется при переносе строк и повороте; F3 должен оставаться над ним.
  const positionDebug = (): void => {
    const bottom = $('field-tools').hidden ? 0 : Math.max(0, innerHeight - $('field-tools').getBoundingClientRect().top);
    $('app').style.setProperty('--field-debug-bottom', `${bottom}px`);
  };
  new ResizeObserver(positionDebug).observe($('field-tools'));
  window.addEventListener('resize', positionDebug);
  const positionNotices = (): void => $('app').style.setProperty('--notice-top', `${document.querySelector('header')!.getBoundingClientRect().bottom}px`);
  new ResizeObserver(positionNotices).observe(document.querySelector('header')!);
  window.addEventListener('resize', positionNotices);
  $('debug-button').addEventListener('click', toggleDebug);
  $('drawer-debug').addEventListener('click', toggleDebug);
  document.addEventListener('keydown', event => {
    if (event.repeat) return;
    if (event.key === 'F3') { event.preventDefault(); toggleDebug(); }
    if (event.key === 'Escape' && !event.defaultPrevented && !drawer.blocking) {
      if(fieldTool)cancelPlacement();else void action('menu');
    }
  });

  await load();
  scene = new WorkshopScene({ready:() => {
    working = false;
    render();
    // После восстановления доступны либо поле, либо меню с готовыми обработчиками.
    requestAnimationFrame(() => sdk.ready());
  }, frame:(newFps, count) => { fps = newFps; objects = count; if (!$('debug').hidden) debug(); },
    viewport:()=>{
      const font=parseFloat(getComputedStyle(document.documentElement).fontSize);
      const top=document.querySelector('header')!.getBoundingClientRect().bottom+font*.5;
      const bottom=$('field-tools').hidden ? innerHeight-font : $('field-tools').getBoundingClientRect().top-font*.5;
      return {x:font,y:top,width:Math.max(1,innerWidth-font*2),height:Math.max(1,bottom-top)};
    },tap:fieldTap,context:fieldContext,drop:(from,to)=>{
      if(from)void boardEdit({type:'move',from,to});
      else if(fieldTool&&'kind'in fieldTool)void boardEdit({type:'place',kind:fieldTool.kind,to});
    },
  });
  new Phaser.Game({
    type: Phaser.CANVAS,
    parent: 'stage',
    backgroundColor: '#d4e2ce',
    antialias: false,
    // Поле использует Pointer Events; параллельные legacy-драйверы Phaser не нужны.
    input: { mouse:false, touch:false, keyboard:false },
    banner: false,
    scale: { mode: Phaser.Scale.RESIZE, width: $('stage').clientWidth, height: $('stage').clientHeight },
    scene,
  });
}

void main().catch(error => {
  $('panel').textContent = `Не удалось открыть мастерскую: ${error instanceof Error ? error.message : 'ошибка запуска'}. Перезагрузите страницу для повторной проверки.`;
  $('app').setAttribute('aria-busy', 'false');
});
