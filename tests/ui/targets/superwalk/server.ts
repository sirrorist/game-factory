import { startComparison as start } from '../../core/server.ts';
import { OUT } from './snapshot.ts';
import { PROFILES, SCENES } from './config.ts';
import { prepareScene } from './fixtures.ts';
import { gameEvidence } from './evidence.ts';

function transformHtml(html: string, url: URL): string {
  const seed = `<script>try{localStorage.clear()}catch{};let uiSeed=123456,uiCryptoSeed=987654321;Math.random=()=>{uiSeed=(Math.imul(uiSeed,1664525)+1013904223)>>>0;return uiSeed/4294967296};crypto.getRandomValues=array=>{const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);for(let i=0;i<bytes.length;i++){uiCryptoSeed=(Math.imul(uiCryptoSeed,1664525)+1013904223)>>>0;bytes[i]=uiCryptoSeed>>>24}return array};Date.now=()=>1791849600000;requestAnimationFrame=()=>0;</script>`;
  const requested = url.searchParams.get('scene') ?? 'hud';
  const scene = SCENES.some(s => s.id === requested) ? requested : 'hud';
  const fixture = `<script>(async()=>{try{while(!globalThis.__SW_UI__)await new Promise(r=>setTimeout(r,10));await (${prepareScene.toString()})(globalThis.__SW_UI__,${JSON.stringify(scene)},${url.searchParams.get('touch') === '1'});}catch(e){console.error(e);document.documentElement.dataset.uiError=String(e);}})();</script>`;
  if (url.searchParams.get('live') !== '1') {
    // Меняем только CSS тестового просмотра. matchMedia игры остаётся настоящим.
    if (url.searchParams.get('touch') === '1') html = html.replace(/<style>[\s\S]*?<\/style>/g, css => css.replace(/\(pointer:\s*coarse\)/g, '(min-width:0px)'));
    html = html.replace('<head>', '<head>' + seed).replace('</body>', fixture + '</body>');
  }
  return html;
}

export function comparison() {
  return { id: 'superwalk', title: 'Superwalk', out: OUT, profiles: PROFILES, scenes: SCENES, transformHtml,
    validateReport: (report: unknown) => {
      try {
        const current = gameEvidence('check.ts');
        const saved = report as typeof current;
        return JSON.stringify({ snapshots: saved.snapshots, toolHash: saved.toolHash }) === JSON.stringify(current);
      } catch { return false; }
    } };
}

export async function startComparison(port = 0) {
  return start(comparison(), port);
}
