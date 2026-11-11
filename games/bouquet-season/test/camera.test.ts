import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_TOP,FIELD_BOTTOM,fitField,toScreen,toWorld,zoomField,panField } from '../src/core/camera.ts';
import { fieldCells,cellCorners } from '../src/core/field.ts';
test('Обзор вмещает полный контур, преобразования обратимы на телефоне и 4K',()=>{
  for(const [width,height] of [[358,610],[800,235],[3760,1700]])for(const size of [19,37] as const){
    const rect={x:16,y:80,width:width!,height:height!};const view=fitField(rect,size);
    for(const c of fieldCells(size))for(const p of cellCorners(c)){
      const s=toScreen(view,p);assert.ok(s.x>=rect.x && s.x<=rect.x+rect.width && s.y>=rect.y && s.y<=rect.y+rect.height);
      const top=toScreen(view,{x:p.x,y:p.y-FIELD_TOP}),bottom=toScreen(view,{x:p.x,y:p.y+FIELD_BOTTOM});
      assert.ok(top.y>=rect.y-1e-6 && bottom.y<=rect.y+rect.height+1e-6,'цветы и грани клеток в кадре');
      const back=toWorld(view,s);assert.ok(Math.abs(back.x-p.x)<1e-8 && Math.abs(back.y-p.y)<1e-8);
    }
  }
});
test('Масштаб держит точку под курсором, имеет границы; камеру нельзя унести далеко от поля',()=>{
  const view=fitField({x:0,y:0,width:800,height:600});const anchor={x:430,y:330};
  const zoom=zoomField(view,2,anchor);assert.deepEqual(toWorld(zoom,anchor),toWorld(view,anchor));
  assert.equal(zoomField(view,1e9,anchor).zoom,view.fitZoom*4);
  assert.equal(zoomField(view,.0001,anchor).zoom,view.fitZoom);
  const pan=panField(view,1e9,-1e9);assert.ok(Math.abs(pan.center.x)<400 && Math.abs(pan.center.y)<400);
});
test('Перемещение за секунду одинаково при 60 и 144 Гц',()=>{
  const initial=fitField({x:0,y:0,width:800,height:600});
  function simulate(hz:number){let v=initial;for(let i=0;i<hz;i++)v=panField(v,-60/hz,0);return v;}
  assert.ok(Math.abs(simulate(60).center.x-simulate(144).center.x)<1e-9);
});
