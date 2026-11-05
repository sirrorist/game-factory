export const OBFUSCATION_MARK = '/*! bouquet-season: own-code-obfuscated */';
export interface ReleaseFile { path: string; data: string }
export function checkRelease(files: ReleaseFile[]): void {
  if (!files.some(file => file.path.endsWith('.js') && file.data.includes(OBFUSCATION_MARK))) throw Error('В релизе нет отметки обфускации.');
  for (const file of files) {
    if (/(^|\/)(src|test|build|node_modules)\//.test(file.path) || /\.(?:map|ts|tsx)$/.test(file.path) || /(^|\/)\./.test(file.path)) throw Error(`Исходники/карты не должны попадать в релиз: ${file.path}`);
    if (/\.(?:js|css|html)$/.test(file.path) && /sourceMappingURL\s*=/.test(file.data)) throw Error(`Карта исходников в релизе: ${file.path}`);
  }
}
