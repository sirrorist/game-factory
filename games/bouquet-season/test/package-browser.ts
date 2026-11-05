// Изолированный пакет, настоящий play-server и эталонный мост хаба. Не прод-хаб.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { chromium, type Frame } from 'playwright';
import { startPlay, mockHub, listen, close } from '../../../tests/e2e/helpers.ts';
import { encode } from '../src/core/saves.ts';
import { isGameState } from '../src/core/state.ts';
import { fitField, toScreen } from '../src/core/camera.ts';
import { cellCenter } from '../src/core/field.ts';
import { moduleFixture } from './stage5-fixtures.ts';

const data=resolve(process.argv[2]??'/tmp/gf-bouquet-release-20261105');
const out=resolve(import.meta.dirname,'../artifacts/object-modules-2026-11-05/package-check');
await mkdir(out,{recursive:true});
const registry=JSON.parse(await readFile(resolve(data,'registry.json'),'utf8'));
assert.equal(registry.games.length,1);assert.equal(registry.games[0].version,'1.0.0');
let gameOrigin='';
const hub=mockHub(()=>({gameId:'bouquet-season',gameOrigin}));
const hubPort=await listen(hub),hubOrigin=`http://localhost:${hubPort}`;
const play=await startPlay(data,[hubOrigin]);gameOrigin=`http://bouquet-season.play.localhost:${play.port}`;
const browser=await chromium.launch({headless:true});
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const report:{complete:boolean;referenceHub:boolean;packageHash:string;checks:unknown[];errors:string[];hashes:Record<string,string>}={complete:false,referenceHub:true,packageHash:registry.games[0].hash,checks:[],errors:[],hashes:{}};
const key='gf-hub:bouquet-season:save:progress',localKey='gf:bouquet-season:save:progress';
async function settled(frame:Frame){await frame.locator('#app[aria-busy="false"]').waitFor();await frame.locator('#drawer-layer[data-state="open"],#drawer-layer[data-state="closed"]').waitFor({state:'attached'});}
async function press(frame:Frame,action:string,touch:boolean){await settled(frame);const element=frame.locator(`#panel [data-action="${action}"]`);await element.scrollIntoViewIfNeeded();if(touch)await element.tap();else await element.click();await settled(frame);}
function readHttp(path:string):Promise<{status:number;csp:string}>{return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:play.port,path,headers:{Host:`bouquet-season.play.localhost:${play.port}`}},res=>{res.resume();resolve({status:res.statusCode!,csp:String(res.headers['content-security-policy']??'')});});req.on('error',reject);req.end();});}
try{
  const response=await readHttp('/');
  assert.equal(response.status,200);const csp=response.csp;
  assert.ok(csp.includes(`frame-ancestors ${hubOrigin}`));assert.ok(csp.includes("object-src 'none'"));assert.ok(!csp.includes("'unsafe-eval'"));
  report.checks.push({case:'packaged-html-and-csp',status:response.status,csp});
  for(const path of ['/src/main.ts','/assets/game.js.map']){const r=await readHttp(path);assert.ok(r.status===403||r.status===404);report.checks.push({case:'not-published',path,status:r.status});}
  for(const profile of [{id:'phone-portrait',width:390,height:844,touch:true},{id:'fullhd',width:1920,height:1080,touch:false}]){
    const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},hasTouch:profile.touch,isMobile:profile.touch});
    const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(hubOrigin);await page.locator('body[data-game-ready="1"]').waitFor();
    const fixture=await encode(moduleFixture(),50);
    await page.evaluate(({key,fixture})=>localStorage.setItem(key,JSON.stringify(fixture)),{key,fixture});await page.reload();await page.locator('body[data-game-ready="1"]').waitFor();
    // Эталонная HTML-страница не задаёт мобильный viewport. Исправляем только стенд.
    await page.evaluate(()=>{const meta=document.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';document.head.append(meta);});
    await page.addStyleTag({content:'body{margin:0;overflow:hidden}#game{display:block;border:0;width:100vw;height:100dvh}'});
    const frame=page.frames().find(f=>f.url().startsWith(gameOrigin));assert.ok(frame);await settled(frame);
    await frame.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height&&document.querySelector('canvas')?.clientWidth===width,{width:profile.width,height:profile.height});
    const frameViewport=await frame.evaluate(()=>({width:innerWidth,height:innerHeight,font:parseFloat(getComputedStyle(document.documentElement).fontSize)}));
    assert.equal(frameViewport.font,16);
    assert.ok((await frame.locator('#storage-status').textContent())!.startsWith('Game Factory'));
    const rect=await frame.evaluate(()=>{const font=parseFloat(getComputedStyle(document.documentElement).fontSize),top=document.querySelector('header')!.getBoundingClientRect().bottom+font*.5,bottom=document.getElementById('field-tools')!.getBoundingClientRect().top-font*.5;return{x:font,y:top,width:innerWidth-font*2,height:bottom-top};});
    const point=toScreen(fitField(rect),cellCenter({q:0,r:0}));
    // Координаты мыши принадлежат странице; iframe имеет обычный отступ body стенда.
    const bounds=await page.locator('#game').boundingBox();assert.ok(bounds);
    const border=await page.locator('#game').evaluate(e=>({left:e.clientLeft,top:e.clientTop}));
    const x=bounds.x+border.left+point.x,y=bounds.y+border.top+point.y;
    if(profile.touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
    await settled(frame);await frame.locator('[data-action="object-modules"]').waitFor();
    await press(frame,'object-modules',profile.touch);await press(frame,'object-module-1',profile.touch);
    const stored=await page.evaluate(key=>localStorage.getItem(key),key);assert.ok(stored);const record=JSON.parse(stored),state=JSON.parse(record.payload);assert.equal(record.revision,51);assert.ok(isGameState(state));assert.deepEqual(state.season!.effects.modules[0]!.at,{q:0,r:0});
    assert.equal(await frame.evaluate(key=>localStorage.getItem(key),localKey),null);
    const shot=`${profile.id}-hub-module.png`;await page.screenshot({path:resolve(out,shot)});report.hashes[shot]=sha(await readFile(resolve(out,shot)));
    await page.reload();await page.locator('body[data-game-ready="1"]').waitFor();assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),stored);
    assert.deepEqual(errors,[]);report.checks.push({case:'hub-module-reload',profile:profile.id,frameViewport,revision:record.revision,gameStorageEmpty:true,errors});
    await context.close();
  }
  const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage(),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(gameOrigin);await page.locator('html[data-gf-ready]').waitFor({state:'attached'});await settled(page.mainFrame());await press(page.mainFrame(),'start',false);
  assert.ok(await page.evaluate(key=>localStorage.getItem(key),localKey));assert.ok((await page.locator('#storage-status').textContent())!.startsWith('Самостоятельный запуск'));assert.deepEqual(errors,[]);
  report.checks.push({case:'standalone-packaged-start',errors});await context.close();report.complete=true;
}catch(error){report.errors.push(error instanceof Error?error.stack??error.message:String(error));process.exitCode=1;}
finally{await browser.close();await close(play.server);await close(hub);report.hashes['test/package-browser.ts']=sha(await readFile(import.meta.filename));report.hashes['game.json']=sha(await readFile(resolve(import.meta.dirname,'../game.json')));await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
