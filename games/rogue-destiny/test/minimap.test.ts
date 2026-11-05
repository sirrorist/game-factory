import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor } from '../src/core/dungeon.ts';
import { minimapLayout } from '../src/core/minimap.ts';

test('карта вмещает значки всех обычных и найденных секретных комнат', () => {
  for (const seed of [1, 12345, 54321]) for (const level of [1,2,3]) {
    const floor = generateFloor(level,seed);
    for (const room of floor.rooms) room.isRevealed = true;
    const layout = minimapLayout(floor.rooms,160,100);
    for (const room of floor.rooms) {
      const x=room.x*layout.scale+layout.offsetX, y=room.y*layout.scale+layout.offsetY;
      assert.ok(x>=12-1e-8 && x<=148+1e-8 && y>=12-1e-8 && y<=88+1e-8);
    }
  }
});
test('скрытая комната не выдаёт себя изменением масштаба', () => {
  const floor = generateFloor(1,1);
  assert.ok(floor.rooms.some(room=>room.secret));
  assert.deepEqual(minimapLayout(floor.rooms,160,100),minimapLayout(floor.rooms.filter(room=>!room.secret),160,100));
  assert.deepEqual(minimapLayout([],160,100),{scale:1,offsetX:80,offsetY:50});
});

import { mapMarkerVisible } from '../src/core/minimap.ts';
test('метки скрыты в неизвестных комнатах и появляются после раскрытия',()=>{
 const floor=generateFloor(1,1),secret=floor.rooms.find(room=>room.secret)!,hall=floor.rooms.find(room=>room.type==='hall')!;
 assert.equal(mapMarkerVisible(floor,secret.x,secret.y),false);assert.equal(mapMarkerVisible(floor,hall.x,hall.y),false);
 hall.isRevealed=true;assert.equal(mapMarkerVisible(floor,hall.x,hall.y),true);
 secret.isRevealed=true;assert.equal(mapMarkerVisible(floor,secret.x,secret.y),true);
});
test('позиции у внешних краёв комнат остаются в области карты',()=>{
 const floor=generateFloor(3,1);for(const room of floor.rooms)room.isRevealed=true;
 const layout=minimapLayout(floor.rooms,160,120);
 for(const room of floor.rooms)for(const sx of [-1,1])for(const sy of [-1,1]) {
  const x=(room.x+sx*room.width/2)*layout.scale+layout.offsetX,y=(room.y+sy*room.height/2)*layout.scale+layout.offsetY;
  assert.ok(x>=12-1e-8&&x<=148+1e-8&&y>=12-1e-8&&y<=108+1e-8);
 }
});
