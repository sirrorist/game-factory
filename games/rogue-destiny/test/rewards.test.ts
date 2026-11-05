import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer} from '../src/core/player.ts';
import {claimDefeat} from '../src/core/rewards.ts';
test('один погибший враг даёт награду однажды независимо от числа обращений',()=>{
 const player=createPlayer(),claimed=new Set<string>(),enemy={id:'sylvan_f1_1',isAlive:true};
 assert.equal(claimDefeat(player,claimed,enemy,()=>{}),false);enemy.isAlive=false;
 assert.equal(claimDefeat(player,claimed,enemy,()=>{}),true);assert.equal(player.elitesDefeated,1);
 assert.equal(claimDefeat(player,claimed,enemy,()=>{}),false);assert.equal(player.elitesDefeated,1);
});
test('Нить босса начисляется до снимка, повтор и восстановленный мёртвый враг не дублируют её',()=>{
 const player=createPlayer(),claimed=new Set<string>(),boss={id:'warden_f1',isAlive:false};player.threadsOfFate=1;
 claimDefeat(player,claimed,boss,()=>{});assert.equal(player.threadsOfFate,2);assert.equal(player.elitesDefeated,1);
 const restoredClaimed=new Set(claimed);assert.equal(claimDefeat(player,restoredClaimed,boss,()=>{}),false);assert.equal(player.threadsOfFate,2);
 const reserves:unknown[]=[];player.threadsOfFate=3;claimDefeat(player,claimed,{id:'warden_f2',isAlive:false},item=>reserves.push(item));assert.equal(player.threadsOfFate,3);assert.equal(reserves.length,1);
});
