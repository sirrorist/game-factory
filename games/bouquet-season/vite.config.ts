import { defineConfig } from 'vite';
import { gameConfig } from '@gf/vite-config';
import { gameObfuscation } from './build/obfuscation.ts';

const config = gameConfig({ root: import.meta.dirname });
export default defineConfig({
  ...config,
  plugins: [...(config.plugins ?? []), gameObfuscation(import.meta.dirname)],
  build: { ...config.build, sourcemap: false },
});
