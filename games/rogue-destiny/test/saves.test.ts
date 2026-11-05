import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedRun, parseMetaProgress } from '../src/core/saves.ts';
import { createInventory, placeItem, calculateInventoryStats } from '../src/core/inventory.ts';
const snapshot=()=>({floor:1,hp:80,greyHp:10,threadsOfFate:2,score:10,injuriesCount:1,elitesDefeated:0,lightSupply:85,aetherHeat:25,fatigue:4,inventoryItems:[],quickSlots:[null,null,null,null]});
const item=()=>({id:'a',name:'Руна',category:'rune',rarity:'common',element:'fire',shape:[{x:0,y:0}],weight:1,rotation:0,gridX:0,gridY:0});
const world=()=>({player:{x:0,z:0,yaw:0,pitch:0.15},rooms:[{id:'room_0',revealed:true,visited:true}],activeRoomId:'room_0',enemies:[{id:'enemy',hp:0,x:0,z:0,stealthAvailable:false}],mimics:[{roomId:'room_3',opened:true,awakened:false}]});

test('пустой ранец является допустимым сохранением',()=>{assert.ok(parseSavedRun(snapshot()));});
test('повреждённые ресурсы и ссылки быстрых слотов отклоняются',()=>{
 for(const bad of [{hp:NaN},{hp:0},{floor:Infinity},{floor:1.5},{greyHp:80},{quickSlots:['lost',null,null,null]},{inventoryItems:[null]},{world:{}},{threadsOfFate:4},{aetherHeat:-1},{aetherCore:101},{temporaryMana:Infinity},{seed:-1},{seed:1.1},{muddied:[{x:5,y:0}]}]) assert.equal(parseSavedRun({...snapshot(),...bad}),null,JSON.stringify(bad));
 assert.equal(parseSavedRun(null),null);assert.equal(parseSavedRun([]),null);
});
test('состояние мира сохраняет мёртвых врагов и открытые сундуки',()=>{
 const w=world();assert.deepEqual(parseSavedRun({...snapshot(),world:w})?.world,w);
 assert.equal(parseSavedRun({...snapshot(),world:{...w,player:{...w.player,x:NaN}}}),null);
});
test('пересечения предметов, дубли id и выход из сетки не восстанавливаются',()=>{
 const a=item();
 for(const items of [[a,{...a,id:'b'}],[a,{...a,gridX:1}],[{...a,gridX:5}],[{...a,rotation:45}],[{...a,id:'unsafe[id]'}],[{...a,shape:[]}],[{...a,shape:[{x:0,y:0},{x:0,y:0}]}],[{...a,shape:[{x:0.5,y:0}]}]]) assert.equal(parseSavedRun({...snapshot(),inventoryItems:items}),null);
 const placed={...a,rotation:90,shape:[{x:0,y:0},{x:0,y:1}],gridX:3,gridY:3};
 assert.ok(parseSavedRun({...snapshot(),inventoryItems:[placed],quickSlots:[null,null,null,'a']}));
});
test('используемые параметры предмета и грязь проверяются без потери состояния',()=>{
 const a={...item(),isSpoiled:true,durability:0,maxDurability:12};
 const saved={...snapshot(),inventoryItems:[a],muddied:[{x:0,y:0}],temporaryMana:17,aetherCore:42,seed:12345};
 assert.deepEqual(parseSavedRun(saved),saved);
 for(const bad of [{damage:NaN},{weight:-1},{isSpoiled:'yes'},{durability:-1},{defense:Infinity}]) assert.equal(parseSavedRun({...snapshot(),inventoryItems:[{...a,...bad}]}),null);
});
test('активные эффекты врага и перевязка сохраняют остаток времени',()=>{
 const w={...world(),enemies:[{...world().enemies[0]!,effects:{poison:2.5,slow:1.2,damageBuffer:0.3}}],healing:{remaining:1.7,amount:30},oracle:'won'};
 assert.deepEqual(parseSavedRun({...snapshot(),world:w})?.world,w);
 for(const bad of [{healing:{remaining:4,amount:30}},{oracle:'active'},{enemies:[{...w.enemies[0],effects:{poison:5,slow:0,damageBuffer:0}}]}]) assert.equal(parseSavedRun({...snapshot(),world:{...w,...bad}}),null);
});
test('трофей на земле сохраняется, одинаковый id в мире и ранце отклоняется',()=>{
 const a=item(),w={...world(),drops:[{item:{...a,gridX:undefined,gridY:undefined},x:2,z:3}]};
 assert.deepEqual(parseSavedRun({...snapshot(),world:w})?.world,w);
 assert.equal(parseSavedRun({...snapshot(),inventoryItems:[a],world:w}),null);
 assert.equal(parseSavedRun({...snapshot(),world:{...w,drops:[...w.drops,...w.drops]}}),null);
 assert.equal(parseSavedRun({...snapshot(),world:{...w,drops:[{...w.drops[0],x:NaN}]}}),null);
});
test('назначение инструмента проходит сохранение, неизвестное отвергается',()=>{
 const a={...item(),category:'tool',utility:'breathing'};
 assert.ok(parseSavedRun({...snapshot(),inventoryItems:[a]}));assert.equal(parseSavedRun({...snapshot(),inventoryItems:[{...a,utility:'anything'}]}),null);
});
test('таймеры порчи припасов сохраняются и имеют ограниченный диапазон',()=>{
 const a={...item(),category:'scroll',burnTime:3.5,poisonTime:0};
 assert.equal(parseSavedRun({...snapshot(),inventoryItems:[a]})?.inventoryItems[0]?.burnTime,3.5);
 for(const bad of [{burnTime:9},{poisonTime:7},{burnTime:NaN}]) assert.equal(parseSavedRun({...snapshot(),inventoryItems:[{...a,...bad}]}),null);
});
test('разрыв цепи и активное облако сохраняются без восстановления силы',()=>{
 const a={...item(),category:'relic',element:'aether',relicEffect:'chain',isSevered:true};
 const w={...world(),steam:{remaining:2.3,damageBuffer:0.7,x:2,z:3}};
 const saved=parseSavedRun({...snapshot(),inventoryItems:[a],world:w})!;
 assert.equal(saved.inventoryItems[0]?.isSevered,true);assert.deepEqual(saved.world?.steam,w.steam);
 const grid=createInventory();for(const restored of saved.inventoryItems)placeItem(grid,restored,restored.gridX!,restored.gridY!);
 assert.equal(calculateInventoryStats(grid).totalArmor,0);
 assert.equal(parseSavedRun({...snapshot(),inventoryItems:[{...a,isSevered:1}]}),null);
 assert.equal(parseSavedRun({...snapshot(),world:{...w,steam:{...w.steam,remaining:5}}}),null);
});
test('плохая мета не отравляет следующий забег, Кодекс фильтруется',()=>{
 assert.deepEqual(parseMetaProgress(null),{highScore:0,totalRuns:0,victories:0,highestFloor:1,totalElites:0,codex:[]});
 assert.deepEqual(parseMetaProgress({highScore:Infinity,totalRuns:-1,victories:1.5,highestFloor:0,totalElites:12,codex:['sylvan_ciphers','unknown','sylvan_ciphers']}),{highScore:0,totalRuns:0,victories:0,highestFloor:1,totalElites:12,codex:['sylvan_ciphers']});
});

