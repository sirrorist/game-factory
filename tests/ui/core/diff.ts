import type { Page } from 'playwright';

export async function pixelDifference(page: Page, before: string, after: string) {
  return page.evaluate(async ({ before, after }) => {
    const load = (url: string) => new Promise<HTMLImageElement>((accept, reject) => { const img = new Image(); img.onload = () => accept(img); img.onerror = reject; img.src = url; });
    const [a, b] = await Promise.all([load(before), load(after)]);
    if (a.width !== b.width || a.height !== b.height) throw new Error('Снимки имеют разные размеры');
    const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(a, 0, 0); const old = ctx.getImageData(0, 0, a.width, a.height);
    ctx.drawImage(b, 0, 0); const current = ctx.getImageData(0, 0, b.width, b.height);
    let changed = 0;
    for (let i = 0; i < old.data.length; i += 4) {
      const different = Math.max(Math.abs(old.data[i]! - current.data[i]!), Math.abs(old.data[i+1]! - current.data[i+1]!), Math.abs(old.data[i+2]! - current.data[i+2]!)) > 16;
      if (different) changed++;
      current.data[i] = different ? 255 : current.data[i]! * .25;
      current.data[i+1] = different ? 65 : current.data[i+1]! * .25;
      current.data[i+2] = different ? 130 : current.data[i+2]! * .25;
    }
    ctx.putImageData(current, 0, 0);
    return { changedPercent: changed / (a.width * a.height) * 100, png: canvas.toDataURL('image/png').split(',')[1]! };
  }, { before, after });
}
