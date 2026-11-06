// Регрессии UI: настоящее первое касание после drag и чтение каталога без дробления слов.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {PROFILES} from '../../../tests/ui/core/profiles.ts';
import {encode} from '../src/core/saves.ts';
import {newProfile,startSeason,editLayout,installModule,type GameState} from '../src/core/state.ts';
import {acceptOrder,chooseReward} from '../src/core/calendar.ts';
import {PURCHASES,purchase} from '../src/core/shop.ts';
import {moduleRewardFixture} from './stage5-fixtures.ts';
import {fitField,toScreen} from '../src/core/camera.ts';
import {cellCenter} from '../src/core/field.ts';
import {checkPanelReading} from './panel-checks.ts';
const inputOnly=process.argv.includes('--input-only');
const touchAction=process.argv.includes('--touch-action'),nativeTouch=process.argv.includes('--native-touch'),experiment=touchAction||nativeTouch;
const before=process.env.BOUQUET_BUGFIX_PHASE==='before',game=resolve(import.meta.dirname,'..');
const root=before?resolve(game,'artifacts/bugfix-2026-11-05/before/dist'):resolve(game,'dist');
const output=resolve(game,before?'artifacts/bugfix-2026-11-05':'artifacts/object-modules-2026-11-05',nativeTouch?'native-touch-experiment':touchAction?'touch-action-experiment':before?'reproduction':'targeted');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+(req.url==='/'?'/index.html':req.url!));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'} as Record<string,string>)[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({headless:true}),key='gf:bouquet-season:save:progress';
const report:{complete:boolean;before:boolean;inputOnly:boolean;experiment:string|null;profiles:any[];hashes:Record<string,string>;errors:string[]}={complete:false,before,inputOnly,experiment:nativeTouch?'native-touch':touchAction?'touch-action':null,profiles:[],hashes:{},errors:[]};
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
try{
 let expanded=newProfile();expanded.profile.experience=600;expanded.profile.coins=1000;for(const item of PURCHASES)expanded=purchase(expanded,item.id);expanded=startSeason(expanded,123);
 const initial=startSeason(newProfile(),123),active=acceptOrder(initial,initial.season!.board.offers[0]!.id);
 let equipped=chooseReward(moduleRewardFixture(),0);equipped=editLayout(equipped,{type:'place',kind:'carnation',to:{q:0,r:0}});equipped=installModule(equipped,1,{q:0,r:0});
 for(const profile of PROFILES.filter(p=>!experiment||p.touch)){
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},hasTouch:profile.touch,isMobile:profile.touch,deviceScaleFactor:1});
  await context.addInitScript(nativeTouch=>{
   if(nativeTouch){const prevent=Event.prototype.preventDefault;Event.prototype.preventDefault=function(){if(this.type==='pointerdown'&&(this as PointerEvent).pointerType==='touch'&&this.target instanceof HTMLCanvasElement)return;prevent.call(this);};}
   const events:any[]=[];Object.assign(window,{bugfixInputTrace:events});
   for(const type of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','touchstart','touchend','click','mousedown','mouseup'])document.addEventListener(type,e=>{
    const p=e as PointerEvent,entry={type,time:performance.now(),target:(e.target as Element)?.id||(e.target as Element)?.tagName,pointerId:p.pointerId,pointerType:p.pointerType,detail:p.detail,prevented:false};events.push(entry);queueMicrotask(()=>entry.prevented=e.defaultPrevented);
   },{capture:true,passive:true});
  },nativeTouch);
  const page=await context.newPage(),errors:string[]=[],checks:any[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.goto(url);
  const settle=async()=>{await page.locator('html[data-gf-ready]').waitFor({state:'attached'});await page.locator('#app[aria-busy="false"]').waitFor();await page.locator('#preloader').waitFor({state:'hidden'});await page.locator('#drawer-layer[data-state="open"],#drawer-layer[data-state="closed"]').waitFor({state:'attached'});};
  const press=async(selector:string)=>{const b=page.locator(selector);await b.scrollIntoViewIfNeeded();if(profile.touch)await b.tap();else await b.click();await settle();};
  const shot=async(name:string)=>{const file=`${profile.id}-${name}.png`;await page.screenshot({path:resolve(output,file)});report.hashes[file]=await hash(resolve(output,file));};
  const install=async(state:GameState)=>{const record=await encode(state,40);await page.evaluate(({key,record})=>{localStorage.clear();localStorage.setItem(key,JSON.stringify(record));},{key,record});await page.reload();await settle();if(touchAction)await page.addStyleTag({content:'button{touch-action:manipulation}'});};
  await install(active);
  const hint=await page.locator('#tutorial-button').evaluate(button=>{
   const range=document.createRange(),text=button.firstChild!;const lines=[];
   for(let i=0;i<(text.textContent?.length??0);i++){range.setStart(text,i);range.setEnd(text,i+1);lines.push(range.getBoundingClientRect().top);}
   return {lines:new Set(lines).size,width:button.getBoundingClientRect().width,text:button.textContent};
  });checks.push({case:'hint',...hint});await shot('hint');if(!before&&!inputOnly)assert.equal(hint.lines,1,'подпись подсказки не должна дробиться');
  await install(expanded);await press('#catalog-button');
  const font=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize));
  const style=await page.addStyleTag({content:`html{font-size:${font*2}px!important}`});await checkPanelReading(page);
  const catalog=await page.locator('.catalog-grid').evaluate(grid=>{
   const buttons=Array.from(grid.querySelectorAll('button')),titles=buttons.map(b=>{const t=b.querySelector('strong')!.firstChild!,range=document.createRange(),ys=[];for(let i=0;i<t.textContent!.length;i++){range.setStart(t,i);range.setEnd(t,i+1);ys.push(range.getBoundingClientRect().top);}return {text:t.textContent,lines:new Set(ys).size};});
   return {columns:new Set(buttons.map(b=>Math.round(b.getBoundingClientRect().left))).size,titles};
  });checks.push({case:'catalog-double',font:font*2,...catalog});await shot('catalog-double');
  if(!before&&!inputOnly)assert.ok(catalog.titles.every(t=>t.lines===1),'названия видов читаются целиком');
  await page.setViewportSize({width:profile.height,height:profile.width});await checkPanelReading(page);await page.setViewportSize({width:profile.width,height:profile.height});await style.evaluate(s=>(s as HTMLStyleElement).remove());
  if(profile.touch){
   for(const input of ['playwright','same-cdp'] as const){
    await install(equipped);await page.evaluate(()=>((window as any).bugfixInputTrace as any[]).length=0);
    const rect=await page.evaluate(()=>{const f=parseFloat(getComputedStyle(document.documentElement).fontSize),top=document.querySelector('header')!.getBoundingClientRect().bottom+f*.5,bottom=document.getElementById('field-tools')!.getBoundingClientRect().top-f*.5;return{x:f,y:top,width:innerWidth-f*2,height:bottom-top};});
    const a=toScreen(fitField(rect),cellCenter({q:0,r:0})),b=toScreen(fitField(rect),cellCenter({q:1,r:0}));
    const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]});
    for(let n=1;n<=6;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*n/6,y:a.y+(b.y-a.y)*n/6,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.locator('#app[aria-busy="false"]').waitFor();await page.locator('#preloader').waitFor({state:'hidden'});
    const moved=await page.evaluate(key=>JSON.parse(JSON.parse(localStorage.getItem(key)!).payload),key);assert.equal(moved.season.layout.objects[0].q,1);const target=page.locator('#undo-button');assert.equal(await target.isEnabled(),true);
    const tapAt=await page.evaluate(()=>performance.now());
    if(input==='playwright'){await cdp.detach();await target.tap();}else{const box=await target.boundingBox();assert.ok(box);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
    let reverted=true;try{await page.waitForFunction(key=>JSON.parse(JSON.parse(localStorage.getItem(key)!).payload).season.layout.objects[0].q===0,key,{timeout:700});}catch{reverted=false;}
    const trace=await page.evaluate(()=>(window as any).bugfixInputTrace),rev=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).revision,key);
    checks.push({case:'first-tap-after-drag',input,reverted,tapAt,revision:rev,trace});await shot(`drag-${input}`);
    if(!before)assert.equal(reverted,true,'первое касание отменяет перенос без второго нажатия');
   }
  }
  if(profile.touch&&!before){
   // Изолированная DOM-кнопка проверяет делегированный адаптер обычной сборки.
   // Продуктового тестового API и прямого вызова адаптера здесь нет.
   await page.evaluate(()=>{const button=document.createElement('button');button.id='gesture-probe';button.textContent='Проверка';button.style.cssText='position:fixed;left:40px;top:50px;width:100px;height:64px;z-index:10000';button.addEventListener('click',()=>{button.dataset.count=String(Number(button.dataset.count??0)+1);});document.getElementById('app')!.append(button);});
   const cdp=await context.newCDPSession(page),point={x:90,y:82,id:1};
   const send=async(type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel',touchPoints:any[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
   const tap=async()=>{await send('touchStart',[point]);await send('touchEnd',[]);};
   const count=()=>page.locator('#gesture-probe').getAttribute('data-count').then(n=>Number(n??0));
   await tap();await page.waitForTimeout(400);assert.equal(await count(),1,'touch+совместимый click дают одно действие');
   await tap();await page.waitForTimeout(400);assert.equal(await count(),2,'следующее касание тоже работает');
   await send('touchStart',[point]);await send('touchMove',[{...point,x:point.x+9}]);await send('touchEnd',[]);await page.waitForTimeout(400);assert.equal(await count(),2,'малое движение9px отменяет кнопку и совместимый click');
   await send('touchStart',[point]);await send('touchMove',[{...point,x:point.x+20}]);await send('touchEnd',[]);assert.equal(await count(),2,'движение отменяет кнопку');
   await send('touchStart',[point]);await send('touchMove',[{...point,x:250}]);await send('touchEnd',[]);assert.equal(await count(),2,'отпускание снаружи не активирует кнопку');
   await send('touchStart',[point]);await send('touchCancel',[]);assert.equal(await count(),2,'pointercancel отменяет кнопку');
   await send('touchStart',[point]);await send('touchStart',[point,{x:160,y:82,id:2}]);await send('touchEnd',[]);assert.equal(await count(),2,'два пальца не активируют кнопку');
   await page.locator('#gesture-probe').evaluate((b:HTMLButtonElement)=>b.disabled=true);await tap();assert.equal(await count(),2,'disabled не активируется');
   await page.locator('#gesture-probe').evaluate((b:HTMLButtonElement)=>b.disabled=false);
   await send('touchStart',[point]);await page.locator('#gesture-probe').evaluate((b:HTMLButtonElement)=>b.disabled=true);await send('touchEnd',[]);assert.equal(await count(),2,'disabled перед отпусканием отменяет кнопку');await page.locator('#gesture-probe').evaluate((b:HTMLButtonElement)=>b.disabled=false);
   await page.locator('#gesture-probe').focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');assert.equal(await count(),4,'клавиатура сохраняет нативную активацию');
   await page.locator('#gesture-probe').click();assert.equal(await count(),5,'мышь работает после касаний');
   checks.push({case:'button-gestures',count:await count(),cancelled:['movement9px','movement20px','outside','pointercancel','multitouch','disabled-down','disabled-up'],activation:['touch-once','second-touch','Enter','Space','mouse']});
   await tap();await page.waitForTimeout(400);assert.equal(await count(),6,'возврат с мыши к touch');
   // Поздний MouseEvent после перерисовки не должен нажать новую кнопку под пальцем.
   const retarget=await page.evaluate(()=>{const old=document.getElementById('gesture-probe')!,next=old.cloneNode(true) as HTMLButtonElement;next.dataset.count='0';next.addEventListener('click',()=>next.dataset.count=String(Number(next.dataset.count)+1));old.replaceWith(next);next.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:90,clientY:82}));return Number(next.dataset.count);});assert.equal(retarget,0,'legacy click не проходит в новую DOM-кнопку');
   checks.push({case:'legacy-click-retarget',synthetic:true,count:retarget});
   const reused=await page.evaluate(()=>{const id=((window as any).bugfixInputTrace as any[]).filter(e=>e.type==='pointerup'&&e.pointerType==='touch').at(-1).pointerId,input=document.createElement('input');input.type='checkbox';document.getElementById('app')!.append(input);for(const type of ['pointerdown','pointerup'])input.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',isPrimary:true}));const click=new PointerEvent('click',{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',detail:1});input.dispatchEvent(click);const result={prevented:click.defaultPrevented,checked:input.checked};input.remove();return result;});assert.equal(reused.prevented,false,'новый жест с прежним ID не блокирует checkbox');assert.equal(reused.checked,true);checks.push({case:'reused-pointer-id',synthetic:true,...reused});
   await page.locator('#gesture-probe').evaluate(b=>b.remove());await cdp.detach();
   await install(expanded);await press('#catalog-button');
   const scrollFont=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize));
   await page.addStyleTag({content:`html{font-size:${scrollFont*2}px!important}`});await checkPanelReading(page);
   const origin=await page.evaluate(()=>{const body=document.getElementById('panel-body')!,content=body.querySelector('.panel-content')!;body.scrollTop=content.scrollTop=0;const br=body.getBoundingClientRect(),cr=content.getBoundingClientRect();for(const button of document.querySelectorAll('.catalog-grid button')){const r=button.getBoundingClientRect(),top=Math.max(r.top,br.top,cr.top),bottom=Math.min(r.bottom,br.bottom,cr.bottom,innerHeight);if(bottom-top>32)return{x:r.x+r.width/2,y:(top+bottom)/2};}throw Error('Нет видимой карточки для scroll');});
   const scrolling=await context.newCDPSession(page),unchanged=await page.evaluate(key=>localStorage.getItem(key),key);
   await scrolling.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...origin,id:1}]});
   for(let step=1;step<=6;step++){await scrolling.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:origin.x,y:origin.y-step*20,id:1}]});await page.waitForTimeout(20);}
   await scrolling.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);await scrolling.detach();
   const scrollTop=await page.evaluate(()=>document.getElementById('panel-body')!.scrollTop+document.querySelector('.panel-content')!.scrollTop);
   assert.ok(scrollTop>0,'каталог действительно прокручивается пальцем');assert.equal(await page.locator('#panel').getAttribute('data-screen'),'catalog');assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),unchanged,'scroll не выбирает предмет и не пишет сейв');
   checks.push({case:'catalog-native-touch-scroll',scrollTop,saveUnchanged:true});await shot('catalog-touch-scroll');
  }
  assert.deepEqual(errors,[]);report.profiles.push({...profile,checks,errors});await context.close();console.log(profile.id,checks.map(c=>({case:c.case,input:c.input,reverted:c.reverted,lines:c.lines,columns:c.columns})));
 }
 report.complete=true;
}catch(e){report.errors.push(e instanceof Error?e.stack??e.message:String(e));process.exitCode=1;}finally{
 for(const asset of await readdir(resolve(root,'assets')))report.hashes[`dist/assets/${asset}`]=await hash(resolve(root,'assets',asset));report.hashes['dist/index.html']=await hash(resolve(root,'index.html'));report.hashes['test/bugfix-browser.ts']=await hash(import.meta.filename);if(!before)for(const file of ['src/main.ts','src/style.css','src/touch-buttons.ts'])report.hashes[file]=await hash(resolve(game,file));
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise<void>(r=>server.close(()=>r()));
}
console.log(JSON.stringify({complete:report.complete,profiles:report.profiles.length,errors:report.errors}));