test('разрушенный зал сохраняется, неправильное состояние руин отклоняется',()=>{
 const w={...world(),rooms:[{id:'room_0',revealed:true,visited:true,devastated:true}]};
 assert.equal(parseSavedRun({...snapshot(),world:w})?.world?.rooms[0]?.devastated,true);
 assert.equal(parseSavedRun({...snapshot(),world:{...w,rooms:[{...w.rooms[0],devastated:'yes'}]}}),null);
});

test('выбранный стиль парирования сохраняется и проверяется',()=>{
 const focus={...item(),category:'shield',parryType:'siphon'};
 assert.equal(parseSavedRun({...snapshot(),inventoryItems:[focus]})?.inventoryItems[0]?.parryType,'siphon');
 assert.equal(parseSavedRun({...snapshot(),inventoryItems:[{...focus,parryType:'anything'}]}),null);
});

test('паёк и начатое применение воды сохраняют эффект усталости',()=>{
 const ration={...item(),category:'potion',fatigueRestore:35};const w={...world(),healing:{remaining:1.2,amount:0,fatigueAmount:35}};
 assert.equal(parseSavedRun({...snapshot(),inventoryItems:[ration],world:w})?.world?.healing?.fatigueAmount,35);
 assert.equal(parseSavedRun({...snapshot(),inventoryItems:[{...ration,fatigueRestore:101}]}),null);
 assert.equal(parseSavedRun({...snapshot(),world:{...w,healing:{...w.healing,fatigueAmount:-1}}}),null);
});

test('идентификатор попытки сохраняется, старые снимки без него остаются допустимыми',()=>{
 assert.equal(parseSavedRun({...snapshot(),runId:'attempt_abc'})?.runId,'attempt_abc');assert.ok(parseSavedRun(snapshot()));
 assert.equal(parseSavedRun({...snapshot(),runId:'<invalid>'}),null);
});

test('резервная Нить сохраняется как предмет без изменения активного пула',()=>{
 const thread={...item(),category:'relic',rarity:'holy',element:'aether',relicEffect:'thread'};
 const saved=parseSavedRun({...snapshot(),threadsOfFate:3,inventoryItems:[thread]});assert.equal(saved?.threadsOfFate,3);assert.equal(saved?.inventoryItems[0]?.relicEffect,'thread');
});
