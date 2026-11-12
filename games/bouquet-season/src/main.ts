import { ru } from './i18n/ru.ts';
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
import './fonts/fonts.css';
import './style.css';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const button = (action: string, text: string, style = ''): string => `<button data-action="${action}" class="${style}">${text}</button>`;
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const careDescription=(kind:ObjectKind,fx:EffectsState):string=>isPlant(kind)&&hasGlobal(fx,'P1',kind)?waterPlant(kind)?ru.field.care.lightFirst:ru.field.care.waterFirst:CATALOG.find(c=>c.kind===kind)!.care;

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
  // Тот же признак готовности, что видит harvestAll: есть урожай и растение не завяло.
  const ripeCount=(run?:GameState['season']):number=>run?run.garden.plants.filter(p=>p.yield&&p.wilt<3).length:0;
  function syncInput(): void {
    const run = saves?.state.season;
    const blocked = drawer.blocking || working || !!saves?.hasPending || !!run?.board.pending || !!run?.board.result;
    $('world').dataset.inputPaused = String(blocked);
    scene?.setInputBlocked(blocked);
    for(const b of $('field-tools').querySelectorAll<HTMLButtonElement>('button')) b.disabled=blocked || !run || (b.id==='next-day-button'&&!run.board.active.length) || (b.id==='undo-button'&&!run.layout.undo) || (b.id==='harvest-button'&&!ripeCount(run));
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
      ? ru.ui.hud.controlsTouch
      : ru.ui.hud.controlsMouse;
    const selectedObject=state?.season?.layout.objects.find(o=>selected&&sameCell(o,selected));
    $('world').classList.toggle('in-season',!!state?.season);
    $('field-tools').hidden=!state?.season;
    $('scene-caption').hidden=!!state?.season;
    const run = state?.season, active = run?.board.active[0];
    $('placement-status').textContent=fieldTool ? ('kind'in fieldTool ? ru.field.placeCell(objectName(fieldTool.kind)) : ru.field.moveCell) : active ? ru.orders.status.active(active.stage===6,active.stage,active.deadline,run!.reputation) : ru.orders.status.pickMain;
    $('orders-button').classList.toggle('primary',!!run && !active);
    $('next-day-button').textContent=run?.day===20?ru.ui.hud.endDay20:ru.ui.hud.nextDay;
    $('next-day-button').title=active?ru.ui.hud.nextDayHint:ru.ui.hud.nextDayNeedOrder;
    const stock=state?.season?.garden.stock;
    $('stock-status').textContent=stock&&run?ru.field.stockLine(openFlowers(run.access).map(k=>ru.field.stockItem(flowerName(k),stock[k])).join(' · ')):'';
    const ripe=ripeCount(run);$('harvest-count').textContent=String(ripe);$('harvest-button').setAttribute('aria-label',ru.field.harvestAria(ripe));
    const tip=state&&tutorialTip(state);
    $('tutorial-button').hidden=!tip;
    $('tutorial-button').title=tip?.title??'';
    $('cancel-placement').hidden=!fieldTool;
    $('catalog-button').hidden=!!fieldTool;
    // Выбранный объект приседает на поле, пока открыта его карточка.
    scene?.setState(state??null,fieldTool,['object','object-modules','remove-confirm'].includes(screenName)?selected:null);
    let html = '';
    if (paused) {
      html = `<h2>${ru.saves.pending.title}</h2><p class="warning">${ru.saves.pending.warning}</p><p>${escape(saves?.error ?? ru.saves.pending.saving)}</p><div class="actions">${button('retry-save', ru.saves.pending.retry, 'primary')}</div>`;
    } else if (!sdk.persistent) {
      html = `<h2>${ru.saves.nonPersistent.title}</h2><p class="warning">${ru.saves.nonPersistent.warning}</p><p>${ru.saves.nonPersistent.hint}</p><div class="actions">${button('recheck', ru.saves.nonPersistent.recheck, 'primary')}${button('recovery', ru.saves.recovery.title)}</div>`;
      if (screenName === 'recovery') html += `<p>${ru.saves.nonPersistent.recoveryLater}</p>`;
    } else if (screenName === 'reset-confirm') {
      html = `<h2>${ru.saves.reset.title}</h2><p class="warning">${ru.saves.reset.warning}</p><div class="actions">${button('reset', ru.saves.reset.confirm, 'danger')}${button('recovery', ru.ui.common.cancel)}</div>`;
    } else if (screenName === 'restore-confirm' && backup) {
      html = `<h2>${ru.saves.restore.title}</h2><p>${ru.saves.restore.text(escape(new Date(backup.savedAt).toLocaleString('ru-RU')), backup.revision)}</p><div class="actions">${button('restore', ru.saves.restore.confirm, 'primary')}${button('recovery', ru.ui.common.cancel)}</div>`;
    } else if (screenName === 'recovery' || damaged) {
      html = `<h2>${ru.saves.recovery.title}</h2><p>${damaged ? ru.saves.recovery.damaged : ru.saves.recovery.canReturn}</p><p>${backup ? ru.saves.recovery.backup(backup.revision, escape(new Date(backup.savedAt).toLocaleString('ru-RU'))) : ru.saves.recovery.noBackup}</p><div class="actions">${backup ? button('restore-confirm', ru.saves.recovery.pick) : ''}${button('recheck', ru.saves.recovery.recheck)}${damaged ? button('reset-confirm', ru.saves.reset.create, 'danger') : button('menu', ru.ui.common.back)}</div>`;
    } else if(screenName==='shop'&&state){html=shopMarkup(state);
    } else if(screenName==='tutorial'&&state){
      html=`<h2>${ru.tutorial.panelTitle(tip?.title??ru.tutorial.doneTitle)}</h2><p>${tip?.text??ru.tutorial.doneText}</p><div class="actions">${tip?button(tip.action,tip.label,'primary'):button('continue',ru.ui.common.toField)}${button('skip-tutorial',ru.tutorial.skip)}${button('continue',ru.ui.common.returnToField)}</div>`;
    } else if (screenName === 'orders' && state?.season) {
      html = boardMarkup(state);
    } else if(screenName==='events'&&state?.season){html=eventsMarkup(state);
    } else if(screenName==='modules'&&state?.season){html=modulesMarkup(state,selectedModule);
    } else if(screenName==='spend-confirm'&&spending){
      html=`<h2>${ru.orders.spend.title}</h2><p class="warning">${ru.orders.spend.warning}</p>${spending.risks.map(r=>ru.orders.spend.risk(r.name,r.missing.map(i=>ru.orders.spend.missingItem(flowerName(i.kind),i.count)).join(', '))).join('')}<div class="actions">${button('confirm-spend',ru.orders.spend.confirm,'danger')}${button('cancel-spend',ru.ui.common.cancel)}</div>`;
    } else if (screenName === 'pending' && state?.season?.board.pending) {
      html = pendingMarkup(state);
    } else if (screenName === 'result' && state?.season?.board.result) {
      html = resultMarkup(state);
    } else if (screenName === 'surrender-confirm' && state?.season) {
      html = `<h2>${ru.orders.surrender.title}</h2><p>${ru.orders.surrender.text}</p><div class="actions">${button('surrender',ru.orders.surrender.confirm,'danger')}${button('orders',ru.ui.common.backToOrders)}</div>`;
    } else if (screenName === 'catalog' && state?.season) {
      html = `<h2>${ru.field.catalog.title}</h2><p class="small catalog-note">${catalogTarget?ru.field.catalog.noteTarget:ru.field.catalog.noteFree}</p><div class="catalog-grid">${CATALOG.filter(c=>availableKind(state.season!.access,c.kind)).map(c=>`<button data-action="pick-${c.kind}"><strong>${c.name}</strong><span>${careDescription(c.kind,state.season!.effects)}</span></button>`).join('')}</div><div class="actions">${button('continue',ru.ui.common.returnToField)}</div>`;
    } else if (screenName === 'remove-confirm' && selectedObject) {
      html = `<h2>${ru.field.remove.title}</h2><p class="warning">${ru.field.remove.text(objectName(selectedObject.kind))}</p><div class="actions">${button('remove',ru.field.remove.plant,'danger')}${button('object',ru.ui.common.cancel)}</div>`;
    } else if (screenName === 'object-modules' && state?.season && selectedObject) {
      html = objectModulesMarkup(state, selectedObject);
    } else if (screenName === 'object' && selectedObject) {
      const plant=isPlant(selectedObject.kind);
      const season=state!.season!,crop=season.garden.plants.find(p=>sameCell(p,selectedObject));
      const conditions=plantConditions(livingObjects(season.layout.objects,season.garden.plants),selectedObject,season.effects,fieldSize(season.access));
      const status=conditions?`<p class="small plant-conditions">${ru.field.card.conditionsLine(conditions.light,conditions.water)}<br>${ru.field.card.conditionsHint}</p>`:'';
      const phase=crop?.wilt===3?ru.field.card.phaseDead:crop?.yield?ru.field.card.phaseReady(crop.yield):crop?.growth?ru.field.card.phaseGrowing:ru.field.card.phaseStart;
      const health=crop?.wilt===3?ru.field.card.healthDead:crop?.wilt?ru.field.card.healthWilting(crop.wilt):selectedObject.adaptation?ru.field.card.healthAdaptation:crop?.recovering?ru.field.card.healthRecovering:ru.field.card.healthTransplant;
      const swapped=plant&&hasGlobal(season.effects,'P1',selectedObject.kind),mod=moduleAt(season.effects,selectedObject);
      const effectInfo=`${swapped?`<p class="small">${ru.field.card.swappedNote}</p>`:''}<article class="order-card"><h3>${ru.field.card.moduleTitle}</h3><p class="small">${mod?ru.field.card.moduleInstalled(effectDefinition(mod.effect).name):ru.field.card.moduleFree}</p>${button('object-modules',mod?ru.field.card.moduleManage:ru.field.card.moduleInstall)}</article>`;
      const details=crop?`<div class="plant-info"><p class="small">${careDescription(selectedObject.kind,season.effects)}.</p><p class="small plant-growth"><strong>${phase}</strong><br>${ru.field.card.growthLine(crop.growth/2,crop.growthDays)}<br>${crop.wilt===3?ru.field.card.yieldLost:crop.yield?ru.field.card.yieldFixed:ru.field.card.cutLine(crop.bonus?ru.field.card.cutBonusOther:crop.supportBonus?ru.field.card.cutBonusSupport:ru.field.card.cutBonusLost)}</p><p class="small plant-health">${health}</p>${status}</div>`:`<p>${ru.field.card.deviceInfo}</p>`;
      const cut=crop?`<button data-action="harvest" class="primary" data-unavailable="${crop.yield===0||crop.wilt===3}">${crop.yield?ru.field.card.cutButton(crop.yield):crop.wilt===3?ru.field.card.noYield:ru.field.card.notReady}</button>`:'';
      html = `<h2>${objectName(selectedObject.kind)}</h2> <div class="object-details">${details}<div class="object-module-summary">${effectInfo}</div></div><div class="actions">${cut}${button('move-object',ru.field.card.move)}${button(plant?'remove-confirm':'remove',plant?ru.field.remove.plant:ru.field.remove.device,'danger')}${button('continue',ru.ui.common.backToField)}</div>`;
    } else if (screenName === 'settings') {
      html = `<h2>${ru.ui.settings.title}</h2><label><input id="tutorial" type="checkbox" ${state?.settings.tutorial ? 'checked' : ''}>${ru.ui.settings.tutorial}</label><label><input id="motion" type="checkbox" ${state?.settings.reducedMotion ? 'checked' : ''}>${ru.ui.settings.reducedMotion}</label><p class="small settings-note">${ru.ui.settings.note}</p><div class="actions">${button('menu', ru.ui.common.back)}</div>`;
    } else if (screenName === 'workshop' && state?.season) {
      html = `<span class="eyebrow">${ru.ui.season.eyebrow(state.season.number)}</span><h2>${ru.ui.hud.dayHeading(state.season.day,state.season.day===1)}</h2><div class="stats"><span><strong>${state.season.reputation} / 3</strong>${ru.ui.season.reputation}</span><span><strong>${state.season.layout.objects.length} / ${fieldSize(state.season.access)}</strong>${ru.ui.season.cellsUsed}</span></div><p>${ru.ui.season.progressNote}</p><p class="small">${touch?ru.ui.season.helpTouch:ru.ui.season.helpMouse}</p><div class="actions">${button('orders',ru.ui.common.ordersBoard)}${button('catalog',ru.ui.common.catalog)}${button('modules',ru.ui.common.seasonUpgrades)}${button('events',ru.ui.common.eventsAndFair)}${button('shop',ru.ui.common.workshopDevelopment)}${tip?button('tutorial',ru.ui.common.hint):''}${button('menu', ru.ui.common.menuAndSettings)}</div>`;
    } else {
      html = `<span class="eyebrow">${ru.ui.menu.eyebrow}</span><h2>${ru.ui.menu.title}</h2><p class="menu-intro">${ru.ui.menu.intro}</p><div class="stats"><span><strong>${state?.profile.coins ?? 0}</strong>${ru.ui.menu.coins}</span><span><strong>${state?.profile.experience ?? 0}</strong>${ru.ui.menu.experience}</span></div><p class="small">${ru.ui.menu.level(accessLevel(state?.profile.experience??0))}</p><p class="small controls-help"><strong>${ru.ui.menu.controls}</strong><br>${controlsText}</p><div class="actions menu-actions">${button(!state?.season||run?.board.result ? 'start' : 'continue', run?.board.result ? ru.ui.common.startNewSeason : state?.season ? ru.ui.menu.continueSeason : ru.ui.menu.startSeason, 'primary')}${run?.board.result?button('result',ru.ui.common.seasonResults):''}${button('shop',ru.ui.common.workshopDevelopment)}${button('settings', ru.ui.menu.settings)}${button('fullscreen', ru.ui.menu.fullscreen)}${button('recovery', ru.saves.recovery.title)}</div>`;
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
    $('season-status').textContent = state?.season ? ru.ui.hud.seasonStatus(state.season.day,state.season.day===1,state.season.layout.objects.length,fieldSize(state.season.access)) : ru.ui.hud.seasonBetween;
    $('storage-status').textContent = `${sdk.mode === 'hub' ? ru.saves.status.hostHub : ru.saves.status.hostStandalone} · ${sdk.persistent ? ru.saves.status.persistent : ru.saves.status.unavailable}${saves?.savedRevision ? ru.saves.status.revision(saves.savedRevision) : ''}`;
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
      throw new Error(ru.saves.errors.originUnconfirmedKept);
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
    }catch(error){notify(error instanceof Error?error.message:ru.ui.notify.changeFailed);}
    finally{working=false;render();}
  }
  function fieldTap(cell:Cell): void {
    if(working || drawer.blocking || !saves || saves.blocked)return;
    if(fieldTool&&'from'in fieldTool){void boardEdit({type:'move',from:fieldTool.from,to:cell});return;}
    const object=saves.state.season?.layout.objects.find(o=>sameCell(o,cell));
    if(object){selected=cell;fieldTool=null;screenName='object';drawer.setOpen(true);render();}
    else if(fieldTool&&'kind'in fieldTool)void boardEdit({type:'place',kind:fieldTool.kind,to:cell});
    else notify(ru.ui.notify.pickInCatalog);
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
          notify(ru.ui.notify.fullscreenBusy);
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
    } catch (error) { notify(error instanceof Error ? error.message : ru.ui.notify.actionFailed); }
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
    void result.catch(() => notify(ru.ui.notify.settingsNotSaved)).finally(() => { working = false; render(); });
  });
  $('menu-button').addEventListener('click', () => { void action('menu'); });
  $('catalog-button').addEventListener('click',()=>void action('catalog'));
  $('orders-button').addEventListener('click',()=>void action('orders'));
  $('harvest-button').addEventListener('click',()=>void action('harvest-all'));
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
    hidePreloader();
    // После восстановления доступны либо поле, либо меню с готовыми обработчиками.
    requestAnimationFrame(() => sdk.ready());
  }, frame:(newFps, count) => { fps = newFps; objects = count; if (!$('debug').hidden) debug(); },
    viewport:()=>{
      const font=parseFloat(getComputedStyle(document.documentElement).fontSize);
      const top=document.querySelector('header')!.getBoundingClientRect().bottom+font*.5;
      const bottom=$('field-tools').hidden ? innerHeight-font : $('field-tools').getBoundingClientRect().top-font*.5;
      return {x:font,y:top,width:Math.max(1,innerWidth-font*2),height:Math.max(1,bottom-top)};
    },reducedMotion:()=>!!saves?.state.settings.reducedMotion||matchMedia('(prefers-reduced-motion: reduce)').matches,
    tap:fieldTap,context:fieldContext,drop:(from,to)=>{
      if(from)void boardEdit({type:'move',from,to});
      else if(fieldTool&&'kind'in fieldTool)void boardEdit({type:'place',kind:fieldTool.kind,to});
    },
  });
  new Phaser.Game({
    type: Phaser.CANVAS,
    parent: 'stage',
    // Фон и зерно бумаги - в CSS под канвой, поле рисуется поверх.
    transparent: true,
    antialias: false,
    // Поле использует Pointer Events; параллельные legacy-драйверы Phaser не нужны.
    input: { mouse:false, touch:false, keyboard:false },
    banner: false,
    scale: { mode: Phaser.Scale.RESIZE, width: $('stage').clientWidth, height: $('stage').clientHeight },
    scene,
  });
}

// Заставка уходит, когда мастерская готова и загружены шрифты темы.
function hidePreloader(): void {
  const preloader = $('preloader');
  void document.fonts.ready.then(() => {
    preloader.dataset.state = 'leaving';
    const done = (): void => { preloader.hidden = true; };
    if (getComputedStyle(preloader).transitionDuration.split(',').every(d => parseFloat(d) === 0)) done();
    else { preloader.addEventListener('transitionend', done, { once: true }); setTimeout(done, 600); }
  });
}

void main().catch(error => {
  hidePreloader();
  $('panel').textContent = ru.ui.notify.startFailed(error instanceof Error ? error.message : ru.ui.notify.startFailedReason);
  $('app').setAttribute('aria-busy', 'false');
});
