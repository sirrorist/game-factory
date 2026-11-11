// Полное обычное прохождение через UI. Подготовка только пустого профиля и seed.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {encode} from '../src/core/saves.ts';
import {newProfile,isGameState,type GameState} from '../src/core/state.ts';
import {isPlant} from '../src/core/layout.ts';
import {findProductionPlan} from '../src/core/planner.ts';
import {production} from '../src/core/calendar.ts';
import {fairGoal} from '../src/core/events.ts';
import {fitField,toScreen} from '../src/core/camera.ts';
import {cellCenter,type Cell} from '../src/core/field.ts';
const root=resolve(import.meta.dirname,'../dist'),out=resolve(import.meta.dirname,process.env.BOUQUET_FULL_PLAY??'../artifacts/object-modules-2026-11-05/full-cycle');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const p=new URL(req.url!,'http://localhost').pathname,file=resolve(root,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'} as Record<string,string>)[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const address=server.address();assert.ok(address&&typeof address==='object');
const url=`http://127.0.0.1:${address.port}`,key='gf:bouquet-season:save:progress';
const browser=await chromium.launch({headless:true});
const report:{complete:boolean;profiles:any[];errors:string[];hashes:Record<string,string>}={complete:false,profiles:[],errors:[],hashes:{}};
const hash=async(p:string)=>createHash('sha256').update(await readFile(p)).digest('hex');
try{
 for(const profile of [{id:'phone-portrait',width:390,height:844,touch:true},{id:'fullhd',width:1920,height:1080,touch:false}]){
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},hasTouch:profile.touch,isMobile:profile.touch,recordVideo:{dir:resolve(out,'video'),size:{width:profile.width,height:profile.height}}});
  await context.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=(array:any)=>array instanceof Uint32Array&&array.length===1?(array[0]=123,array):original(array);});
  const page=await context.newPage(),errors:string[]=[],trace:any[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const settle=async()=>{await page.locator('#app[aria-busy="false"]').waitFor();await page.locator('#preloader').waitFor({state:'hidden'});await page.locator('#drawer-layer[data-state="open"],#drawer-layer[data-state="closed"]').waitFor({state:'attached'});};
  const state=async():Promise<GameState>=>page.evaluate(key=>JSON.parse(JSON.parse(localStorage.getItem(key)!).payload),key);
  const revision=async()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).revision as number,key);
  const press=async(action:string)=>{await settle();const panel=page.locator(`#panel [data-action="${action}"]`),element=await panel.count()?panel:page.locator(`#${action}`);await element.scrollIntoViewIfNeeded();if(profile.touch)await element.tap();else await element.click();await settle();};
  const mutate=async(action:string)=>{const before=await revision();await press(action);if(await page.locator('#panel').getAttribute('data-screen')==='spend-confirm')await press('confirm-spend');await page.waitForFunction(({key,before})=>JSON.parse(localStorage.getItem(key)!).revision>before,{key,before});await settle();assert.ok(isGameState(await state()));};
  const shot=async(name:string)=>{await settle();const file=`${profile.id}-${name}.png`;await page.screenshot({path:resolve(out,file)});report.hashes[file]=await hash(resolve(out,file));};
  const point=async(cell:Cell)=>{const rect=await page.evaluate(()=>{const font=parseFloat(getComputedStyle(document.documentElement).fontSize),top=document.querySelector('header')!.getBoundingClientRect().bottom+font*.5,bottom=document.getElementById('field-tools')!.getBoundingClientRect().top-font*.5;return{x:font,y:top,width:innerWidth-font*2,height:bottom-top};});return toScreen(fitField(rect),cellCenter(cell));};
  const tap=async(cell:Cell,change=false)=>{const before=await revision(),p=await point(cell);if(profile.touch)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);if(change)await page.waitForFunction(({key,before})=>JSON.parse(localStorage.getItem(key)!).revision>before,{key,before});await settle();};
  await page.goto(url);await page.locator('html[data-gf-ready]').waitFor({state:'attached'});await settle();
  const blank=await encode(newProfile(),1);await page.evaluate(({key,blank})=>{localStorage.clear();localStorage.setItem(key,JSON.stringify(blank));},{key,blank});await page.reload();await page.locator('html[data-gf-ready]').waitFor({state:'attached'});await settle();
  await mutate('start');await shot('start');
  for(let stage=1;stage<=6;stage++){
    let current=await state();const candidates=current.season!.board.offers.map(order=>({order,plan:findProductionPlan(production(current.season!),[order,...fairGoal(current.season!.events,current.season!.day)])})).filter(c=>c.plan).sort((a,b)=>a.plan!.days.at(-1)!.day-b.plan!.days.at(-1)!.day||b.order.ingredients.length-a.order.ingredients.length);
    const choice=candidates[0];assert.ok(choice,`Нет заказа ${stage}, день ${current.season!.day}`);const {order,plan}=choice;assert.ok(plan);
    await press('orders-button');await mutate(`accept-${order.id}`);
    if(plan.layout){
      for(const old of current.season!.layout.objects)if(!plan.layout.some(o=>o.kind===old.kind&&o.q===old.q&&o.r===old.r)){await tap(old);if(isPlant(old.kind))await press('remove-confirm');await mutate('remove');}
      current=await state();
      for(const kind of ['lamp','sprinkler','carnation','chrysanthemum'] as const){
        const additions=plan.layout.filter(o=>o.kind===kind&&!current.season!.layout.objects.some(old=>old.kind===o.kind&&old.q===o.q&&old.r===o.r));if(!additions.length)continue;
        await press('catalog-button');await press(`pick-${kind}`);for(const o of additions)await tap(o,true);await press('cancel-placement');
      }
    }
    await shot(`stage-${stage}-layout`);
    for(const day of plan.days){
      while((await state()).season!.day<day.day)await mutate('next-day-button');
      current=await state();if(current.season!.garden.plants.some(p=>p.yield&&p.wilt<3)){await mutate('harvest-button');}
      if(day.delivered.includes(20000)){await press('orders-button');await press('events');await shot('fair-ready');await mutate('fair-minimum');await shot('fair-done');await press('continue');}
      if(day.delivered.includes(order.id)){await press('orders-button');await mutate(`deliver-${order.id}`);}
    }
    current=await state();trace.push({stage,day:current.season!.day,revision:await revision(),stock:current.season!.garden.stock,profile:current.profile});
    if(stage<6){await shot(`reward-${stage}`);const before=await revision();await page.reload();await page.locator('html[data-gf-ready]').waitFor({state:'attached'});await settle();assert.equal(await revision(),before);await mutate('reward-1');}
  }
  await shot('victory');const win=await state();assert.equal(win.season!.board.result!.outcome,'win');assert.equal(win.season!.day,19);assert.equal(win.season!.events.fair.minimum,true);assert.equal(win.profile.progress.main,5);assert.deepEqual(errors,[]);
  const before=await revision();await page.reload();await page.locator('html[data-gf-ready]').waitFor({state:'attached'});await settle();assert.equal(await revision(),before);assert.deepEqual(await state(),win);
  await press('shop');await shot('shop-after-win');
  for(const item of ['rose','tulip','main-slot'])await mutate(`buy-${item}`);
  const purchased=await state();assert.equal(purchased.profile.coins,win.profile.coins-260);assert.equal(purchased.profile.experience,win.profile.experience);
  assert.deepEqual(purchased.profile.owned,['rose','tulip','main-slot']);await shot('shop-purchased');
  await page.reload();await page.locator('html[data-gf-ready]').waitFor({state:'attached'});await settle();assert.deepEqual(await state(),purchased);
  await mutate('start');assert.equal((await state()).season!.number,2);assert.deepEqual((await state()).season!.access,purchased.profile.owned);
  for(let slot=0;slot<2;slot++){await press('orders-button');const offer=(await state()).season!.board.offers[0];if(!offer){await press('continue');break;}await mutate(`accept-${offer.id}`);}
  assert.equal((await state()).profile.owned.includes('main-slot'),true);assert.ok((await state()).season!.board.active.length>=1);await shot('second-season-orders');
  for(const [kind,q,r] of [['sprinkler',1,0],['lamp',0,-1],['rose',0,0],['tulip',-1,0]] as const){
    await press('catalog-button');await press(`pick-${kind}`);await tap({q,r},true);await press('cancel-placement');
  }
  await shot('new-species-planted');
  for(let day=0;day<4;day++)await mutate('next-day-button');
  await mutate('harvest-button');
  const grown=await state();assert.ok(grown.season!.garden.stock.rose>=2);assert.ok(grown.season!.garden.stock.tulip>=2);await shot('new-species-harvested');
  assert.deepEqual(errors,[]);
  const video=page.video()!;await context.close();const file=await video.path();report.hashes[`video/${file.split('/').at(-1)}`]=await hash(file);
  report.profiles.push({...profile,trace,result:win.season!.board.result,purchases:purchased.profile,nextSeason:grown,errors});console.log(profile.id,'win19',trace.length,'stages',before,'revisions');
 }
 report.complete=true;
}catch(error){report.errors.push(error instanceof Error?error.stack??error.message:String(error));process.exitCode=1;}finally{
 for(const asset of await readdir(resolve(root,'assets')))report.hashes[`dist/assets/${asset}`]=await hash(resolve(root,'assets',asset));
 report.hashes['dist/index.html']=await hash(resolve(root,'index.html'));report.hashes['test/progression-browser.ts']=await hash(import.meta.filename);
 await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise<void>(r=>server.close(()=>r()));
}
console.log(JSON.stringify({complete:report.complete,profiles:report.profiles.length,errors:report.errors}));
