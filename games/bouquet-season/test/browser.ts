import {PURCHASES,purchase,fieldSize} from '../src/core/shop.ts';
import {recordTutorial} from '../src/core/tutorial.ts';
// Проверяется собранная игра; имитация отказов находится только в браузерном тесте.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { chromium, type Page, type Frame } from 'playwright';
import { PROFILES } from '../../../tests/ui/core/profiles.ts';
import { encode } from '../src/core/saves.ts';
import { fitField, toScreen, zoomField, type FieldView } from '../src/core/camera.ts';
import { cellCenter, cellCorners, fieldCells, sameCell } from '../src/core/field.ts';
import type { Cell } from '../src/core/field.ts';
import { newProfile, startSeason, editLayout, enterGrowthDay, refreshStateOffers, installModule, isGameState, type GameState } from '../src/core/state.ts';
import { checkPanelReading } from './panel-checks.ts';
import { orderFixture, activeOrderFixture, readyOrderFixture, plantedOrderFixture, unprovenOffersFixture } from './order-fixtures.ts';
import {moduleFixture,eventFixture,moduleRewardFixture,noCalendarRequestFixture} from './stage5-fixtures.ts';
import {startEvents} from '../src/core/events.ts';
import {orderCandidates} from '../src/core/orders.ts';
import { submitOrder,acceptOrder,chooseReward,closeDay } from '../src/core/calendar.ts';

// BOUQUET_DIST - отдельная сборка, чтобы параллельная пересборка dist не ломала прогон.
const root = resolve(process.env.BOUQUET_DIST ?? resolve(import.meta.dirname, '../dist'));
const output = resolve(import.meta.dirname, process.env.BOUQUET_ARTIFACTS ?? '../artifacts/browser/latest');

