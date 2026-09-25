// Вход для сборщиков (Vite): import { GameFactory } from '@gf/game-sdk'.
// Сам SDK — классический скрипт; здесь он подключается ради побочного эффекта.
import './gf-sdk.js';

export const GameFactory = globalThis.GameFactory;
