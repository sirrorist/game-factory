// Примеры для локального просмотра. Этот модуль не импортируется хабом и не меняет его авторизацию.
import React from 'react';
const scene = () => globalThis.__HUB_UI_SCENE__ ?? 'catalog';
export const user = { id: 'ui-example', name: 'Игрок Superwalk', email: 'player@example.test' };
export const currentUser = async () => /^(account|kit)/.test(scene()) ? user : null;
export const currentOwner = currentUser;
export const hubAuth = () => scene() === 'login-unavailable' ? null : {};

export function Link({ href, children, ...props }) { return <a href={href} {...props}>{children}</a>; }
export function usePathname() {
  return scene().startsWith('game') ? '/games/superwalk' : scene() === 'kit' ? '/kit'
    : scene().startsWith('account') ? '/account' : scene().startsWith('login') ? '/login' : '/';
}
export const useRouter = () => ({ push: path => location.assign(path), refresh: () => {} });
export const redirect = path => { throw new Error(`Переход ${path} не ожидается в выбранном UI-примере`); };
export const notFound = () => { throw new Error('Игра не найдена в UI-примере'); };

const game = (id, title) => ({
  entry: { id, version: '1.1.1', manifest: { title, description: 'Лис бежит по солнечным холмам: автоатака, предметы, улучшения и босс. Играй на ПК и телефоне.', tags: ['3d', 'roguelite', 'survival'], permissions: [] } },
  prerelease: false, gameOrigin: location.origin, coverUrl: null,
  download: { url: '/ui-example.zip', bytes: 364 * 1024 },
});
export const listGames = () => scene() === 'catalog-empty' ? [] : [game('superwalk', 'Superwalk'), game('example-2', 'Солнечные холмы'), game('example-3', 'Приключение в лесу')];
export const findGame = () => game('superwalk', 'Superwalk');
export const frameAttributes = () => ({ sandbox: 'allow-scripts allow-same-origin', allow: 'fullscreen' });
export function connectGame({ onEvent }) {
  const timer = scene() === 'game-loading' ? null : setTimeout(() => onEvent({ type: 'ready' }), 150);
  return () => { if (timer !== null) clearTimeout(timer); };
}
export const storageHandlers = () => ({ bestScore: async () => 4065, submitScore: async score => ({ best: Math.max(4065, score) }) });

export const authClient = {
  signIn: { email: async () => ({ error: { status: 401 } }), passkey: async () => ({ error: true }) },
  signOut: async () => {},
  passkey: {
    listUserPasskeys: async () => scene() === 'account-error' ? { error: true }
      : { data: scene() === 'account-empty' ? [] : [{ id: 'ui-key-1', name: 'Телефон' }, { id: 'ui-key-2', name: 'Ключ на компьютере' }] },
    addPasskey: async () => ({ error: true }), deletePasskey: async () => ({ error: true }),
  },
};
