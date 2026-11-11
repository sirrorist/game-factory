import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkRelease,OBFUSCATION_MARK} from '../build/release-check.ts';
const clean=[{path:'index.html',data:'<script src="assets/game.js"></script>'},{path:'assets/game.js',data:OBFUSCATION_MARK+'\n(()=>{})();'}];
test('Чистый релиз принимается, публикация без обфускации отклоняется',()=>{
  assert.doesNotThrow(()=>checkRelease(clean));assert.throws(()=>checkRelease(clean.map(f=>({...f,data:f.data.replace(OBFUSCATION_MARK,'')}))),/обфускации/);
});
test('Внешние, hidden и inline-карты и исходники отвергаются',()=>{
  for(const path of ['assets/game.js.map','assets/hidden.map','src/main.ts','test/probe.ts','build/config.ts','.env'])assert.throws(()=>checkRelease([...clean,{path,data:'{}'}]),/Исходники/);
  for(const data of ['//# sourceMappingURL=game.js.map','//# sourceMappingURL=data:application/json;base64,e30=','/*# sourceMappingURL=style.css.map */'])assert.throws(()=>checkRelease([...clean,{path:'assets/leak.js',data}]),/Карта исходников/);
});
