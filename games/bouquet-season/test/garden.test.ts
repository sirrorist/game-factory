import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGarden, editGarden, isGarden } from '../src/core/garden.ts';
import { newPlant } from '../src/core/growth.ts';
import { changeLayout, type Layout, type LayoutCommand } from '../src/core/layout.ts';

test('Пустой сад и создание записей только для растений, включая сохранённый undo',()=>{
  const layout:Layout={objects:[{kind:'carnation',q:0,r:0,adaptation:0},{kind:'lamp',q:1,r:0,adaptation:0}],undo:[]};
  const garden=newGarden(layout);
  assert.deepEqual(garden,{plants:[newPlant({q:0,r:0})],undo:[],stock:{carnation:0,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0}});
  assert.equal(isGarden(garden,layout,1),true);
  assert.deepEqual(newGarden({objects:[],undo:null}).plants,[]);
});
test('Перенос/удаление/отмена сохраняют весь прогресс и урожай, установка начинает новый цикл',()=>{
  let layout:Layout={objects:[{kind:'carnation',q:0,r:0,adaptation:0}],undo:null};
  let garden=newGarden(layout);
  garden.plants[0]={...garden.plants[0]!,growth:8,growthDays:2,bonus:true,yield:3};garden.stock.carnation=5;
  const original=structuredClone(garden);
  const edit=(command:LayoutCommand)=>{layout=changeLayout(layout,command);garden=editGarden(garden,command);assert.ok(isGarden(garden,layout,3));};
  edit({type:'move',from:{q:0,r:0},to:{q:1,r:0}});
  assert.deepEqual(garden.plants[0],{...original.plants[0],q:1,r:0});
  edit({type:'undo'});assert.deepEqual(garden,original);
  edit({type:'remove',from:{q:0,r:0}});assert.deepEqual(garden.plants,[]);
  edit({type:'undo'});assert.deepEqual(garden,original);
  edit({type:'place',kind:'chrysanthemum',to:{q:1,r:0}});
  assert.deepEqual(garden.plants[1],newPlant({q:1,r:0}));assert.equal(garden.stock.carnation,5);
  edit({type:'place',kind:'lamp',to:{q:0,r:1}});assert.equal(garden.plants.length,2);
});
test('Проверка данных связывает растения/undo с расстановкой, отвергает форму, диапазоны и несогласованный урожай',()=>{
  const layout:Layout={objects:[{kind:'carnation',q:0,r:0,adaptation:0}],undo:null};
  const garden=newGarden(layout),plant=garden.plants[0]!;
  const invalid=[{...plant,extra:1},{...plant,q:1},{...plant,growth:1},{...plant,growthDays:1},{...plant,wilt:4},
    {...plant,wilt:3,bonus:true},{...plant,recovering:1},{...plant,growth:8,growthDays:2,yield:2},
    {...plant,growth:8,growthDays:2,yield:3,bonus:false,supportBonus:false},{...plant,growth:4,growthDays:2,yield:2},
    {...plant,growth:8,growthDays:2,wilt:3,yield:3},{...plant,bonus:'да'},
    {...plant,growthDays:NaN},{...plant,growthDays:1.5}];
  for(const p of invalid)assert.equal(isGarden({...garden,plants:[p]},layout,4),false,JSON.stringify(p));
  for(const plants of [[],[plant,plant],Array(1),null])assert.equal(isGarden({...garden,plants},layout,4),false);
  assert.equal(isGarden({...garden,undo:[]},layout,4),false);
  assert.equal(isGarden(garden,{...layout,undo:[]},4),false);
  for(const stock of [{carnation:-1,chrysanthemum:0,rose:0,tulip:0,gerbera:0,lily:0},{carnation:0,chrysanthemum:Infinity,rose:0,tulip:0,gerbera:0,lily:0},{carnation:0,chrysanthemum:0,rose:0}])assert.equal(isGarden({...garden,stock},layout,4),false);
  assert.equal(isGarden({...garden,plants:[{...plant,growth:8,growthDays:2,yield:3}]},layout,1),false);
  assert.equal(isGarden({...garden,plants:[{...plant,wilt:1}]},layout,1),false);
});
