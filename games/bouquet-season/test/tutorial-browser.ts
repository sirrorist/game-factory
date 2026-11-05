// Адресная проверка всех контекстных подсказок; изолированные сохранения, без хуков игры.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {PROFILES} from '../../../tests/ui/core/profiles.ts';
import {newProfile,startSeason,editLayout,type GameState} from '../src/core/state.ts';
import {acceptOrder,closeDay,harvestAll} from '../src/core/calendar.ts';
import {recordTutorial,tutorialTip} from '../src/core/tutorial.ts';
import {encode} from '../src/core/saves.ts';
import {checkPanelReading} from './panel-checks.ts';
const root=resolve(import.meta.dirname,'../dist'),out=resolve(import.meta.dirname,process.env.BOUQUET_TUTORIAL??'../artifacts/object-modules-2026-11-05/tutorial-check');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+(req.url==='/'?'/index.html':req.url!));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'} as Record<string,string>)[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert.ok(addr&&typeof addr==='object');const url=`http://127.0.0.1:${addr.port}`;
const browser=await chromium.launch({headless:true}),key='gf:bouquet-season:save:progress';
const report:{complete:boolean;profiles:any[];hashes:Record<string,string>;errors:string[]}={complete:false,profiles:[],hashes:{},errors:[]};
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
try{
 let s=startSeason(newProfile(),1);const states:{id:string;state:GameState}[]=[{id:'accept',state:s}];
 s=recordTutorial(acceptOrder(s,s.season!.board.offers.find(o=>o.ingredients.length===1&&o.ingredients[0]!.kind==='carnation')!.id));states.push({id:'plant',state:s});
 s=recordTutorial(editLayout(s,{type:'place',kind:'carnation',to:{q:0,r:0}}));states.push({id:'care',state:s});
 s=recordTutorial(editLayout(s,{type:'place',kind:'sprinkler',to:{q:1,r:0}}));states.push({id:'day',state:s});
 s=recordTutorial(closeDay(s));states.push({id:'cut',state:s});while(!s.season!.garden.plants[0]!.yield)s=recordTutorial(closeDay(s));
 s=recordTutorial(harvestAll(s));states.push({id:'submit',state:s});
 for(const item of states)assert.equal(tutorialTip(item.state)?.id,item.id);
 for(const profile of PROFILES){
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},hasTouch:profile.touch,isMobile:profile.touch,deviceScaleFactor:profile.touch?3:2}),page=await context.newPage(),checks:any[]=[],errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.goto(url);
  const settle=async()=>{await page.locator('html[data-gf-ready]').waitFor({state:'attached'});await page.locator('#app[aria-busy="false"]').waitFor();await page.locator('#drawer-layer[data-state="open"],#drawer-layer[data-state="closed"]').waitFor({state:'attached'});};
  const press=async(selector:string)=>{const b=page.locator(selector);await b.scrollIntoViewIfNeeded();if(profile.touch)await b.tap();else await b.click();await settle();};
  const shot=async(name:string)=>{const f=`${profile.id}-${name}.png`;await page.screenshot({path:resolve(out,f)});report.hashes[f]=await hash(resolve(out,f));};
  for(const item of [...states,{id:'shop-poor',state:{...newProfile(),profile:{...newProfile().profile,experience:600}}}]){
   const record=await encode(item.state,40);await page.evaluate(({key,record})=>{localStorage.clear();localStorage.setItem(key,JSON.stringify(record));},{key,record});await page.reload();await settle();
   if(item.id==='shop-poor')await press('[data-action="shop"]');else await press('#tutorial-button');
   const title=item.id==='shop-poor'?'Развитие мастерской':`Подсказка: ${tutorialTip(item.state)!.title}`;
   assert.equal(await page.locator('#panel-title').textContent(),title);checks.push({id:item.id,text:1,...await checkPanelReading(page) as object});await shot(item.id);
   if(item.id==='shop-poor'){assert.equal(await page.locator('[data-action="buy-rose"]').isDisabled(),true);assert.ok((await page.locator('[data-purchase="rose"]').textContent())!.includes('Не хватает 60 монет'));}
   const style=await page.addStyleTag({content:'html{font-size:max(200%,0.8333333333vw)!important}'});checks.push({id:item.id,text:2,...await checkPanelReading(page) as object});await shot(`${item.id}-text200`);
   await page.evaluate(()=>{const b=document.getElementById('panel-body')!,c=b.querySelector<HTMLElement>('.panel-content')!,scroll=b.dataset.scroll==='all'?b:c;scroll.scrollTop=scroll.scrollHeight;});await shot(`${item.id}-text200-bottom`);await style.evaluate(s=>(s as HTMLStyleElement).remove());
   await page.setViewportSize({width:profile.height,height:profile.width});checks.push({id:item.id,rotated:true,...await checkPanelReading(page) as object});await page.setViewportSize({width:profile.width,height:profile.height});
   assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).revision,key),40,'подсказка/поворот не записывают прогресс');
  }
  assert.deepEqual(errors,[]);report.profiles.push({...profile,checks,errors});await context.close();console.log(profile.id,'all6tips+shop passed');
 }
 report.complete=true;
}catch(e){report.errors.push(e instanceof Error?e.stack??e.message:String(e));process.exitCode=1;}finally{
 for(const f of await readdir(resolve(root,'assets')))report.hashes[`dist/assets/${f}`]=await hash(resolve(root,'assets',f));report.hashes['dist/index.html']=await hash(resolve(root,'index.html'));
 for(const dir of ['src','test'])for(const f of await readdir(resolve(import.meta.dirname,'..',dir),{recursive:true}))if(f.endsWith('.ts')||f.endsWith('.css'))report.hashes[`${dir}/${f}`]=await hash(resolve(import.meta.dirname,'..',dir,f));
 await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise<void>(r=>server.close(()=>r()));
}
console.log(JSON.stringify({complete:report.complete,profiles:report.profiles.length,errors:report.errors}));
