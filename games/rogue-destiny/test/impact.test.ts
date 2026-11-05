import test from 'node:test';
import assert from 'node:assert/strict';
import {createImpactPool,emitImpact,tickImpactPool,clearImpactPool,createCameraImpulse,kickCamera,tickCameraImpulse} from '../src/core/impact.ts';
test('пул эффектов ограничен и переиспользует те же объекты при серии попаданий',()=>{
 const pool=createImpactPool(24),original=[...pool.particles];
 for(let i=0;i<100;i++)emitImpact(pool,1,2,3,'#fff',8);
 assert.equal(pool.particles.length,24);assert.ok(pool.particles.every((particle,index)=>particle===original[index]));assert.equal(tickImpactPool(pool,0),24);
 clearImpactPool(pool);assert.equal(tickImpactPool(pool,0),0);
});
test('частицы движутся по времени и исчезают одинаково при 30/144 Гц',()=>{
 for(const fps of [30,144]){const pool=createImpactPool(4);emitImpact(pool,0,1,0,'#fff',4);for(let i=0;i<fps/2;i++)tickImpactPool(pool,1/fps);assert.equal(tickImpactPool(pool,0),0);}
 const a=createImpactPool(1),b=createImpactPool(1);emitImpact(a,0,0,0,'#fff',1);emitImpact(b,0,0,0,'#fff',1);
 tickImpactPool(a,0.1);for(let i=0;i<10;i++)tickImpactPool(b,0.01);assert.ok(Math.abs(a.particles[0]!.y-b.particles[0]!.y)<1e-8);
});
test('толчок ограничен, затухает и отключается при уменьшении движения',()=>{
 const state=createCameraImpulse();kickCamera(state,10);assert.equal(state.strength,0.06);
 assert.deepEqual(tickCameraImpulse(state,0.05,true),{x:0,y:0});const active=tickCameraImpulse(state,0.01,false);assert.ok(Math.abs(active.x)<=0.06&&Math.abs(active.y)<=0.036);
 tickCameraImpulse(state,1,false);assert.equal(state.strength,0);assert.deepEqual(tickCameraImpulse(state,0,false),{x:0,y:0});
});