// Режимы прогона. BOUQUET_SCOPE=key (по умолчанию) - механически проверяются только ключевые экраны
// интерфейса: игровой цикл (рост, заказы, события, покупки) закрывают юнит-тесты, а браузеру нужен
// каждый ВИД экрана на всех семи профилях. BOUQUET_SCOPE=full - прежний длинный сценарий (~129
// состояний на профиль), для проверки перед релизом.
// BOUQUET_ALL_PNG=1 - снимки всех состояний, иначе PNG пишутся только для ключевых (выборка для
// просмотра моделью); DOM-проверкам файлы не нужны. BOUQUET_VIDEO=1 - ещё и запись демо-видео.
const scope = process.env.BOUQUET_SCOPE ?? 'key';
assert.ok(scope === 'key' || scope === 'full', `BOUQUET_SCOPE: key или full, получено ${scope}`);
const full = scope === 'full';
const allPng = process.env.BOUQUET_ALL_PNG === '1';
const withVideo = process.env.BOUQUET_VIDEO === '1';
// Ключевые состояния: по одному на каждый различный вид экрана/панели. Только они дают PNG
// (в обоих режимах) и только они проходят DOM-проверки в режиме key; остальные состояния
// (то же меню/карточка, но с другими данными) в key пропускаются, в full - проверяются без PNG.
const KEY_STATES: ReadonlySet<string> = new Set([
  'menu', 'workshop', 'catalog', 'object', 'remove-confirm',            // меню, поле, каталог, карточка, удаление
  'settings', 'recovery', 'restore-confirm', 'reset-confirm',           // настройки, восстановление, подтверждения
  'corrupt-both', 'nonpersistent', 'save-error',                        // обе копии повреждены, нет постоянного хранения, ошибка записи
  'f3', 'menu-closed', 'notice-queue', 'growth-card',                   // отладка, закрытое меню, очередь уведомлений, карточка с ростом
  'orders-offers', 'orders-module-choice', 'orders-events',             // доска заказов, выбор улучшения, просьбы и ярмарка
  'orders-modules', 'orders-module-target', 'orders-shop-funded',       // сезонные улучшения, установка модуля, развитие мастерской
  'orders-victory', 'orders-calendar-loss',                             // победа, поражение
  'orders-surrender-confirm', 'orders-spend-confirm', 'orders-tutorial-accept', // подтверждения, подсказка обучения
]);
// Очищается только этот каталог и только по шаблону: прогоны не копятся.
await mkdir(output, { recursive: true });
for (const name of await readdir(output)) if (/\.(png|webm)$/.test(name) || name === 'report.json') await rm(resolve(output, name), { force: true });
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path === '/harness') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body></body></html>'); return; }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) { response.writeHead(403).end(); return; }
    const data = await readFile(file);
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2':'font/woff2' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream');
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const bundleHashes = Object.fromEntries(await Promise.all((await readdir(resolve(root, 'assets'))).map(async file => [file, createHash('sha256').update(await readFile(resolve(root, 'assets', file))).digest('hex')])));
const hashFile = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex');
const inputFiles = ['build/obfuscation.ts','build/release-check.ts','test/obfuscation.test.ts','test/release.test.ts','test/release-check.ts','src/core/shop.ts','src/core/tutorial.ts','src/shop-ui.ts','test/shop.test.ts','test/expansion.test.ts','test/tutorial.test.ts','test/full-season-browser.ts','src/core/effects.ts','src/core/events.ts','src/core/rewards.ts','src/core/progress.ts','test/effects.test.ts','test/effect-growth.test.ts','test/events.test.ts','test/rewards.test.ts','test/legacy-fixtures.ts','test/stage5-fixtures.ts','src/core/orders.ts', 'src/core/planner.ts', 'src/core/board.ts', 'src/core/calendar.ts', 'src/order-ui.ts', 'test/orders.test.ts', 'test/planner.test.ts', 'test/calendar.test.ts', 'test/order-fixtures.ts', 'src/notices.ts', 'test/panel-checks.ts', 'src/main.ts', 'src/drawer.ts', 'src/field-input.ts', 'src/touch-buttons.ts', 'src/core/field.ts', 'src/core/layout.ts', 'src/core/conditions.ts', 'src/core/growth.ts', 'src/core/garden.ts', 'src/core/camera.ts', 'src/scene.ts', 'src/style.css', 'src/fonts/fonts.css', 'src/core/state.ts', 'src/core/saves.ts', 'test/browser.ts', 'test/state.test.ts', 'test/saves.test.ts', 'test/field.test.ts', 'test/layout.test.ts', 'test/conditions.test.ts', 'test/camera.test.ts', 'test/growth.test.ts', 'test/garden.test.ts', 'test/season-growth.test.ts', 'game.json', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json'];
const inputHashes = Object.fromEntries(await Promise.all(inputFiles.map(async file => [file, await hashFile(resolve(import.meta.dirname, '..', file))])));
const report: { bundleHashes: Record<string, string>; htmlSha256: string; inputHashes: Record<string, string>; scope: string; pngHashes: Record<string, string>; videos: Record<string, string>; profiles: unknown[]; scaleProbes: unknown[]; flows: string[]; errors: string[]; complete: boolean } = { bundleHashes, htmlSha256: await hashFile(resolve(root, 'index.html')), inputHashes, scope, pngHashes: {}, videos: {}, profiles: [], scaleProbes: [], flows: [], errors: [], complete: false };
const currentKey = 'gf:bouquet-season:save:progress';
const previousKey = 'gf:bouquet-season:save:progress.previous';

async function ready(page: Page): Promise<void> {
  await page.locator('html[data-gf-ready]').waitFor({ state: 'attached' });
  await page.locator('#app[aria-busy="false"]').waitFor();
  await settled(page);
}
async function settled(page: Page | Frame): Promise<void> {
  await page.locator('#drawer-layer[data-state="open"], #drawer-layer[data-state="closed"]').waitFor({ state: 'attached' });
  // Появление поля длится около секунды; снимки и проверки - по вставшему полю.
  await page.locator('canvas[data-intro="running"]').waitFor({ state: 'detached' });
  // Заставка первой загрузки уходит после готовности и шрифтов.
  await page.locator('#preloader').waitFor({ state: 'hidden' });
}
async function click(page: Page | Frame, action: string): Promise<void> {
  await settled(page);
  const closed = await page.locator('#drawer-layer').getAttribute('data-state') === 'closed';
  const element = page.locator(closed && action === 'menu' ? '#menu-button' : `#panel [data-action="${action}"]`);
  const visible = await element.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const container = element.closest('#panel')?.getBoundingClientRect();
    return bounds.top >= (container?.top ?? 0) && bounds.bottom <= (container?.bottom ?? innerHeight)
      && bounds.left >= (container?.left ?? 0) && bounds.right <= (container?.right ?? innerWidth)
      && element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  });
  assert.equal(visible, true, `${action}: кнопка недоступна без прокрутки`);
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (touch) await element.tap(); else await element.click();
  await page.locator('#app[aria-busy="false"]').waitFor();
  await settled(page);
}
async function failWrites(page: Page, probeOnly = false): Promise<void> {
  await page.evaluate(probeOnly => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, '__bouquetRestoreStorage', { configurable: true, value: () => { Storage.prototype.setItem = original; } });
    Storage.prototype.setItem = function (key, value) {
      if (probeOnly ? key === '__gf_probe__' : key.endsWith(':save:progress')) throw new Error('Тест: хранилище недоступно.');
      original.call(this, key, value);
    };
  }, probeOnly);
}
async function restoreWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __bouquetRestoreStorage: () => void }).__bouquetRestoreStorage();
    delete (window as unknown as Record<string, unknown>).__bouquetRestoreStorage;
  });
}
async function toolbar(page:Page,id:string):Promise<void>{
  await settled(page);
  const element=page.locator(`#${id}`);
  if(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches))await element.tap();else await element.click();
  await page.locator('#app[aria-busy="false"]').waitFor();await settled(page);
}
async function fieldView(page:Page):Promise<FieldView>{
  const rect=await page.evaluate(()=>{
    const font=parseFloat(getComputedStyle(document.documentElement).fontSize);
    const top=document.querySelector('header')!.getBoundingClientRect().bottom+font*.5;
    const bottom=document.getElementById('field-tools')!.getBoundingClientRect().top-font*.5;
    return {x:font,y:top,width:innerWidth-font*2,height:bottom-top};
  });
  const size=await page.locator('canvas').getAttribute('aria-label');
  return fitField(rect,size?.includes('37')?37:19);
}
async function fieldPoint(page:Page,cell:Cell):Promise<{x:number;y:number}>{
  return toScreen(await fieldView(page),cellCenter(cell));
}
async function tapCell(page:Page,cell:Cell):Promise<void>{
  const p=await fieldPoint(page,cell);
  if(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches))await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);
  await page.locator('#app[aria-busy="false"]').waitFor();await settled(page);
}
async function layout(page:Page):Promise<unknown>{
  return page.evaluate(key=>JSON.parse(JSON.parse(localStorage.getItem(key)!).payload).season.layout,currentKey);
}
async function dragCell(page:Page,from:Cell,to:Cell):Promise<void>{
  const a=await fieldPoint(page,from),b=await fieldPoint(page,to);
  if(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches)){
    const session=await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]});
    for(let i=1;i<=6;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/6,y:a.y+(b.y-a.y)*i/6,id:1}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
  }else{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();}
  await page.locator('#app[aria-busy="false"]').waitFor();await settled(page);
}
async function canvasHash(page:Page):Promise<string>{
  // Graphics обновляет команды сразу, canvas — на следующем кадре Phaser.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  return createHash('sha256').update(await page.locator('canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL())).digest('hex');
}
async function keyboardCamera(page:Page):Promise<void>{
  // На этом шаге на поле одна гвоздика: её реальные пиксели дают положение камеры
  // без тестового доступа к внутреннему состоянию сцены.
  const flower=async()=>{
    await canvasHash(page);
    return page.locator('canvas').evaluate(canvas=>{
      const c=canvas as HTMLCanvasElement,rgba=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;
      let x=0,y=0,count=0;
      for(let i=0;i<rgba.length;i+=4)if(rgba[i]===205&&rgba[i+1]===104&&rgba[i+2]===118){
        x+=(i/4)%c.width;y+=Math.floor(i/4/c.width);count++;
      }
      if(!count)throw Error('Не найдены пиксели гвоздики для проверки камеры.');
      return {x:x/count,y:y/count};
    });
  };
  const copies=await page.evaluate(([a,b])=>[localStorage.getItem(a!),localStorage.getItem(b!)],[currentKey,previousKey]);
  const session=await page.context().newCDPSession(page);
  const cases=[
    {code:'KeyA',key:'ф',axis:'x',sign:1}, {code:'KeyD',key:'в',axis:'x',sign:-1},
    {code:'KeyW',key:'ц',axis:'y',sign:1}, {code:'KeyS',key:'ы',axis:'y',sign:-1},
    {code:'KeyA',key:'q',axis:'x',sign:1}, {code:'KeyW',key:'z',axis:'y',sign:1},
  ] as const;
  try{
    for(const {code,key,axis,sign} of cases){
      await toolbar(page,'overview-button');await page.locator('canvas').focus();
      const before=await flower();
      await session.send('Input.dispatchKeyEvent',{type:'keyDown',code,key,windowsVirtualKeyCode:code.charCodeAt(3)});
      try{await page.waitForTimeout(180);}finally{
        // Буква при отпускании уже другая, физическая клавиша — та же.
        await session.send('Input.dispatchKeyEvent',{type:'keyUp',code,key:code.slice(3).toLowerCase(),windowsVirtualKeyCode:code.charCodeAt(3)});
      }
      const after=await flower(),other=axis==='x'?'y':'x';
      assert.ok((after[axis]-before[axis])*sign>5,`${code}/${key}: неверное движение камеры`);
      assert.ok(Math.abs(after[other]-before[other])<2,`${code}/${key}: движение по другой оси`);
      await page.waitForTimeout(180);
      const released=await flower();
      assert.ok(Math.hypot(released.x-after.x,released.y-after.y)<1,`${code}/${key}: залипание после смены раскладки`);
    }
    // Открытие меню очищает удерживаемое движение; закрытая панель его не возобновляет.
    await session.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyD',key:'в',windowsVirtualKeyCode:68});
    try{
      await page.waitForTimeout(80);await click(page,'menu');
      const paused=await flower();await page.waitForTimeout(180);
      assert.deepEqual(await flower(),paused,'камера не движется за открытым меню');
      await click(page,'continue');const closed=await flower();await page.waitForTimeout(180);
      assert.deepEqual(await flower(),closed,'после закрытия меню удержание не возвращается');
    }finally{await session.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyD',key:'d',windowsVirtualKeyCode:68});}
    assert.deepEqual(await page.evaluate(([a,b])=>[localStorage.getItem(a!),localStorage.getItem(b!)],[currentKey,previousKey]),copies,'камера не меняет сохранения');
  }finally{await session.detach();await toolbar(page,'overview-button');}
}
function growthFixture():GameState{
  let state=startSeason(newProfile(),123);
  for(const [kind,q,r] of [['carnation',0,0],['chrysanthemum',-1,0],['carnation',0,1],['sprinkler',1,0],['lamp',0,-1]] as const)
    state=editLayout(state,{type:'place',kind,to:{q,r}});
  state.season!.board.offers=[];
  return state;
}
try {
  // BOUQUET_PROFILES - быстрый прогон части профилей при разработке; приёмка - все семь.
  const only=process.env.BOUQUET_PROFILES?.split(',');
  const profileQueue=PROFILES.filter(p=>!only||only.includes(p.id));
  const workers=Math.max(1,Math.min(3,Number(process.env.BOUQUET_WORKERS??1)));
  await Promise.all(Array.from({length:workers},async()=>{
   while(profileQueue.length){
    const profile=profileQueue.shift()!;
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: profile.touch ? 2 : 1 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const states: string[] = [];
    const checks: unknown[] = [];
    const readingProbes: unknown[] = [];
    let expectedDay=1;
    const capture = async (name: string): Promise<void> => {
      const key = KEY_STATES.has(name);
      if (!full && !key) return;
      await settled(page);
      const headings: Record<string, string> = { menu: 'Ваша мастерская', workshop: 'День 1 · Подготовка', settings: 'Настройки', recovery: 'Восстановление', 'restore-confirm': 'Восстановить копию?', 'save-error': 'Прогресс в памяти', 'corrupt-current': 'Восстановление', 'restore-save-error': 'Прогресс в памяти', 'corrupt-both': 'Восстановление', 'reset-confirm': 'Создать новый профиль?', nonpersistent: 'Нужно постоянное хранение', 'nonpersistent-recovery': 'Нужно постоянное хранение', f3: 'Ваша мастерская', equipped:'День 1 · Подготовка', catalog:'Каталог', object:'Гвоздика', 'remove-confirm':'Удалить растение?', placed:'День 1 · Подготовка', moved:'День 1 · Подготовка', 'placement-error':'Прогресс в памяти', 'undo-reloaded':'День 1 · Подготовка', 'camera-gesture':'День 1 · Подготовка', 'menu-closed': 'Мастерская · Между сезонами', 'reduced-motion': 'Настройки' };
      headings['conditions-card']='Гвоздика';headings['context-catalog']='Каталог';
      if(name.endsWith('-card'))headings[name]='Гвоздика';
      headings['harvest-save-error']='Прогресс в памяти';
      headings['notice-queue']='Ваша мастерская';
      for(const name of ['orders-offers','orders-active','orders-ready','orders-final-offers','orders-final-active','orders-empty','orders-unproven'])headings[name]='Доска заказов';
      headings['orders-pending']='Выберите улучшение';headings['orders-five-pending']='Выберите улучшение';
      headings['orders-victory']='Сезон завершён: победа';
      for(const name of ['orders-calendar-loss','orders-reputation-loss','orders-surrendered'])headings[name]='Сезон завершён: поражение';
      headings['orders-surrender-confirm']='Закончить сезон поражением?';
      for(const n of ['orders-events','orders-events-active','orders-fair-minimum','orders-fair-bonus-done','orders-event-waiting','orders-event-late','orders-event-no-calendar','orders-story-complete'])headings[n]='Просьбы и ярмарка';
      for(const n of ['orders-modules','orders-module-installed','orders-module-detached','orders-effects-empty'])headings[n]='Сезонные улучшения';
      headings['orders-module-target']='Установить модуль';headings['orders-p1-catalog']='Каталог';headings['orders-p1-object']='Гвоздика';
      for(const n of ['orders-module-choice','orders-urgent-reward','orders-fair-reward'])headings[n]='Выберите улучшение';
      headings['orders-choice-error']='Прогресс в памяти';
      headings['orders-spend-confirm']='Потратить общий запас?';
      headings['orders-day-error']='Прогресс в памяти';headings['orders-submit-error']='Прогресс в памяти';
      Object.assign(headings,{'orders-shop-locked':'Развитие мастерской','orders-shop-funded':'Развитие мастерской','orders-shop-rose':'Развитие мастерской','orders-shop-all':'Развитие мастерской','orders-shop-season':'Развитие мастерской','orders-buy-error':'Прогресс в памяти','orders-expanded-catalog':'Каталог','orders-rose-card':'Роза','orders-tulip-card':'Тюльпан','orders-gerbera-card':'Гербера','orders-lily-card':'Лилия','orders-parallel':'Доска заказов','orders-parallel-pending':'Выберите улучшение','orders-parallel-resume':'Доска заказов','orders-existing-offers-pending':'Выберите улучшение','orders-existing-offers-resume':'Доска заказов','orders-two-events':'Просьбы и ярмарка','orders-tutorial-accept':'Подсказка: Выберите настоящий заказ','orders-tutorial-care':'Подсказка: Обеспечьте уход','orders-tutorial-cut':'Подсказка: Срежьте готовые цветы'});
      const closed=await page.locator('#drawer-layer').getAttribute('data-state')==='closed';
      Object.assign(headings,{'orders-object-module-card':'Гвоздика','orders-object-module-free':'Модуль: Гвоздика','orders-object-module-occupied':'Модуль: Гвоздика','orders-object-module-empty':'Модуль: Гвоздика','orders-object-module-transfer':'Модуль: Гвоздика','orders-object-module-device':'Модуль: Лампа','orders-object-module-device-installed':'Лампа','orders-object-module-installed':'Гвоздика','orders-object-module-error':'Прогресс в памяти','orders-object-module-retried':'Гвоздика'});
      const normalReading = !closed && name.startsWith('orders-') ? await checkPanelReading(page) : null;
      assert.equal(closed,name.endsWith('-board') || ['workshop','placed','moved','undo-reloaded','camera-gesture','zone-preview','equipped','full-field','field-f3','menu-closed','hover-flower','hover-neighbor','lamp-zone','sprinkler-zone','right-cancel','context-placed'].includes(name),`${profile.id}/${name}: неверно открыта/закрыта панель`);
      if(closed){
        const expected=name==='menu-closed'?'Мастерская · Между сезонами':name.endsWith('-board')?`День ${expectedDay} · ${expectedDay===1?'Подготовка':'Выращивание'}`:'День 1 · Подготовка';
        assert.ok((await page.locator('#season-status').textContent())?.startsWith(expected),`${profile.id}/${name}: не тот экран поля`);
      }else assert.equal(await page.getByRole('heading', { name: headings[name], exact: true }).count(), 1, `${profile.id}/${name}: не тот экран`);
      const metrics = await page.evaluate(() => {
        const panel = document.getElementById('panel')!;
        const rect = panel.getBoundingClientRect();
        const open = document.getElementById('drawer-layer')!.dataset.state === 'open';
        const buttons = open ? Array.from(panel.querySelectorAll('button')).map(button => button.getBoundingClientRect()) : [];
        const heading = panel.querySelector('h2')!.getBoundingClientRect();
        const actions = panel.querySelector('.actions')!.getBoundingClientRect();
        const canvas = document.querySelector('canvas')!;
        const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const close = document.getElementById('drawer-close')!;
        const info=panel.querySelector('.plant-info')?.getBoundingClientRect();
        const content=panel.querySelector('.panel-content')!.getBoundingClientRect();
        return {
          rootFont,
          panelFont: parseFloat(getComputedStyle(panel).fontSize),
          closeFont: parseFloat(getComputedStyle(close).fontSize),
          closeMinHeight: parseFloat(getComputedStyle(close).minHeight),
          panelPadding: parseFloat(getComputedStyle(panel).paddingLeft),
          headingFont: parseFloat(getComputedStyle(panel.querySelector('h2')!).fontSize),
          overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          drawerOpen: open,
          panelVisible: !open || (rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
          panelWidth: open ? rect.width : null,
          smallButtons: buttons.filter(rect => rect.height < 3 * rootFont - .1 || rect.width < 3 * rootFont - .1).length,
          textOverflow: open ? Array.from(panel.querySelectorAll('button')).filter(button => button.scrollWidth > button.clientWidth + 1).length : 0,
          buttonsOutsidePanel: buttons.filter(button => button.top < rect.top || button.bottom > rect.bottom || button.left < rect.left || button.right > rect.right).length,
          headingVisible: !open || (heading.top >= rect.top && heading.bottom <= actions.top),
          plantTextClipped: open && !!info && (info.top<content.top-.5 || info.bottom>content.bottom+.5),
          fieldFillsScreen: canvas.clientWidth === innerWidth && canvas.clientHeight === innerHeight,
          worldBlocked: (document.getElementById('world') as HTMLElement).inert,
          canvasPixels: [canvas.width, canvas.height],
          canvasCss: [canvas.clientWidth, canvas.clientHeight],
          touch: matchMedia('(pointer: coarse)').matches,
          hudClipped: open ? 0 : Array.from(document.querySelectorAll<HTMLButtonElement>('#field-tools button, #menu-button')).filter(b=>!b.hidden&&b.getClientRects().length).filter(b=>{
            const r=b.getBoundingClientRect();
            return r.left<0 || r.right>innerWidth || r.top<0 || r.bottom>innerHeight || r.height<3*rootFont-.1 || r.width<3*rootFont-.1;
          }).length,
        };
      });
      // Снимок сохраняется и при неуспешной геометрии, чтобы дефект можно было увидеть.
      const filename = `${profile.id}-${name}.png`;
      const shot = key || allPng;
      if (shot) await page.screenshot({ path: resolve(output, filename) });
      try {
      assert.equal(metrics.overflow, false, `${profile.id}/${name}: прокрутка страницы`);
      const scale = Math.max(1, profile.width / 1920);
      assert.ok(Math.abs(metrics.rootFont - 16 * scale) < .02, `${profile.id}/${name}: неверный корневой масштаб`);
      assert.ok(Math.abs(metrics.panelFont - 16 * scale) < .02);
      assert.ok(Math.abs(metrics.closeFont - 16 * scale) < .02);
      assert.ok(Math.abs(metrics.closeMinHeight - 48 * scale) < .02);
      assert.ok(Math.abs(metrics.panelPadding - (profile.width <= 900 ? 20 : 24) * scale) < .02);
      if (metrics.drawerOpen) {
        const expectedWidth = profile.width <= 540 ? profile.width * .92 : profile.width <= 900 ? Math.min(profile.width * .92, profile.width - 8 * metrics.rootFont) : Math.min(profile.width * .92, Math.max(360 * scale, Math.min(profile.width / 3, 600 * scale)));
        assert.ok(Math.abs(metrics.panelWidth! - expectedWidth) < 1, `${profile.id}/${name}: неверная ширина панели`);
      }
      if (profile.width >= 1920) assert.ok(Math.abs(metrics.headingFont - 32 * scale) < .02);
      assert.equal(metrics.panelVisible, true, `${profile.id}/${name}: панель за экраном`);
      assert.equal(metrics.smallButtons, 0, `${profile.id}/${name}: кнопка меньше 48px`);
      assert.equal(metrics.textOverflow, 0, `${profile.id}/${name}: подпись выходит за кнопку`);
      if (!name.startsWith('orders-')) assert.equal(metrics.buttonsOutsidePanel, 0, `${profile.id}/${name}: основные действия требуют прокрутки`);
      assert.equal(metrics.headingVisible, true, `${profile.id}/${name}: заголовок перекрыт действиями`);
      assert.equal(metrics.plantTextClipped,false,`${profile.id}/${name}: текст карточки растения требует прокрутки`);
      assert.equal(metrics.fieldFillsScreen, true, `${profile.id}/${name}: поле не занимает экран`);
      assert.equal(metrics.worldBlocked, metrics.drawerOpen);
      assert.equal(metrics.touch, profile.touch);
      assert.equal(metrics.hudClipped,0,`${profile.id}/${name}: HUD обрезан или мелкий`);
      // Раскладка шапки, панели и нижних действий: дефекты по снимкам style-1x.
      const layout = await page.evaluate(() => {
        const font = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const lines = (element: Element): number => { const range = document.createRange(); range.selectNodeContents(element); return new Set(Array.from(range.getClientRects(), r => Math.round(r.top))).size; };
        const wrapped = Array.from(document.querySelectorAll<HTMLElement>('.field-actions button')).filter(b => b.getClientRects().length && lines(b) > 1).map(b => b.textContent);
        const menu = document.getElementById('menu-button')!.getBoundingClientRect(), panel = document.getElementById('panel')!.getBoundingClientRect();
        const open = document.getElementById('drawer-layer')!.dataset.state === 'open';
        const overlap = open && menu.left < panel.right && menu.right > panel.left && menu.top < panel.bottom && menu.bottom > panel.top;
        // Последняя видимая кнопка действий доходит до правого края сетки: в последнем ряду нет дыры.
        const actions = document.querySelector('.field-actions')!, visible = Array.from(actions.querySelectorAll<HTMLElement>('button')).filter(b => b.getClientRects().length);
        const hole = visible.length > 0 && Math.abs(visible.at(-1)!.getBoundingClientRect().right - actions.getBoundingClientRect().right) > 1;
        // Сдвинутая тень правых карточек каталога помещается в окно прокрутки.
        const content = document.querySelector('#panel .panel-content')?.getBoundingClientRect(), cards = Array.from(document.querySelectorAll('#panel .catalog-grid button'), b => b.getBoundingClientRect().right);
        const shadowCut = !!content && cards.length > 0 && Math.max(...cards) + .1875 * font > content.right + .5;
        return { wrapped, overlap, hole, shadowCut, headerHeight: document.querySelector('header > div')!.getBoundingClientRect().height / font };
      });
      assert.equal(layout.hole, false, `${profile.id}/${name}: в последнем ряду кнопок поля пустая ячейка`);
      assert.equal(layout.shadowCut, false, `${profile.id}/${name}: тень карточки каталога обрезана`);
      if (profile.width >= 1920) assert.deepEqual(layout.wrapped, [], `${profile.id}/${name}: подпись кнопки поля в несколько строк`);
      if (profile.width >= 600 && metrics.drawerOpen) assert.equal(layout.overlap, false, `${profile.id}/${name}: панель закрывает кнопку «Меню»`);
      if (profile.height <= 540 && profile.width > profile.height) assert.ok(layout.headerHeight <= 3.75, `${profile.id}/${name}: шапка ${layout.headerHeight.toFixed(2)}rem выше 3,75rem`);
      assert.equal(metrics.canvasPixels[0], metrics.canvasCss[0]);
      assert.equal(metrics.canvasPixels[1], metrics.canvasCss[1]);
      } catch (error) {
        // Состояние без обычного снимка при отказе проверки всё равно фиксируется для разбора.
        if (!shot) await page.screenshot({ path: resolve(output, `${profile.id}-${name}-failure.png`) });
        throw error;
      }
      if (shot) report.pngHashes[filename] = await hashFile(resolve(output, filename));
      states.push(name);
      checks.push({ name, ...metrics, normalReading });
      if (metrics.drawerOpen) {
        const textStyle = await page.addStyleTag({ content: 'html { font-size: max(200%, 0.8333333333vw) !important; }' });
        try { readingProbes.push({ name, ...await checkPanelReading(page) as object }); }
        catch (error) {
          const failed = `${profile.id}-${name}-text200-failure.png`;
          await page.screenshot({ path: resolve(output, failed) });
          report.pngHashes[failed] = await hashFile(resolve(output, failed));
          throw error;
        }
        if (name.startsWith('orders-object-module-') || ['object', 'growth-card', 'ripe-wilt-card', 'corrupt-current', 'orders-offers', 'orders-pending', 'orders-victory','orders-module-choice','orders-modules','orders-module-target','orders-events','orders-spend-confirm','orders-p1-catalog','orders-p1-object','orders-shop-locked','orders-shop-funded','orders-shop-all','orders-shop-season','orders-expanded-catalog','orders-parallel','orders-two-events','orders-tutorial-care','orders-tutorial-cut'].includes(name)) {
          for (const end of [false, true]) {
            if(end)await page.evaluate(()=>{const body=document.getElementById('panel-body')!,content=body.querySelector<HTMLElement>('.panel-content')!,scroll=body.dataset.scroll==='all'?body:content;scroll.scrollTop=scroll.scrollHeight;});
            if (!key && !allPng) continue;
            const enlarged = `${profile.id}-${name}-text200${end ? '-bottom' : ''}.png`;
            await page.screenshot({ path: resolve(output, enlarged) });
            report.pngHashes[enlarged] = await hashFile(resolve(output, enlarged));
          }
        }
        await textStyle.evaluate(style => (style as HTMLStyleElement).remove());
        await page.evaluate(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          for (const element of document.querySelectorAll('#panel-body, .panel-content, #panel')) { element.scrollTop = 0; element.scrollLeft = 0; }
        });
      }
      // Поле при тексте 200%: слова подписей не рвутся, панель поля не заходит на шапку, «Меню» в экране.
      if (!metrics.drawerOpen && await page.locator('#field-tools').isVisible()) {
        const textStyle = await page.addStyleTag({ content: 'html { font-size: max(200%, 0.8333333333vw) !important; }' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const field200 = await page.evaluate(() => {
          const split: string[] = [];
          for (const element of document.querySelectorAll('#field-tools button, #field-tools .stock-status, #placement-status, #menu-button, #season-status')) {
            if (!element.getClientRects().length) continue;
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const match of node.textContent!.matchAll(/\S+/g)) {
              const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
              if (new Set(Array.from(range.getClientRects(), r => Math.round(r.top))).size > 1) split.push(match[0]);
            }
          }
          const header = Math.max(...Array.from(document.querySelectorAll('header > div, #menu-button'), element => element.getBoundingClientRect().bottom));
          const menu = document.getElementById('menu-button')!.getBoundingClientRect();
          return { split, tools: document.getElementById('field-tools')!.getBoundingClientRect().top, header, menu: menu.left >= 0 && menu.right <= innerWidth };
        });
        if (['workshop', 'full-field'].includes(name) && (key || allPng)) for (const end of [false, true]) {
          if (end) await page.locator('#field-tools').evaluate(element => { element.scrollTop = element.scrollHeight; });
          const enlarged = `${profile.id}-${name}-text200${end ? '-bottom' : ''}.png`;
          await page.screenshot({ path: resolve(output, enlarged) });
          report.pngHashes[enlarged] = await hashFile(resolve(output, enlarged));
        }
        await textStyle.evaluate(style => (style as HTMLStyleElement).remove());
        await page.evaluate(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          document.getElementById('field-tools')!.scrollTop = 0;
        });
        assert.deepEqual(field200.split, [], `${profile.id}/${name}: при тексте 200% слово разорвано`);
        assert.ok(field200.tools >= field200.header, `${profile.id}/${name}: при тексте 200% панель поля заходит на шапку: ${JSON.stringify(field200)}`);
        assert.equal(field200.menu, true, `${profile.id}/${name}: при тексте 200% «Меню» за краем`);
      }
    };
    await page.goto(url);
    await ready(page);
    assert.ok(await page.locator('[data-action="start"]').isEnabled());
    await capture('menu');
    assert.equal(await page.locator('.controls-help').isVisible(),true,'управление доступно в обычном меню');
    assert.ok((await page.locator('.controls-help').textContent())!.includes(profile.touch?'двумя пальцами':'WASD'));
    await click(page, 'start');
    assert.equal(await page.locator('#next-day-button').isDisabled(),true,'без активного заказа день заблокирован');
    assert.equal(await page.locator('#stock-status').textContent(),'Срезано · Гвоздики: 0 · Хризантемы: 0');
    await capture('workshop');
    await toolbar(page,'catalog-button');await capture('catalog');
    await click(page,'pick-carnation');
    await tapCell(page,{q:0,r:0});await capture('placed');
    assert.deepEqual((await layout(page) as {objects:unknown[]}).objects,[{kind:'carnation',q:0,r:0,adaptation:0}]);
    // Обычное нажатие на объект открывает карточку; отмена удаления не пишет ни одной копии.
    await tapCell(page,{q:0,r:0});await capture('object');
    await click(page,'remove-confirm');await capture('remove-confirm');
    const beforeRemoveCancel=await page.evaluate(([a,b])=>[localStorage.getItem(a!),localStorage.getItem(b!)],[currentKey,previousKey]);
    await click(page,'object');await click(page,'continue');
    assert.deepEqual(await page.evaluate(([a,b])=>[localStorage.getItem(a!),localStorage.getItem(b!)],[currentKey,previousKey]),beforeRemoveCancel);
    await dragCell(page,{q:0,r:0},{q:1,r:0});await capture('moved');
    assert.deepEqual((await layout(page) as {objects:unknown[]}).objects,[{kind:'carnation',q:1,r:0,adaptation:1}]);
    await page.reload();await ready(page);await toolbar(page,'undo-button');await capture('undo-reloaded');
    assert.deepEqual((await layout(page) as {objects:unknown[]}).objects,[{kind:'carnation',q:0,r:0,adaptation:0}]);
    assert.equal(await page.locator('#undo-button').isDisabled(),true);
    await tapCell(page,{q:0,r:0});await click(page,'move-object');
    await failWrites(page);await tapCell(page,{q:-1,r:0});await capture('placement-error');
    const failedState=await page.locator('#season-status').textContent();
    await page.keyboard.press('Escape');await settled(page);assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'),'open');
    await restoreWrites(page);await click(page,'retry-save');
    assert.equal(await page.locator('#season-status').textContent(),failedState);
    assert.deepEqual((await layout(page) as {objects:unknown[]}).objects,[{kind:'carnation',q:-1,r:0,adaptation:1}]);
    // Подтверждённое удаление и undo после reload возвращают тот же объект с адаптацией.
    await tapCell(page,{q:-1,r:0});await click(page,'remove-confirm');await click(page,'remove');
    assert.deepEqual((await layout(page) as {objects:unknown[]}).objects,[]);
    await page.reload();await ready(page);await toolbar(page,'undo-button');
    assert.deepEqual((await layout(page) as {objects:unknown[]}).objects,[{kind:'carnation',q:-1,r:0,adaptation:1}]);
    // Пиксельные проверки камеры и подсветки - на неподвижном поле: без покачивания и струй.
    await page.emulateMedia({reducedMotion:'reduce'});
    if(!profile.touch)await keyboardCamera(page);
    await toolbar(page,'catalog-button');await click(page,'pick-lamp');
    const beforeCamera=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    const beforeCameraPixels=await canvasHash(page);
    if(profile.touch){
      const session=await context.newCDPSession(page);
      const p=await fieldPoint(page,{q:0,r:0});
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x-35,y:p.y,id:1}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x-35,y:p.y,id:1},{x:p.x+35,y:p.y,id:2}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x-65,y:p.y+12,id:1},{x:p.x+65,y:p.y+12,id:2}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
    }else{
      const p=await fieldPoint(page,{q:0,r:0});await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,-360);await page.waitForTimeout(100);
      await page.mouse.down({button:'middle'});await page.mouse.move(p.x+30,p.y+20,{steps:4});await page.mouse.up({button:'middle'});
      await page.locator('canvas').focus();await page.keyboard.down('ArrowRight');await page.waitForTimeout(100);await page.keyboard.up('ArrowRight');
    }
    await capture('camera-gesture');assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),beforeCamera);
    assert.notEqual(await canvasHash(page),beforeCameraPixels,'жест действительно изменяет отображение камеры');
    await toolbar(page,'overview-button');
    assert.equal(await canvasHash(page),beforeCameraPixels,'обзор возвращает исходную камеру');
    const previewPoint=await fieldPoint(page,{q:0,r:0});
    if(profile.touch){
      const session=await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...previewPoint,id:1}]});
      await capture('zone-preview');
      await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await session.detach();
    }else{
      await page.mouse.move(previewPoint.x,previewPoint.y);await page.mouse.down();await capture('zone-preview');
      await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();
    }
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),beforeCamera,'отмена указателя не ставит объект');
    await toolbar(page,'cancel-placement');
    // Меню, открытое во время удержания/переноса, отменяет жест; оставшийся click его не закроет.
    const held=await fieldPoint(page,{q:-1,r:0});
    const heldSession=profile.touch?await context.newCDPSession(page):null;
    if(heldSession){
      await heldSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...held,id:1}]});
      await heldSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:held.x+9,y:held.y,id:1}]});
    }else{await page.mouse.move(held.x,held.y);await page.mouse.down();await page.mouse.move(held.x+9,held.y);}
    await page.keyboard.press('Escape');
    if(heldSession){await heldSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await heldSession.detach();}else await page.mouse.up();
    await settled(page);assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'),'open');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),beforeCamera);
    if(profile.touch)await page.locator('#drawer-close').tap();else await page.locator('#drawer-close').click();
    await settled(page);
    // Четыре типа размещаются через настоящий каталог, без подстановки игрового состояния.
    for(const [kind,cell] of [['lamp',{q:0,r:0}],['sprinkler',{q:1,r:0}],['chrysanthemum',{q:0,r:1}]] as const){
      if(await page.locator('#cancel-placement').isVisible())await toolbar(page,'cancel-placement');
      await toolbar(page,'catalog-button');await click(page,`pick-${kind}`);await tapCell(page,cell);
    }
    await capture('equipped');
    assert.equal((await layout(page) as {objects:unknown[]}).objects.length,4);
    await toolbar(page,'cancel-placement');
    await tapCell(page,{q:-1,r:0});
    assert.ok((await page.locator('.plant-conditions').textContent())!.includes('Свет: есть · 💧 Полив: нет'));
    assert.ok((await page.locator('.panel-content').textContent())!.includes('Адаптация · 1 день'));
    await capture('conditions-card');await click(page,'continue');
    await tapCell(page,{q:0,r:1});
    assert.ok((await page.locator('.plant-conditions').textContent())!.includes('Свет: есть · 💧 Полив: есть'));
    await click(page,'continue');
    // Подсветка собственной и верхней соседней клетки не меняет ни одного пикселя лепестков.
    const flower=await fieldPoint(page,{q:-1,r:0}),next=await fieldPoint(page,{q:0,r:0});
    const zoom=(next.x-flower.x)/(Math.sqrt(3)*40);
    // Увеличиваем значок перед чтением пикселя: в коротком landscape его просвет
    // меньше пикселя, и сглаживание смешивает фон с соседней каплей/обводкой.
    const waterPoint=await fieldPoint(page,{q:0,r:1});
    const fit=await fieldView(page);
    await page.evaluate(()=>{
      (window as unknown as Record<string,unknown>).__badgeWheel=null;
      document.querySelector('canvas')!.addEventListener('wheel',event=>{
        (window as unknown as Record<string,unknown>).__badgeWheel={delta:event.deltaY,anchor:{x:event.clientX,y:event.clientY}};
      },{once:true});
    });
    await page.mouse.move(waterPoint.x,waterPoint.y);await page.mouse.wheel(0,-6000);
    await page.waitForFunction(()=>(window as unknown as Record<string,unknown>).__badgeWheel!==null);
    const wheel=await page.evaluate(()=>(window as unknown as {__badgeWheel:{delta:number;anchor:{x:number;y:number}}}).__badgeWheel);
    const enlarged=zoomField(fit,Math.exp(-wheel.delta*.0015),wheel.anchor);
    assert.ok(enlarged.zoom>=1.5,'увеличение достаточно для чтения пикселя');
    // Курсор уводим с клетки: подсветка наведения лежит поверх контура зоны.
    await page.mouse.move(1,profile.height-1);
    await canvasHash(page);
    // Свет и полив сразу - жёлто-голубая зебра контура. Точка - на голубом отрезке
    // правой грани (второй из четырёх), между внешним и внутренним шестиугольником.
    const zebra=(()=>{
      const c=cellCenter({q:0,r:1}),k=cellCorners({q:0,r:1}),at=(i:number,t:number)=>({x:c.x+(k[i]!.x-c.x)*t,y:c.y+(k[i]!.y-c.y)*t});
      const a=at(0,.765),b=at(1,.765);return toScreen(enlarged,{x:a.x+(b.x-a.x)*.375,y:a.y+(b.y-a.y)*.375});
    })();
    const waterBand=await page.locator('canvas').evaluate((canvas,p)=>Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(Math.round(p.x),Math.round(p.y),1,1).data),zebra);
    assert.deepEqual(waterBand,[79,159,176,255],'клетка со светом и поливом обведена жёлто-голубой зеброй');
    await toolbar(page,'overview-button');
    const sample=async()=>{
      await canvasHash(page);
      return page.locator('canvas').evaluate((canvas,{flower,zoom})=>{
        const context=(canvas as HTMLCanvasElement).getContext('2d')!;
        const x=Math.round(flower.x-30*zoom),y=Math.round(flower.y-90*zoom),w=Math.ceil(60*zoom),h=Math.ceil(100*zoom);
        const pixels=context.getImageData(x,y,w,h).data;
        return Array.from(pixels);
      },{flower,zoom});
    };
    const petals=await sample();
    const flowerPixels:number[]=[];
    for(let i=0;i<petals.length;i+=4)if((petals[i]===205&&petals[i+1]===104&&petals[i+2]===118)
      || (petals[i]===247&&petals[i+1]===231&&petals[i+2]===167))flowerPixels.push(i);
    assert.ok(flowerPixels.length>20,`выбраны реальные пиксели цветка: ${profile.id}, найдено ${flowerPixels.length}, zoom ${zoom}`);
    const deviceGround=await page.locator('canvas').evaluate((canvas,{p,zoom})=>Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(Math.round(p.x+22*zoom),Math.round(p.y+8*zoom),1,1).data),{p:await fieldPoint(page,{q:1,r:0}),zoom});
    const hover=async(cell:Cell,name:string)=>{
      const p=await fieldPoint(page,cell);
      const session=profile.touch?await context.newCDPSession(page):null;
      if(session)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
      else await page.mouse.move(p.x,p.y);
      await capture(name);
      if(name.startsWith('hover-')){
        const hovered=await sample();
        assert.ok(flowerPixels.every(i=>petals.slice(i,i+4).every((value,j)=>hovered[i+j]===value)),`${name}: подсветка закрасила цветок`);
      }
      if(name==='lamp-zone'){
        const p=await fieldPoint(page,{q:1,r:0});
        const current=await page.locator('canvas').evaluate((canvas,{p,zoom})=>Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(Math.round(p.x+22*zoom),Math.round(p.y+8*zoom),1,1).data),{p,zoom});
        assert.deepEqual(current,deviceGround,'зона лампы не окрашивает клетку поливателя');
      }
      if(session){await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await session.detach();}
      else await page.mouse.move(1,profile.height-1);
    };
    await hover({q:-1,r:0},'hover-flower');await hover({q:-1,r:-1},'hover-neighbor');
    await hover({q:0,r:0},'lamp-zone');await hover({q:1,r:0},'sprinkler-zone');
    await page.emulateMedia({reducedMotion:'no-preference'});
    // ПКМ работает и при подключённой мыши на touch-профиле. Отмена не откатывает посадку.
    const copiesBeforeContext=await page.evaluate(([a,b])=>[localStorage.getItem(a!),localStorage.getItem(b!)],[currentKey,previousKey]);
    const initialObjects=(await layout(page) as {objects:unknown[]}).objects;
    const empty=await fieldPoint(page,{q:-2,r:0});
    const rightEmpty=async()=>{await page.mouse.click(empty.x,empty.y,{button:'right'});await settled(page);};
    await toolbar(page,'catalog-button');await click(page,'pick-carnation');
    await rightEmpty();assert.equal(await page.locator('#cancel-placement').isVisible(),false);
    await capture('right-cancel');
    assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'),'closed');
    await rightEmpty();await capture('context-catalog');
    assert.ok((await page.locator('.catalog-note').textContent())!.includes('на выбранную клетку'));
    await page.keyboard.press('Escape');await settled(page);
    assert.deepEqual(await page.evaluate(([a,b])=>[localStorage.getItem(a!),localStorage.getItem(b!)],[currentKey,previousKey]),copiesBeforeContext);
    await page.mouse.click(flower.x,flower.y,{button:'right'});await settled(page);
    assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'),'closed','ПКМ по занятой клетке ничего не размещает');
    await rightEmpty();await click(page,'pick-chrysanthemum');await capture('context-placed');
    assert.deepEqual((await layout(page) as {objects:unknown[]}).objects,[...initialObjects,{kind:'chrysanthemum',q:-2,r:0,adaptation:0}]);
    const contextual=JSON.parse((await page.evaluate(key=>localStorage.getItem(key),currentKey))!);
    assert.equal(contextual.revision,JSON.parse(copiesBeforeContext[0]!).revision+1,'ровно одна запись на выбор предмета');
    assert.equal(await page.locator('#cancel-placement').isVisible(),false);
    await toolbar(page,'undo-button');
    assert.deepEqual((await layout(page) as {objects:unknown[]}).objects,initialObjects);
    await rightEmpty();await page.keyboard.press('Escape');await settled(page);
    const noWrite=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    await toolbar(page,'catalog-button');await click(page,'pick-carnation');
    assert.equal(await page.locator('#cancel-placement').isVisible(),true,'обычный каталог не использует старую клетку ПКМ');
    await rightEmpty();
    await tapCell(page,{q:-1,r:0});await click(page,'move-object');
    await rightEmpty();await page.mouse.click(empty.x,empty.y);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),noWrite,'ПКМ отменяет перенос без записи');
    // ПКМ во время удерживаемого переноса не допускает drop при отпускании ЛКМ.
    await page.mouse.move(flower.x,flower.y);await page.mouse.down();await page.mouse.move(empty.x,empty.y,{steps:4});
    await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.mouse.up();await settled(page);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),noWrite);
    if(await page.locator('#drawer-layer').getAttribute('data-state')==='open')await page.keyboard.press('Escape');
    await settled(page);
    await toolbar(page,'catalog-button');await click(page,'pick-carnation');
    const occupied=(await layout(page) as {objects:Cell[]}).objects;
    for(const cell of fieldCells(19))if(!occupied.some(o=>sameCell(o,cell)))await tapCell(page,cell);
    await capture('full-field');
    assert.equal((await layout(page) as {objects:unknown[]}).objects.length,19);
    await toolbar(page,'cancel-placement');
    if(profile.touch){
      await click(page,'menu');await page.locator('#drawer-debug').tap();await page.locator('#drawer-close').tap();await settled(page);
    }else await page.keyboard.press('F3');
    await page.waitForTimeout(1000);
    const fieldF3=await page.locator('#debug').textContent();
    assert.equal(await page.locator('#debug').isVisible(),true);
    assert.equal(await page.locator('#debug').evaluate(debug=>{
      const bounds=debug.getBoundingClientRect(),hud=document.getElementById('field-tools')!.getBoundingClientRect();
      return bounds.top>=0&&bounds.bottom<=hud.top;
    }),true,'F3 помещается над HUD, не перекрывая запас и действия');
    await capture('field-f3');await page.keyboard.press('F3');
    const beforeRotation=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    await page.setViewportSize({width:profile.height,height:profile.width});await page.waitForTimeout(150);
    await toolbar(page,'overview-button');await tapCell(page,{q:-1,r:0});
    await page.getByRole('heading',{name:'Гвоздика',exact:true}).waitFor();await click(page,'continue');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),beforeRotation,'поворот и выбор объекта не меняют расстановку');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:profile.width,height:profile.height});await page.waitForTimeout(150);
    const original = await page.evaluate(key => localStorage.getItem(key), currentKey);
    assert.ok(original);
    await page.reload();
    await ready(page);
    await page.getByRole('heading', { name: 'День 1 · Подготовка' }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), currentKey), original);
    await click(page, 'menu');
    await click(page, 'settings');
    if (profile.touch) await page.locator('label:has(#tutorial)').tap();
    else await page.locator('label:has(#tutorial)').click();
    await page.locator('#app[aria-busy="false"]').waitFor();
    await page.reload();
    await ready(page);
    await click(page, 'menu');
    await click(page, 'settings');
    assert.equal(await page.locator('#tutorial').isChecked(), false);
    await capture('settings');
    await click(page, 'menu');
    await click(page, 'recovery');
    await capture('recovery');
    await click(page, 'restore-confirm');
    await capture('restore-confirm');
    const beforeCancel = await page.evaluate(([a, b]) => [localStorage.getItem(a!), localStorage.getItem(b!)], [currentKey, previousKey]);
    await page.keyboard.press('Escape'); await settled(page);
    assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'), 'closed');
    assert.deepEqual(await page.evaluate(([a, b]) => [localStorage.getItem(a!), localStorage.getItem(b!)], [currentKey, previousKey]), beforeCancel);
    await click(page, 'menu'); await click(page, 'recovery'); await click(page, 'restore-confirm');
    await click(page, 'restore');
    await click(page, 'menu');
    await click(page, 'settings');
    assert.equal(await page.locator('#tutorial').isChecked(), true);
    // Сбой записи уже после успешной ротации, без тестовых API в игре.
    await failWrites(page);
    if (profile.touch) await page.locator('label:has(#motion)').tap();
    else await page.locator('label:has(#motion)').click();
    await page.locator('[data-action="retry-save"]').waitFor();
    await capture('save-error');
    await page.keyboard.press('Escape'); await settled(page);
    assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'), 'open', 'ошибка записи сохраняет обязательную паузу');
    await restoreWrites(page);
    await click(page, 'retry-save');
    await page.locator('#motion').waitFor();
    assert.equal(await page.locator('#motion').isChecked(), true);
    const saved = await page.evaluate(key => localStorage.getItem(key), currentKey);
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), currentKey), saved);
    // Основной повреждён: резерв можно открыть только через подтверждение.
    await page.evaluate(key => localStorage.setItem(key, '{сломано'), currentKey);
    await page.reload(); await ready(page);
    await capture('corrupt-current');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), currentKey), '{сломано');
    await click(page, 'restore-confirm');
    await failWrites(page);
    await click(page, 'restore');
    await capture('restore-save-error');
    await restoreWrites(page);
    await click(page, 'retry-save');
    await page.getByRole('heading', { name: 'День 1 · Подготовка' }).waitFor();
    // Обе копии повреждены: до явного подтверждения ничего не записывается.
    await page.evaluate(([a, b]) => { localStorage.setItem(a!, '{сломано'); localStorage.setItem(b!, '{сломано'); }, [currentKey, previousKey]);
    await page.reload(); await ready(page);
    await capture('corrupt-both');
    await click(page, 'recheck');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), currentKey), '{сломано');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), previousKey), '{сломано');
    await click(page, 'reset-confirm');
    await capture('reset-confirm');
    await page.keyboard.press('Escape'); await settled(page);
    await page.getByRole('heading', { name: 'Восстановление', exact: true }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), currentKey), '{сломано');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), previousKey), '{сломано');
    await click(page, 'reset-confirm');
    await click(page, 'reset');
    await page.locator('[data-action="start"]').waitFor();
    // SDK init повторно проверяет Storage; отказ probe моделирует persistent: false.
    await failWrites(page, true);
    await click(page, 'recovery'); await click(page, 'recheck');
    await capture('nonpersistent');
    assert.equal(await page.locator('[data-action="start"]').count(), 0);
    await click(page, 'recovery');
    await capture('nonpersistent-recovery');
    await restoreWrites(page);
    await click(page, 'recheck');
    await page.locator('[data-action="start"]').waitFor();
    if (profile.touch) await page.locator('#drawer-debug').tap();
    else await page.keyboard.press('F3');
    await page.waitForTimeout(700);
    const f3 = await page.locator('#debug').textContent();
    await capture('f3');
    if (profile.touch) await page.locator('#drawer-debug').tap();
    else await page.keyboard.press('F3');
    const unchanged = await page.evaluate(key => localStorage.getItem(key), currentKey);
    const fieldBefore = await page.locator('canvas').boundingBox();
    if (profile.touch) await page.locator('#drawer-close').tap();
    else await page.locator('#drawer-close').click();
    await settled(page);
    await capture('menu-closed');
    assert.equal(await page.locator('#menu-button').getAttribute('aria-expanded'), 'false');
    // Измеряем середину эффекта по времени Animation API; игровой код не инструментируется.
    const motion = await page.evaluate(() => {
      document.getElementById('menu-button')!.click();
      const panel = document.getElementById('panel')!;
      const animations = [...panel.getAnimations(), ...document.getElementById('drawer-shade')!.getAnimations()];
      const duration = Number(animations[0]?.effect?.getTiming().duration);
      for (const animation of animations) { animation.pause(); animation.currentTime = duration / 2; }
      const sample = { duration, left: panel.getBoundingClientRect().left, width: panel.getBoundingClientRect().width, opacity: Number(getComputedStyle(panel).opacity), blocked: (document.getElementById('world') as HTMLElement).inert };
      for (const animation of animations) animation.play();
      return sample;
    });
    assert.equal(motion.duration, 240);
    assert.ok(motion.left < 0 && motion.left > -motion.width);
    assert.ok(motion.opacity > 0 && motion.opacity < 1);
    assert.equal(motion.blocked, true);
    await settled(page);
    assert.deepEqual(await page.locator('canvas').boundingBox(), fieldBefore, 'меню не изменяет размер или положение поля');
    await page.locator('#drawer-debug').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.getElementById('panel')!.contains(document.activeElement)), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'drawer-debug');
    await page.evaluate(() => {
      const probe = { hits: 0, closing: '', blockedDuringClose: false };
      (window as unknown as { drawerProbe: typeof probe }).drawerProbe = probe;
      document.getElementById('stage')!.addEventListener('pointerdown', () => { probe.hits++; });
      document.addEventListener('click', event => {
        if ((event.target as HTMLElement).id !== 'drawer-shade') return;
        probe.closing = document.getElementById('drawer-layer')!.dataset.state!;
        probe.blockedDuringClose = (document.getElementById('world') as HTMLElement).inert;
      });
    });
    if (profile.touch) await page.touchscreen.tap(profile.width - 3, profile.height / 2);
    else await page.mouse.click(profile.width - 3, profile.height / 2);
    await settled(page);
    const closing = await page.evaluate(() => (window as unknown as { drawerProbe: { hits: number; closing: string; blockedDuringClose: boolean } }).drawerProbe);
    assert.deepEqual(closing, { hits: 0, closing: 'closing', blockedDuringClose: true });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'menu-button');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), currentKey), unchanged, 'открытие и закрытие не сохраняет игровое действие');
    await click(page, 'menu');
    await page.keyboard.press('Escape');
    await settled(page);
    assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'), 'closed');
    await click(page, 'menu');
    await click(page, 'settings');
    if (profile.touch) await page.locator('label:has(#motion)').tap();
    else await page.locator('label:has(#motion)').click();
    await page.locator('#app[aria-busy="false"]').waitFor();
    assert.equal(await page.locator('#motion').isChecked(), true);
    await capture('reduced-motion');
    if (profile.touch) await page.locator('#drawer-close').tap();
    else await page.locator('#drawer-close').click();
    assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'), 'closed');
    await click(page, 'menu');
    assert.equal(await page.locator('#drawer-layer').getAttribute('data-state'), 'open');
    assert.equal(await page.locator('#panel').evaluate(element => element.getAnimations().filter(a => a.playState === 'running').length), 0);
    await page.setViewportSize({ width: profile.height, height: profile.width });
    await page.waitForTimeout(150);
    await page.getByRole('heading', { name: 'Ваша мастерская' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(Math.abs(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)) - 16 * Math.max(1, profile.height / 1920)) < .02, 'масштаб после resize');
    await page.setViewportSize({width:profile.width,height:profile.height});
    // Новые состояния независимы: в изолированный контекст загружается валидный сейв,
    // подготовленный теми же чистыми правилами. Обычный календарь не обходится в игре.
    const install=async(state:GameState)=>{
      if(state.season&&(state.season.events.requests.some(r=>r.status==='scheduled'&&r.day<=state.season!.day)||state.season!.day>10&&!state.season!.events.fair.closed))state={...state,season:{...state.season!,events:startEvents(123,state.season!.day).events}};
      state=refreshStateOffers(state);const record=await encode(state,50);expectedDay=state.season?.day??1;
      await page.evaluate(({record,currentKey,previousKey})=>{localStorage.setItem(currentKey,JSON.stringify(record));localStorage.removeItem(previousKey);},{record,currentKey,previousKey});
      await page.reload();await ready(page);
      assert.equal(await page.locator('#next-day-button').isDisabled(),!state.season?.board.active.length || !!state.season?.board.pending || !!state.season?.board.result);
      assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).revision,currentKey),50,'чтение не пишет сейв');
    };
    const savedState=async():Promise<GameState>=>page.evaluate(key=>JSON.parse(JSON.parse(localStorage.getItem(key)!).payload),currentKey);
    const panelAction=async(name:string)=>{
      await page.locator(`#panel [data-action="${name}"]`).scrollIntoViewIfNeeded();
      await click(page,name);
    };
    const stageOne=enterGrowthDay(growthFixture());
    if(!full){
      // Ключевые экраны без прохождения: каждое состояние - готовый валидный сейв из фикстур.
      // Пропущено в key (достижимо только прохождением или несколькими нажатиями поверх сейва;
      // логику закрывают юнит-тесты, полный сценарий - BOUQUET_SCOPE=full): отказ/повтор записи
      // на срезке, сдаче, выборе, магазине и установке модуля; реальная сдача заказа до pending;
      // двойное событие срезки; увядание/гибель/восстановление/адаптация; поворот карточки; рост 21.
      await install(stageOne);await tapCell(page,{q:0,r:0});await capture('growth-card');
      await click(page,'continue');await toolbar(page,'overview-button');
      // Очередь уведомлений: тот же сценарий, что и в full, на готовом сейве.
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
      await click(page,'menu');
      await page.evaluate(()=>{
        Object.defineProperty(screen,'width',{configurable:true,value:innerWidth+100});
        Object.defineProperty(screen,'height',{configurable:true,value:innerHeight+100});
        document.documentElement.requestFullscreen=async()=>{throw new Error((window as unknown as {noticeMessage:string}).noticeMessage);};
      });
      for(const letter of ['A','B','C','D']){
        await page.evaluate(message=>{(window as unknown as {noticeMessage:string}).noticeMessage=message;},`Нет доступа к полному экрану (${letter}).`);
        await click(page,'fullscreen');
      }
      assert.equal(await page.locator('#notice .notice').count(),3,'очередь ограничена тремя сообщениями');
      await click(page,'settings');await click(page,'menu');
      assert.equal(await page.locator('#notice .notice').count(),3,'перерисовка меню сохраняет очередь');
      await page.clock.resume();
      await capture('notice-queue');await click(page,'continue');
      await page.emulateMedia({reducedMotion:'no-preference'});
      const planted=plantedOrderFixture();await install(planted.state);
      await toolbar(page,'orders-button');await capture('orders-offers');
      await install(moduleRewardFixture());await capture('orders-module-choice');
      await install(eventFixture());await toolbar(page,'orders-button');await panelAction('events');await capture('orders-events');
      await install(moduleFixture());await toolbar(page,'orders-button');await panelAction('modules');await capture('orders-modules');
      await panelAction('module-1');await capture('orders-module-target');
      const risk=eventFixture(20,'U1',9);risk.season!.garden.stock.chrysanthemum=0;
      risk.season!.board.active=[{...risk.season!.board.active[0]!,...orderCandidates(1,15)[0]!,id:20}];risk.season!.board.completed=[];risk.profile.experience=0;risk.profile.progress.main=0;
      await install(risk);await toolbar(page,'orders-button');await panelAction('events');await panelAction('urgent-accept-1');
      await panelAction('urgent-submit-1');await capture('orders-spend-confirm');
      const funded=newProfile();funded.profile.coins=1000;funded.profile.experience=600;
      await install(funded);await panelAction('shop');await capture('orders-shop-funded');
      const finals=orderFixture(5,20,100);await install(finals);await toolbar(page,'orders-button');
      const finalId=finals.season!.board.offers[0]!.id;
      await panelAction(`accept-${finalId}`);await toolbar(page,'orders-button');await panelAction(`deliver-${finalId}`);await capture('orders-victory');
      assert.equal((await savedState()).season!.board.result!.outcome,'win');
      await install(activeOrderFixture(2,20,15));await toolbar(page,'next-day-button');await capture('orders-calendar-loss');
      await install(orderFixture(0,20));await toolbar(page,'orders-button');await panelAction('surrender-confirm');await capture('orders-surrender-confirm');
      await install(startSeason(newProfile(),123));await toolbar(page,'tutorial-button');await capture('orders-tutorial-accept');
    }
    if(full){
    const ripe=enterGrowthDay(stageOne);
    await install(stageOne);await capture('growth-board');await tapCell(page,{q:0,r:0});await capture('growth-card');
    assert.ok((await page.locator('.plant-growth').textContent())!.includes('Рост: 2 / 4'));
    assert.equal(await page.locator('[data-action="harvest"]').isDisabled(),true);
    await install(ripe);await capture('ready-board');
    await dragCell(page,{q:0,r:0},{q:1,r:-1});await tapCell(page,{q:1,r:-1});await capture('grown-moved-card');
    assert.ok((await page.locator('.plant-growth').textContent())!.includes('Готово к срезке: 3'));
    const movedCrop=(await savedState()).season!.garden.plants.find(p=>sameCell(p,{q:1,r:-1}))!;
    assert.equal(movedCrop.growth,8);assert.equal(movedCrop.yield,3);
    await click(page,'continue');await page.reload();await ready(page);await toolbar(page,'undo-button');
    assert.deepEqual((await savedState()).season!.garden,ripe.season!.garden,'reload/undo возвращают полный цикл');
    await tapCell(page,{q:0,r:0});await capture('ready-card');await click(page,'harvest');await capture('harvested-card');
    assert.equal((await savedState()).season!.garden.stock.carnation,3);
    assert.equal(await page.locator('[data-action="harvest"]').isDisabled(),true);
    assert.equal(await page.locator('#undo-button').isDisabled(),true);
    await click(page,'continue');await capture('harvested-board');await page.reload();await ready(page);
    assert.equal((await savedState()).season!.garden.stock.carnation,3);
    assert.ok((await page.locator('#stock-status').textContent())!.includes('Гвоздики: 3'));
    await install(ripe);await tapCell(page,{q:0,r:0});await failWrites(page);await click(page,'harvest');await capture('harvest-save-error');
    assert.equal((await savedState()).season!.garden.stock.carnation,0,'ошибка не подтверждает запись запаса');
    await restoreWrites(page);await click(page,'retry-save');await capture('harvest-retried-card');
    assert.equal((await savedState()).season!.garden.stock.carnation,3);
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).revision,currentKey),51);
    await install(ripe);await tapCell(page,{q:0,r:0});
    await page.evaluate(()=>{
      (document.querySelector('[data-action="harvest"]') as HTMLButtonElement).click();
      // Второе событие попадает уже в новую кнопку; рабочий флаг обязан его отсечь.
      document.querySelector('[data-action="harvest"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await page.locator('#app[aria-busy="false"]').waitFor();
    assert.equal((await savedState()).season!.garden.stock.carnation,3,'два события не дублируют срезку');
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).revision,currentKey),51);
    let dry=editLayout(startSeason(newProfile(),321),{type:'place',kind:'carnation',to:{q:0,r:0}});
    for(const [board,card] of [['wilt-warning-board','wilt-warning-card'],['wilt-danger-board','wilt-danger-card'],['dead-board','dead-card']] as const){
      dry=enterGrowthDay(dry);await install(dry);await capture(board);await tapCell(page,{q:0,r:0});await capture(card);
      assert.equal(await page.locator('[data-action="harvest"]').isDisabled(),true);
      assert.ok((await page.locator('.plant-health').textContent())!.includes(card==='dead-card'?'не восстановится':`${dry.season!.garden.plants[0]!.wilt} из 3`));
      if(card==='dead-card'){
        assert.ok((await page.locator('.plant-growth').textContent())!.includes('Урожай потерян. Срезка недоступна.'));
        assert.ok(!(await page.locator('.plant-growth').textContent())!.includes('Срезка: 2'));
      }
    }
    const damaged=enterGrowthDay(editLayout(startSeason(newProfile(),44),{type:'place',kind:'carnation',to:{q:0,r:0}}));
    const recovered=enterGrowthDay(editLayout(damaged,{type:'place',kind:'sprinkler',to:{q:1,r:0}}));
    await install(recovered);await capture('recovery-board');await tapCell(page,{q:0,r:0});await capture('recovery-card');
    assert.ok((await page.locator('.plant-health').textContent())!.includes('Восстановление'));
    const adapted=editLayout(stageOne,{type:'move',from:{q:0,r:0},to:{q:1,r:-1}});
    await install(adapted);await capture('adaptation-board');await tapCell(page,{q:1,r:-1});await capture('adaptation-card');
    assert.ok((await page.locator('.plant-health').textContent())!.includes('Адаптация'));
    let ripeWilt=editLayout(ripe,{type:'remove',from:{q:1,r:0}});ripeWilt=enterGrowthDay(enterGrowthDay(ripeWilt));
    await install(ripeWilt);await capture('ripe-wilt-board');await tapCell(page,{q:0,r:0});await capture('ripe-wilt-card');
    assert.equal(await page.locator('[data-action="harvest"]').isEnabled(),true);await click(page,'harvest');
    assert.equal((await savedState()).season!.garden.stock.carnation,3);
    assert.equal((await savedState()).season!.garden.plants[0]!.wilt,2,'срезка не лечит увядание');
    let lastDay=ripe;while(lastDay.season!.day<20)lastDay=enterGrowthDay(lastDay);
    await install(lastDay);await capture('last-day-board');await tapCell(page,{q:0,r:0});await click(page,'harvest');
    assert.equal((await savedState()).season!.day,20);assert.equal((await savedState()).season!.garden.stock.carnation,3);
    // После поворота доступны действия и полный текст новой карточки, а не только заголовок.
    await page.setViewportSize({width:profile.height,height:profile.width});await page.waitForTimeout(150);
    const rotated=await page.locator('#panel').evaluate(panel=>{
      const bounds=panel.getBoundingClientRect(),info=panel.querySelector('.plant-info')!.getBoundingClientRect(),content=panel.querySelector('.panel-content')!.getBoundingClientRect();
      return {buttons:Array.from(panel.querySelectorAll('button')).every(b=>{const r=b.getBoundingClientRect();return r.top>=bounds.top&&r.bottom<=bounds.bottom;}),text:info.bottom<=content.bottom+.5};
    });
    assert.deepEqual(rotated,{buttons:true,text:true});
    await page.setViewportSize({width:profile.width,height:profile.height});await page.waitForTimeout(150);
    await click(page,'continue');await toolbar(page,'overview-button');
    const noticeCopies=await page.evaluate(([a,b])=>[localStorage.getItem(a!),localStorage.getItem(b!)],[currentKey,previousKey]);
    // Хеш канвы сравнивается до и после уведомлений - поле должно стоять неподвижно.
    await page.emulateMedia({reducedMotion:'reduce'});
    const noticeField=await canvasHash(page);
    // Проверки времени - при остановленных часах, время двигает только fastForward: реальная длительность
    // касаний и кликов в полной матрице доходила до секунд и съедала 6-секундный показ. На снимки часы
    // идут: подменённый requestAnimationFrame при паузе не срабатывает.
    await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
    for(let i=0;i<3;i++)await tapCell(page,{q:-2,r:0});
    assert.equal(await page.locator('#notice .notice').count(),1);
    assert.ok((await page.locator('#notice').textContent())!.endsWith('×3'));
    await page.clock.fastForward(5000);await tapCell(page,{q:-2,r:0});await page.clock.fastForward(1500);
    assert.ok((await page.locator('#notice').textContent())!.endsWith('×4'),'повтор продлевает показ ещё на 6 секунд');
    await page.clock.resume();
    // Снимок - после проверки времени: часы идут и в реальном времени, а снимок с проверкой чтения длится дольше секунды.
    await capture('notice-repeat-board');
    await page.clock.fastForward(6500);assert.equal(await page.locator('#notice .notice').count(),0);
    await click(page,'menu');
    // Ошибки настоящего действия UI; подменён только недоступный в headless fullscreen.
    await page.evaluate(()=>{
      Object.defineProperty(screen,'width',{configurable:true,value:innerWidth+100});
      Object.defineProperty(screen,'height',{configurable:true,value:innerHeight+100});
      document.documentElement.requestFullscreen=async()=>{throw new Error((window as unknown as {noticeMessage:string}).noticeMessage);};
    });
    const fullscreenError=async(message:string)=>{
      await page.evaluate(message=>{(window as unknown as {noticeMessage:string}).noticeMessage=message;},message);
      await click(page,'fullscreen');
    };
    await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
    for(const letter of ['A','B','C','D'])await fullscreenError(`Нет доступа к полному экрану (${letter}).`);
    assert.equal(await page.locator('#notice .notice').count(),3,'очередь ограничена тремя сообщениями');
    assert.ok(!(await page.locator('#notice').textContent())!.includes('(A)'),'самое старое сообщение вытесняется');
    await fullscreenError('Нет доступа к полному экрану (D).');
    assert.ok((await page.locator('#notice').textContent())!.endsWith('×2'));
    await click(page,'settings');await click(page,'menu');
    assert.equal(await page.locator('#panel .panel-content #notice').count(),1,'сообщения находятся внутри открытого меню');
    assert.equal(await page.locator('#notice .notice').count(),3,'перерисовка меню сохраняет очередь');
    await page.clock.resume();
    await capture('notice-queue');await click(page,'continue');
    // Положение - до снимка: часы идут и в реальном времени, снимок с проверкой чтения длится секунды.
    assert.equal(await page.locator('#app > #notice').getAttribute('data-dock'),'world');
    const noticeBox=await page.locator('#notice').evaluate(element=>({notice:element.getBoundingClientRect().top,header:document.querySelector('header')!.getBoundingClientRect().bottom,plate:document.querySelector('header > div')!.getBoundingClientRect().bottom,variable:document.getElementById('app')!.style.getPropertyValue('--notice-top')}));
    assert.ok(noticeBox.notice>=noticeBox.header,`уведомления ниже верхней панели: ${JSON.stringify(noticeBox)}`);
    await capture('notice-queue-closed-board');
    await page.clock.fastForward(6500);assert.equal(await page.locator('#notice .notice').count(),0);
    await capture('notice-cleared-board');
    assert.deepEqual(await page.evaluate(([a,b])=>[localStorage.getItem(a!),localStorage.getItem(b!)],[currentKey,previousKey]),noticeCopies,'уведомления не меняют сохранения');
    assert.equal(await canvasHash(page),noticeField,'уведомления не сдвигают игровое поле');
    await page.emulateMedia({reducedMotion:'no-preference'});
    // Этап 4. Новые экраны; поздние ступени — отдельные валидные fixtures.
    // Обычный путь реально принимает заказ, растит, срезает и сдаёт до pending.
    const planted=plantedOrderFixture();await install(planted.state);
    await toolbar(page,'orders-button');await capture('orders-offers');
    const offers=JSON.stringify((await savedState()).season!.board.offers);
    const firstId=planted.state.season!.board.offers[0]!.id;
    await page.reload();await ready(page);await toolbar(page,'orders-button');
    assert.equal(JSON.stringify((await savedState()).season!.board.offers),offers,'reload не меняет состав/срок/RNG предложений');
    await panelAction(`accept-${firstId}`);
    assert.equal(await page.locator('#next-day-button').isDisabled(),false);
    assert.equal(await page.locator('#undo-button').isDisabled(),true,'принятие закрывает предыдущий undo');
    await toolbar(page,'orders-button');await capture('orders-active');await toolbar(page,'drawer-close');
    await failWrites(page);await toolbar(page,'next-day-button');await capture('orders-day-error');
    assert.equal((await savedState()).season!.day,1,'до повтора в хранилище старый день');
    await restoreWrites(page);await click(page,'retry-save');
    assert.equal((await savedState()).season!.day,2);assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).revision,currentKey),52);
    for(let day=3;day<=planted.finishDay;day++)await toolbar(page,'next-day-button');
    // Кнопка «Срезать готовые» живёт на панели поля: счётчик = число готовых растений в сохранении.
    const ripeNow=(await savedState()).season!.garden.plants.filter(p=>p.yield&&p.wilt<3).length,stockSum=async()=>Object.values((await savedState()).season!.garden.stock).reduce((a,b)=>a+b,0);
    const stockBefore=await stockSum();
    assert.ok(ripeNow>0,'к дню сдачи есть готовые растения');
    assert.equal(await page.locator('#harvest-count').textContent(),String(ripeNow),'счётчик равен числу готовых растений');
    assert.equal(await page.locator('#harvest-button').isDisabled(),false,'кнопка срезки активна');
    assert.equal(await page.locator('#harvest-button').getAttribute('aria-label'),`Срезать готовые: ${ripeNow}`);
    const harvestBox=await page.locator('#harvest-button').boundingBox(),rootPx=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize));
    assert.ok(harvestBox!.height>=3*rootPx-.5&&harvestBox!.width>=3*rootPx-.5&&harvestBox!.x>=0&&harvestBox!.x+harvestBox!.width<=profile.width,'кнопка срезки: цель ≥3rem и в экране');
    await toolbar(page,'harvest-button');
    assert.equal(await page.locator('#harvest-count').textContent(),'0','после срезки счётчик 0');
    assert.equal(await page.locator('#harvest-button').isDisabled(),true,'после срезки кнопка выключена');
    assert.ok(await stockSum()>stockBefore,'запас в сохранении вырос');
    await toolbar(page,'orders-button');await capture('orders-ready');
    const deliver=page.locator(`[data-action="deliver-${firstId}"]`);
    assert.equal(await deliver.isDisabled(),false);
    await failWrites(page);
    await deliver.evaluate(button=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
    await page.getByRole('heading',{name:'Прогресс в памяти',exact:true}).waitFor();await capture('orders-submit-error');
    await restoreWrites(page);await click(page,'retry-save');await capture('orders-pending');
    let pendingState=await savedState();assert.ok(pendingState.season!.board.pending);
    assert.equal(pendingState.profile.experience,planted.state.season!.board.offers[0]!.experience);
    assert.equal(pendingState.season!.board.completed.length,1);assert.equal(pendingState.season!.board.offers.length,0);
    assert.equal(await page.locator('#drawer-close').isDisabled(),true);
    const pendingRaw=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    await page.keyboard.press('Escape');await page.reload();await ready(page);
    assert.equal(await page.locator('#panel').getAttribute('data-screen'),'pending');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),pendingRaw);
    await click(page,'menu');await click(page,'continue');assert.equal(await page.locator('#panel').getAttribute('data-screen'),'pending');
    await install(submitOrder(readyOrderFixture(4,15),20));await capture('orders-five-pending');
    assert.equal((await savedState()).season!.board.offers.length,0);
    const finals=orderFixture(5,20,100);await install(finals);await toolbar(page,'orders-button');await capture('orders-final-offers');
    assert.equal(finals.season!.board.offers.length,3);assert.equal(new Set(finals.season!.board.offers.map(o=>o.format)).size,2);
    const finalId=finals.season!.board.offers[0]!.id;
    await panelAction(`accept-${finalId}`);await toolbar(page,'orders-button');await capture('orders-final-active');
    await panelAction(`deliver-${finalId}`);await capture('orders-victory');
    const victory=await savedState();assert.equal(victory.profile.coins,296);assert.equal(victory.profile.experience,196);
    assert.equal(victory.season!.day,20);assert.equal(victory.season!.board.result!.outcome,'win');
    const finalRaw=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    await page.reload();await ready(page);assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),finalRaw);
    await click(page,'start');pendingState=await savedState();assert.equal(pendingState.season!.number,2);assert.equal(pendingState.profile.coins,296);assert.equal(pendingState.season!.day,1);
    await install(activeOrderFixture(2,20,15));await toolbar(page,'next-day-button');await capture('orders-calendar-loss');
    assert.equal((await savedState()).season!.day,20);assert.equal((await savedState()).season!.board.result!.lost,11);
    await install(activeOrderFixture(0,6,1,1));await toolbar(page,'next-day-button');await capture('orders-reputation-loss');
    assert.equal((await savedState()).season!.day,6);assert.equal((await savedState()).season!.reputation,0);
    await install(orderFixture(0,20));await toolbar(page,'orders-button');await capture('orders-empty');
    await panelAction('surrender-confirm');await capture('orders-surrender-confirm');
    await click(page,'orders');assert.equal((await savedState()).season!.board.result,null,'отмена подтверждения не завершает сезон');
    await panelAction('surrender-confirm');await click(page,'surrender');await capture('orders-surrendered');
    assert.equal((await savedState()).season!.board.result!.reason,'surrender');
    const unproven=unprovenOffersFixture();await install(unproven);await toolbar(page,'orders-button');
    const unchangedOffers=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    await panelAction(`accept-${unproven.season!.board.offers[0]!.id}`);
    await capture('orders-unproven');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),unchangedOffers,'отказ не обновляет состав/срок/RNG');
    await panelAction('surrender-confirm');await click(page,'surrender');assert.equal((await savedState()).season!.board.result!.reason,'surrender');
    // Этап 5: выбор/модуль, реальные отказы и повторы, события и общий запас.
    await install(moduleRewardFixture());await capture('orders-module-choice');
    const beforeChoice=await savedState();await failWrites(page);await panelAction('reward-0');await capture('orders-choice-error');
    assert.deepEqual((await savedState()).season!.board.pending,beforeChoice.season!.board.pending);
    await restoreWrites(page);await click(page,'retry-save');
    assert.equal((await savedState()).season!.board.pending,null);assert.equal((await savedState()).season!.effects.modules.length,1);
    await toolbar(page,'orders-button');await panelAction('modules');await capture('orders-modules');
    await panelAction('module-1');await capture('orders-module-target');
    assert.ok((await page.locator('.panel-content').textContent())!.includes('Сначала разместите'));
    await panelAction('continue');await toolbar(page,'catalog-button');await click(page,'pick-carnation');await tapCell(page,{q:0,r:0});
    await toolbar(page,'orders-button');await panelAction('modules');await panelAction('module-1');await panelAction('attach-0,0');await capture('orders-module-installed');
    await page.reload();await ready(page);assert.deepEqual((await savedState()).season!.effects.modules[0]!.at,{q:0,r:0});
    await dragCell(page,{q:0,r:0},{q:1,r:0});assert.deepEqual((await savedState()).season!.effects.modules[0]!.at,{q:1,r:0});
    // Первое касание HUD после переноса, без паузы и повторного нажатия.
    await toolbar(page,'undo-button');assert.deepEqual((await savedState()).season!.effects.modules[0]!.at,{q:0,r:0});
    await toolbar(page,'orders-button');await panelAction('modules');await panelAction('detach-1');await capture('orders-module-detached');
    assert.equal((await savedState()).season!.effects.modules[0]!.at,null);
    await install(moduleFixture());await toolbar(page,'catalog-button');await capture('orders-p1-catalog');
    assert.ok((await page.locator('[data-action="pick-carnation"]').textContent())!.includes('Нужен свет'));
    await panelAction('continue');await tapCell(page,{q:0,r:0});await capture('orders-p1-object');
    assert.ok((await page.locator('.plant-info').textContent())!.includes('Нужен свет'));await panelAction('continue');
    await toolbar(page,'orders-button');await panelAction('modules');await panelAction('module-2');await panelAction('attach-0,-1');
    await panelAction('continue');await page.mouse.move((await fieldPoint(page,{q:0,r:-1})).x,(await fieldPoint(page,{q:0,r:-1})).y);await capture('module-zone-board');
    await install(eventFixture());await toolbar(page,'orders-button');await panelAction('events');await capture('orders-events');
    await panelAction('urgent-accept-1');await capture('orders-events-active');
    await panelAction('urgent-submit-1');await capture('orders-urgent-reward');
    assert.equal((await savedState()).profile.progress.urgent,1);
    const savedMain=(await savedState()).season!.board.active[0]!;
    await panelAction('reward-1');await toolbar(page,'orders-button');await panelAction('events');
    assert.deepEqual((await savedState()).season!.board.active[0],savedMain);
    await panelAction('fair-minimum');await capture('orders-fair-minimum');await panelAction('fair-bonus');await capture('orders-fair-reward');
    await panelAction('reward-1');await toolbar(page,'orders-button');await panelAction('events');await capture('orders-fair-bonus-done');
    assert.equal((await savedState()).season!.events.fair.bonus,true);
    // Установка прямо из карточки: совместимость, перенос, слот и повтор сохранения.
    let objectModules=moduleFixture();objectModules.season!.effects.globals=[];
    objectModules.season!.effects.modules.push({id:3,effect:'P4',at:null});objectModules.season!.effects.nextId=4;assert.ok(isGameState(objectModules));
    await install(objectModules);await tapCell(page,{q:0,r:0});await capture('orders-object-module-card');
    const openedSave=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    await panelAction('object-modules');await capture('orders-object-module-free');
    assert.equal(await page.locator('[data-action="object-module-2"]').count(),0,'устройство не предлагается цветку');
    await panelAction('object');assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),openedSave,'отмена выбора ничего не сохраняет');
    await panelAction('object-modules');await panelAction('object-module-1');await capture('orders-object-module-installed');
    assert.deepEqual((await savedState()).season!.effects.modules[0]!.at,{q:0,r:0});
    await panelAction('object-modules');await capture('orders-object-module-occupied');
    assert.equal(await page.locator('[data-action="object-module-3"]').isDisabled(),true,'занятый слот требует снятия');
    await panelAction('object-detach');assert.equal((await savedState()).season!.effects.modules[0]!.at,null);
    assert.equal(await page.locator('[data-action="object-module-3"]').isEnabled(),true);await panelAction('object-module-3');
    assert.deepEqual((await savedState()).season!.effects.modules[2]!.at,{q:0,r:0});
    await page.reload();await ready(page);await tapCell(page,{q:0,r:0});assert.ok((await page.locator('.panel-content').textContent())!.includes('Смешанная клумба'));
    const sourceModule=installModule(moduleFixture(),1,{q:-1,r:0});await install(sourceModule);await tapCell(page,{q:0,r:0});await panelAction('object-modules');await capture('orders-object-module-transfer');
    assert.ok((await page.locator('.panel-content').textContent())!.includes('прежний объект останется без модуля'));
    await panelAction('object-module-1');assert.deepEqual((await savedState()).season!.effects.modules[0]!.at,{q:0,r:0});
    await install(moduleFixture());await tapCell(page,{q:0,r:-1});await panelAction('object-modules');await capture('orders-object-module-device');
    assert.equal(await page.locator('[data-action="object-module-1"]').count(),0,'растительный модуль не предлагается лампе');
    await panelAction('object-module-2');await capture('orders-object-module-device-installed');assert.deepEqual((await savedState()).season!.effects.modules[1]!.at,{q:0,r:-1});
    await page.reload();await ready(page);await tapCell(page,{q:0,r:-1});assert.ok((await page.locator('.panel-content').textContent())!.includes('Кольцевая насадка'));
    const emptyModules=moduleFixture();emptyModules.season!.effects.modules=[];assert.ok(isGameState(emptyModules));
    await install(emptyModules);await tapCell(page,{q:0,r:0});await panelAction('object-modules');await capture('orders-object-module-empty');
    assert.equal(await page.locator('[data-action^="object-module-"]').count(),0);
    await install(moduleFixture());await tapCell(page,{q:0,r:0});await panelAction('object-modules');await failWrites(page);
    const beforeModuleWrite=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    await panelAction('object-module-1');await capture('orders-object-module-error');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),beforeModuleWrite);
    await restoreWrites(page);await click(page,'retry-save');await capture('orders-object-module-retried');
    assert.deepEqual((await savedState()).season!.effects.modules[0]!.at,{q:0,r:0});
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).revision,currentKey),51,'повтор не выдаёт вторую revision');
    const risk=eventFixture(20,'U1',9);risk.season!.garden.stock.chrysanthemum=0;
    risk.season!.board.active=[{...risk.season!.board.active[0]!,...orderCandidates(1,15)[0]!,id:20}];risk.season!.board.completed=[];risk.profile.experience=0;risk.profile.progress.main=0;
    await install(risk);await toolbar(page,'orders-button');await panelAction('events');await panelAction('urgent-accept-1');
    const beforeRisk=await page.evaluate(key=>localStorage.getItem(key),currentKey);
    await panelAction('urgent-submit-1');await capture('orders-spend-confirm');await panelAction('cancel-spend');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),currentKey),beforeRisk);
    await panelAction('urgent-submit-1');await panelAction('confirm-spend');assert.equal((await savedState()).season!.garden.stock.carnation,0);
    const waiting=eventFixture(9);const waitingRequests=waiting.season!.events.requests;waitingRequests[0]!.status='active';waitingRequests[1]!.status='waiting';waitingRequests[1]!.day=8;
    await install(waiting);await toolbar(page,'orders-button');await panelAction('events');await capture('orders-event-waiting');
    await install(noCalendarRequestFixture());await toolbar(page,'orders-button');await panelAction('events');await capture('orders-event-no-calendar');
    assert.equal((await savedState()).season!.events.requests[1]!.status,'waiting');assert.equal(await page.locator('[data-action="urgent-accept-2"]').count(),0);
    const late=eventFixture(20,'U2',0);late.season!.events.requests[0]!.status='waiting';late.season!.events.requests[0]!.card=null;
    await install(late);await toolbar(page,'orders-button');await panelAction('events');await capture('orders-event-late');
    const story=orderFixture(3,12);story.profile.progress={main:3,urgent:1,wins:1};
    await install(story);await toolbar(page,'orders-button');await panelAction('events');await capture('orders-story-complete');
    // Этап6: новые панели и реальные покупки; независимые сейвы остаются валидными.
    await install(newProfile());await panelAction('shop');await capture('orders-shop-locked');
    assert.equal(await page.locator('[data-action="buy-rose"]').isDisabled(),true);
    const funded=newProfile();funded.profile.coins=1000;funded.profile.experience=600;
    await install(funded);await panelAction('shop');await capture('orders-shop-funded');
    await failWrites(page);await panelAction('buy-rose');await capture('orders-buy-error');
    await restoreWrites(page);await panelAction('retry-save');await capture('orders-shop-rose');
    assert.deepEqual((await savedState()).profile.owned,['rose']);assert.equal((await savedState()).profile.coins,940);
    await page.reload();await ready(page);await panelAction('shop');
    assert.equal(await page.locator('[data-action="buy-rose"]').isDisabled(),true);
    for(const item of PURCHASES.filter(p=>p.id!=='rose'))await panelAction(`buy-${item.id}`);
    await capture('orders-shop-all');assert.equal((await savedState()).profile.coins,220);
    await panelAction('start');await capture('expanded-board');
    assert.equal(await page.locator('canvas').getAttribute('aria-label'),'Поле оранжереи: 37 клеток');
    await toolbar(page,'catalog-button');await capture('orders-expanded-catalog');
    assert.equal(await page.locator('.catalog-grid button').count(),8);
    await panelAction('continue');await click(page,'menu');await panelAction('shop');await capture('orders-shop-season');
    assert.equal(await page.locator('[data-action="buy-rose"]').isDisabled(),true);
    let expanded=await savedState();
    for(const [kind,q,r] of [['sprinkler',-3,2],['lamp',-4,2],['rose',-4,3],['tulip',-4,1],['gerbera',-3,1],['lily',-3,3],['carnation',-2,2],['chrysanthemum',-3,0]] as const)expanded=editLayout(expanded,{type:'place',kind,to:{q,r}});
    expanded=enterGrowthDay(enterGrowthDay(expanded));await install(expanded);await capture('expanded-flowers-board');
    for(const [kind,q,r] of [['rose',-4,3],['tulip',-4,1],['gerbera',-3,1],['lily',-3,3]] as const){await tapCell(page,{q,r});await capture(`orders-${kind}-card`);await panelAction('continue');}
    expanded.season!.garden.stock={carnation:500,chrysanthemum:500,rose:500,tulip:500,gerbera:500,lily:500};expanded=refreshStateOffers(expanded);
    let stable=acceptOrder(expanded,expanded.season!.board.offers[0]!.id);stable=closeDay(stable);
    const stableOffers=structuredClone(stable.season!.board.offers);assert.ok(stableOffers.length);
    await install(stable);await toolbar(page,'orders-button');await panelAction(`deliver-${stable.season!.board.active[0]!.id}`);
    if(await page.locator('#panel').getAttribute('data-screen')==='spend-confirm')await panelAction('confirm-spend');
    await capture('orders-existing-offers-pending');assert.deepEqual((await savedState()).season!.board.offers,stableOffers);
    const stableRng=(await savedState()).season!.rng;await page.reload();await ready(page);await panelAction('reward-1');
    assert.deepEqual((await savedState()).season!.board.offers,stableOffers);assert.equal((await savedState()).season!.rng,stableRng);
    await toolbar(page,'orders-button');await capture('orders-existing-offers-resume');
    expanded=acceptOrder(expanded,expanded.season!.board.offers[0]!.id);expanded=acceptOrder(expanded,expanded.season!.board.offers[0]!.id);
    await install(expanded);await toolbar(page,'orders-button');await capture('orders-parallel');
    const retained=expanded.season!.board.active[0]!,second=expanded.season!.board.active[1]!;
    await panelAction(`deliver-${second.id}`);if(await page.locator('#panel').getAttribute('data-screen')==='spend-confirm')await panelAction('confirm-spend');
    await capture('orders-parallel-pending');assert.deepEqual((await savedState()).season!.board.active,[retained]);
    await panelAction('reward-0');await toolbar(page,'orders-button');await capture('orders-parallel-resume');
    assert.equal((await savedState()).season!.board.offers[0]!.stage,3);
    let two=eventFixture(8);two.profile.owned=['event-slot'];two.profile.experience=600;two.season!.access=['event-slot'];two.season!.events.requests[1]!.day=8;
    two=refreshStateOffers(two);await install(two);await toolbar(page,'orders-button');await panelAction('events');
    await panelAction('urgent-accept-1');await panelAction('urgent-accept-2');await capture('orders-two-events');
    assert.equal((await savedState()).season!.events.requests.filter(r=>r.status==='active').length,2);
    const intro=startSeason(newProfile(),123);await install(intro);await toolbar(page,'tutorial-button');await capture('orders-tutorial-accept');
    const untouched=JSON.stringify((await savedState()).season);await panelAction('skip-tutorial');assert.equal(JSON.stringify((await savedState()).season),untouched);assert.equal(await page.locator('#tutorial-button').isVisible(),false);
    let learning=acceptOrder(intro,intro.season!.board.offers[0]!.id);const plantKind=learning.season!.board.active[0]!.ingredients[0]!.kind;
    learning=recordTutorial(editLayout(learning,{type:'place',kind:plantKind,to:{q:0,r:0}}));await install(learning);await toolbar(page,'tutorial-button');await capture('orders-tutorial-care');
    learning.profile.tutorial=['accept','plant','care','day'];await install(learning);await toolbar(page,'tutorial-button');await capture('orders-tutorial-cut');
    }
    await page.setViewportSize({width:profile.height,height:profile.width});await checkPanelReading(page);await page.setViewportSize({width:profile.width,height:profile.height});
    assert.deepEqual(errors, [], profile.id);
    report.profiles.push({ ...profile, states, checks, readingProbes, motion, closing, f3, fieldF3, errors });
    await context.close();
   }
  }));
  report.profiles.sort((a:any,b:any)=>PROFILES.findIndex(p=>p.id===a.id)-PROFILES.findIndex(p=>p.id===b.id));
  report.flows.push(`Изолированные профили: ${workers} контекста одновременно. FPS при параллельном прогоне не является замером производительности устройства.`);
  report.flows.push('Панель: поле во весь экран, одинаковый canvas до/после, середина slide/fade 240 мс, Tab/Shift+Tab внутри, закрытие кнопкой/Esc/фоном, блокировка до конца закрытия и отсутствие нажатий сквозь меню, сокращение переходов.');
  report.flows.push('Этап 2: каталог четырёх типов, размещение касанием/мышью, реальный pointer drag, карточка, отмена подтверждения, удаление, reload и одноразовый undo, отказ/повтор записи переноса, wheel/средняя/клавиши либо двухпальцевый жест с изменением изображения; обзор возвращает исходное изображение; отменённый указатель не пишет, зона видна до отпускания; заполнение 19 клеток, F3 на заполненном поле, выбор объекта после поворота без записи и отмена удерживаемого переноса открытием меню.');
  report.flows.push('Семь профилей: касания/мышь, старт, reload без записи, настройки, подтверждение восстановления, сбой/повтор записи, повреждения, явный новый профиль, persistent:false/повтор, F3, resize.');
  if (full) report.flows.push('Этап 3: независимые валидные сохранения для роста, готовности, увядания 1/2, гибели, восстановления, адаптации, зрелого увядания и дня20. Реальные срезка/перенос/reload/undo, запас и цикл, отказ/повтор и двойное событие без удвоения. День в обычном UI заблокирован без активного основного заказа; все новые карточки проверены без обрезки текста/действий, включая поворот.');
  report.flows.push('Full HD/QHD/4K: реальные KeyboardEvent через CDP с code KeyA/KeyD/KeyW/KeyS и русскими ф/в/ц/ы, AZERTY q/z. Проверены направление по пикселям цветка, остановка при keyup с другой раскладкой, сброс удержания меню и неизменность обеих копий сохранения.');
  report.flows.push('Обратная связь: подсветка собственной и верхней соседней клетки сохраняет пиксели цветка; значок полива выше тени; зона лампы не окрашивает устройство; карточки показывают свет/воду и адаптацию. ПКМ отменяет посадку/перенос и удерживаемый drag без записи, открывает каталог пустой клетки; отмена ничего не пишет, выбор ставит ровно один предмет и увеличивает revision один раз, undo возвращает расстановку; обычный каталог не использует прежнюю цель ПКМ.');
  report.flows.push('Каждый открытый экран семи профилей проверен с текстом 200%: достижимы первая/последняя буква каждого абзаца и все кнопки через внутреннюю прокрутку; корневой шрифт и минимальные цели касания сохранены. Для четырёх карточек/ошибок сняты начало и конец.');
  report.flows.push('Уведомления: реальные повторные касания дают ×N, повтор продлевает 6 секунд; очередь максимум 3 с вытеснением старого, ошибки fullscreen через UI; очередь переживает смену экрана, внутри меню не накрывает действия; закрытие возвращает сообщения под верхнюю панель. Clock проверяет истечение; обе копии сейва и пиксели поля неизменны.');
  if (full) report.flows.push('Этап6: магазин/все покупки/отказ и повтор записи/закрытые покупки в сезоне,8типовкаталога/37клеток/4новые карточки,параллельные основные с сохранением первого срока/две просьбы,контекстное обучение/пропуск без отмены заказа;новые панели normal/text200 и поворот.');
  if (full) report.flows.push('Этап5: три сохранённых варианта, отказ/повтор выбора без второго эффекта, inventory/установка/снятие/перенос/undo/reload, кольцевая зона, U3 и сохранение основного при выборе, обе цели ярмарки, подтверждение риска/отмена без записи, ожидающая/поздняя просьба и накопительный сюжет. Новые панели и текст200 проверены всеми7профилями.');
  if (full) report.flows.push('Этап4: доска предложений/reload, реальное принятие, закрытие undo, рост и повтор записи без повторного дня, массовая срезка, сдача с отказом и двойным событием, pending после1/5 иreload без обхода. Поздние независимые fixtures: финальные3состава/2темы, принятие/победа на20, однократная выплата и новыйсезон, конец20 безроста21, нулеваярепутация безроста, пустаядоска, отмена/подтверждение добровольного поражения. Все новые панели читаемы при обычном тексте и200%.');
  // Та же ширина с меньшей высотой и увеличенный текст не должны уменьшать масштаб.
  for (const probe of [
    { width: 1920, height: 920, text: 1 },
    { width: 2560, height: 1280, text: 1 },
    { width: 1920, height: 720, text: 1 },
    { width: 1920, height: 1080, text: 2 },
    { width: 390, height: 844, text: 2 },
  ]) {
    const context = await browser.newContext({ viewport: { width: probe.width, height: probe.height }, hasTouch: probe.width === 390, isMobile: probe.width === 390 });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(url); await ready(page);
    if (probe.text === 2) await page.addStyleTag({ content: 'html { font-size: max(200%, 0.8333333333vw); }' });
    const reading = await checkPanelReading(page);
    const metrics = await page.evaluate(() => {
      const panel = document.getElementById('panel')!;
      const bounds = panel.getBoundingClientRect();
      const buttons = Array.from(panel.querySelectorAll('button'));
      return {
        font: parseFloat(getComputedStyle(document.documentElement).fontSize),
        panelWidth: bounds.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
        clippedActions: buttons.filter(button => {
          const r = button.getBoundingClientRect();
          return r.left < bounds.left || r.right > bounds.right || r.top < bounds.top || r.bottom > bounds.bottom;
        }).length,
        textOverflow: buttons.filter(button => button.scrollWidth > button.clientWidth + 1).length,
        field: [document.querySelector('canvas')!.clientWidth, document.querySelector('canvas')!.clientHeight],
      };
    });
    assert.ok(Math.abs(metrics.font - Math.max(16 * probe.text, probe.width / 120)) < .02, JSON.stringify(probe));
    assert.equal(metrics.overflow, false, JSON.stringify(probe));
    if (probe.text === 1) assert.equal(metrics.clippedActions, 0, JSON.stringify(probe));
    assert.equal(metrics.textOverflow, 0, JSON.stringify(probe));
    assert.deepEqual(metrics.field, [probe.width, probe.height]);
    report.scaleProbes.push({ ...probe, ...metrics, reading });
    await context.close();
  }
  report.flows.push('Масштаб как в хабе: Full HD ×1, QHD ×4/3, 4K ×2; растут root/текст/кнопки/отступы/предел панели, resize сохраняет формулу. Дополнительно 1920×920, 2560×1280, 1920×720 и текст 200% на телефоне/Full HD (CSS-имитация увеличения текста, не все варианты browser zoom).');
  const reducedContext = await browser.newContext({ reducedMotion: 'reduce' });
  const reducedPage = await reducedContext.newPage();
  reducedPage.on('pageerror', error => report.errors.push(error.message));
  await reducedPage.goto(url); await ready(reducedPage);
  await reducedPage.keyboard.press('Escape');
  assert.equal(await reducedPage.locator('#drawer-layer').getAttribute('data-state'), 'closed');
  await reducedPage.keyboard.press('Escape');
  assert.equal(await reducedPage.locator('#drawer-layer').getAttribute('data-state'), 'open');
  assert.equal(await reducedPage.locator('#panel').evaluate(element => element.getAnimations().length), 0);
  await reducedContext.close();
  report.flows.push(full
    ? 'Режим full: все состояния сценария (~129 на профиль), DOM-проверки на каждом; PNG только ключевым (BOUQUET_ALL_PNG=1 - всем).'
    : 'Режим key: только ключевые экраны (KEY_STATES), без прохождения игрового цикла; PNG только ключевым. Прохождение, рост, заказы по шагам и отказы записи вне ключевых экранов - режим full.');
  report.flows.push('Системная prefers-reduced-motion: reduce отключает выезд; Escape закрывает и повторно открывает панель без двойного срабатывания.');
  if (withVideo) for (const demo of [{ id: 'phone', width: 390, height: 844, touch: true }, { id: 'desktop', width: 1920, height: 1080, touch: false }]) {
    const demoContext = await browser.newContext({ viewport: { width: demo.width, height: demo.height }, hasTouch: demo.touch, isMobile: demo.touch, recordVideo: { dir: resolve(output, 'video-temp'), size: demo.touch ? { width: 390, height: 844 } : { width: 960, height: 540 } } });
    const demoPage = await demoContext.newPage();
    demoPage.on('pageerror', error => report.errors.push(error.message));
    await demoPage.goto(url); await ready(demoPage); await demoPage.waitForTimeout(300);
    await demoPage.keyboard.press('Escape'); await settled(demoPage); await demoPage.waitForTimeout(400);
    await click(demoPage,'menu');await click(demoPage,'start');
    await toolbar(demoPage,'catalog-button');await click(demoPage,'pick-carnation');
    await tapCell(demoPage,{q:0,r:0});await demoPage.waitForTimeout(400);
    await toolbar(demoPage,'cancel-placement');await dragCell(demoPage,{q:0,r:0},{q:1,r:0});
    await demoPage.waitForTimeout(400);await toolbar(demoPage,'undo-button');await demoPage.waitForTimeout(400);
    await click(demoPage, 'menu'); await demoPage.waitForTimeout(400);
    await click(demoPage, 'settings'); await demoPage.waitForTimeout(400);
    await demoPage.keyboard.press('Escape'); await settled(demoPage); await demoPage.waitForTimeout(400);
    const video = demoPage.video()!;
    await demoContext.close();
    const filename = `field-${demo.id}.webm`;
    await rename(await video.path(), resolve(output, filename));
    report.videos[filename] = await hashFile(resolve(output, filename));
  }
  // Настоящий SDK внутри iframe; родитель моделирует отказы и задержки хаба.
  interface Harness {
    records: Record<string, string>;
    welcome: boolean;
    failSave: boolean;
    helloCount: number;
    holdLoads: boolean;
    pendingLoads: { id: number; key: string }[];
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(url + '/harness');
  const initialRecord = await encode(newProfile(), 1);
  await page.evaluate(initialRecord => {
    const state: Harness = { records: { progress: JSON.stringify(initialRecord) }, welcome: true, failSave: false, helloCount: 0, holdLoads: true, pendingLoads: [] };
    (window as unknown as { harness: Harness }).harness = state;
    document.body.innerHTML = '<iframe id="game" style="width:900px;height:700px" src="/"></iframe>';
    addEventListener('message', event => {
      const frame = document.querySelector('iframe')!;
      if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
      const data = event.data;
      if (data.gf !== 1) return;
      if (data.type === 'hello') {
        state.helloCount++;
        if (state.welcome) setTimeout(() => frame.contentWindow!.postMessage({ gf: 1, type: 'welcome', gameId: data.gameId, player: null }, location.origin), 800);
      }
      if (data.type === 'request') {
        if (data.method === 'load' && state.holdLoads) {
          state.pendingLoads.push({ id: data.id, key: data.params.key });
          return;
        }
        let result: string | null = null;
        const ok = !(data.method === 'save' && state.failSave);
        if (data.method === 'load') result = state.records[data.params.key] ?? null;
        else if (data.method === 'save' && ok) state.records[data.params.key] = data.params.value;
        frame.contentWindow!.postMessage({ gf: 1, type: 'response', id: data.id, ok, result, error: ok ? undefined : 'test-write-failed' }, location.origin);
      }
    });
  }, initialRecord);
  const frame = page.frameLocator('#game');
  const iframe = page.frames().find(frame => frame.parentFrame());
  assert.ok(iframe);
  await page.waitForFunction(() => (window as unknown as { harness: Harness }).harness.helloCount === 1);
  await frame.locator('body').press('F3');
  assert.equal(await frame.locator('html[data-gf-ready]').count(), 0);
  await page.waitForFunction(() => (window as unknown as { harness: Harness }).harness.pendingLoads.length === 2);
  assert.equal(await frame.locator('html[data-gf-ready]').count(), 0, 'ready до завершения load');
  await page.evaluate(() => {
    const state = (window as unknown as { harness: Harness }).harness;
    state.holdLoads = false;
    const target = document.querySelector('iframe')!.contentWindow!;
    for (const pending of state.pendingLoads) target.postMessage({ gf: 1, type: 'response', id: pending.id, ok: true, result: state.records[pending.key] ?? null }, location.origin);
    state.pendingLoads = [];
  });
  await frame.locator('html[data-gf-ready="hub"]').waitFor();
  await page.evaluate(() => {
    const state = (window as unknown as { harness: Harness }).harness;
    state.welcome = false;
    state.failSave = true;
  });
  await click(iframe, 'start');
  await frame.getByRole('heading', { name: 'Прогресс в памяти' }).waitFor();
  await click(iframe, 'retry-save');
  assert.equal(await frame.locator('[data-action="retry-save"]').count(), 1, 'ошибка хаба должна оставлять паузу');
  assert.equal(await iframe.evaluate(key => localStorage.getItem(key), currentKey), null, 'ожидающий прогресс не записывается локально');
  assert.equal(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.helloCount), 1, 'повтор не создаёт новое подключение SDK');
  assert.deepEqual(await page.evaluate(() => JSON.parse((window as unknown as { harness: Harness }).harness.records.progress!)), initialRecord);
  await page.evaluate(() => { (window as unknown as { harness: Harness }).harness.failSave = false; });
  await click(iframe, 'retry-save');
  await frame.getByRole('heading', { name: 'День 1 · Подготовка' }).waitFor();
  const accepted = await page.evaluate(() => JSON.parse((window as unknown as { harness: Harness }).harness.records.progress!));
  assert.equal(accepted.revision, 2);
  assert.equal(JSON.parse(accepted.payload).profile.seasonsStarted, 1);
  assert.equal(await iframe.evaluate(key => localStorage.getItem(key), currentKey), null);
  await page.evaluate(() => { (window as unknown as { harness: Harness }).harness.welcome = true; });
  await iframe.evaluate(() => location.reload());
  await frame.locator('html[data-gf-ready="hub"]').waitFor();
  await frame.getByRole('heading', { name: 'День 1 · Подготовка' }).waitFor();
  // Перечитывание сохранений тоже использует исходный транспорт без fallback в standalone.
  await page.evaluate(() => { (window as unknown as { harness: Harness }).harness.welcome = false; });
  await click(iframe, 'menu'); await click(iframe, 'recovery'); await click(iframe, 'recheck');
  await frame.getByRole('heading', { name: 'День 1 · Подготовка' }).waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.helloCount), 2);
  assert.ok((await frame.locator('#storage-status').textContent())?.includes('Game Factory'));
  report.flows.push('SDK hub в iframe: ready ждёт welcome и оба load; ранний F3; отказ записи без нового welcome оставляет pending и пустой localStorage; успешный повтор пишет revision 2 в исходный хаб; reload и recheck восстанавливают тот же сезон.');
  await context.close();
  assert.deepEqual(report.errors, []);
  report.complete = true;
} catch (error) {
  report.errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log(JSON.stringify({ complete: report.complete, profiles: report.profiles.length, screenshots: Object.keys(report.pngHashes).length, flows: report.flows, errors: report.errors }, null, 2));
