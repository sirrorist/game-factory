import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { normalizePath, type Plugin } from 'vite';
import { OBFUSCATION_MARK } from './release-check.ts';

// Только собственные JS-модули после снятия TypeScript; зависимости не затрагиваются.
export function gameObfuscation(root: string): Plugin {
  const source = normalizePath(resolve(root, 'src')) + '/';
  const transformed = new Set<string>();
  return {
    name: 'bouquet-season-obfuscation',
    apply: 'build',
    enforce: 'post',
    buildStart() { transformed.clear(); },
    transform(code, id) {
      const file = normalizePath(id.split('?')[0]!);
      if (!file.startsWith(source) || !file.endsWith('.ts')) return null;
      const name = relative(source, file).replaceAll('\\', '/');
      const prefix = createHash('sha256').update(name).digest('hex').slice(0, 8);
      const result = JavaScriptObfuscator.obfuscate(code, {
        seed: 20261105,
        identifiersPrefix: `b${prefix}_`,
        compact: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        renameProperties: false, // Контракты JSON, SDK и Phaser остаются совместимыми.
        stringArray: true,
        stringArrayThreshold: 0.5,
        stringArrayEncoding: [],
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        selfDefending: false,
        disableConsoleOutput: false,
        sourceMap: false,
      });
      transformed.add(file);
      return { code: result.getObfuscatedCode(), map: null };
    },
    generateBundle(_options, bundle) {
      if (!transformed.has(normalizePath(resolve(root, 'src/main.ts')))) this.error('Код игры не прошёл обфускацию.');
      for (const file of Object.values(bundle)) if (file.type === 'chunk' && file.isEntry) file.code = OBFUSCATION_MARK + '\n' + file.code;
    },
  };
}
