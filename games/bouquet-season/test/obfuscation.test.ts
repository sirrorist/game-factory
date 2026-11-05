import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { gameObfuscation } from '../build/obfuscation.ts';

const root = resolve(import.meta.dirname, '..');
function transform(code: string, file: string) {
  const plugin = gameObfuscation(root);
  assert.equal(typeof plugin.transform, 'function');
  return (plugin.transform as Function).call({}, code, file) as {code:string;map:null}|null;
}
test('Обфускация сохраняет публичные JSON-поля, экспорт и поведение приватных методов', async () => {
  const source = 'export class Example { #calculate(value){ return value+2; } run(state){ return { coins:this.#calculate(state.coins),revision:state.revision+1 }; } }';
  const result = transform(source, resolve(root,'src/check.ts'));
  assert.ok(result);assert.notEqual(result.code,source);assert.equal(result.map,null);
  const {Example}=await import('data:text/javascript;base64,'+Buffer.from(result.code).toString('base64'));
  assert.deepEqual(new Example().run({coins:5,revision:7}),{coins:7,revision:8});
});
test('Одинаковый исходник и путь дают одинаковый результат обфускации', () => {
  const source = 'export function answer(){ return "Сезон букетов"; }',file=resolve(root,'src/main.ts');
  assert.equal(transform(source,file)!.code,transform(source,file)!.code);
});
test('Сторонние зависимости и файлы вне src не обфусцируются', () => {
  for(const file of ['node_modules/phaser/src/scene/Scene.js','../../packages/game-sdk/gf-sdk.js','test/check.ts'])assert.equal(transform('export const untouched=1;',resolve(root,file)),null);
});

test('Сборка отклоняется, если основной модуль не прошёл обфускацию', () => {
  const plugin=gameObfuscation(root);assert.equal(typeof plugin.generateBundle,'function');
  assert.throws(()=>(plugin.generateBundle as Function).call({error:(message:string)=>{throw Error(message);}},null,{}),/не прошёл обфускацию/);
});
