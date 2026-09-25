import { defineConfig } from 'vite';
import { gameConfig } from '@gf/vite-config';

// offline берётся из game.json: true — всё соберётся в один index.html для file://.
export default defineConfig(gameConfig({ root: import.meta.dirname }));
