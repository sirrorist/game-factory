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
// Только образцы для приёмки сетки: обложки встроены, внешние игры/сеть не нужны.
const cover = (background, accent) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h640v360H0z"/><circle cx="485" cy="100" r="55" fill="${accent}"/><path d="M0 300 150 125 280 260 415 165 640 335v25H0z" fill="${background}" opacity=".75"/><path d="m150 125 40 42-40-11-29 24z" fill="#fff" opacity=".75"/><path d="M0 325 230 250 420 320 640 270v90H0z" fill="${background}"/><path d="m310 250 20-42 20 42-20 20z" fill="${accent}"/></svg>`);
const catalogSamples = [
  { title: 'Superwalk', colors: ['#244132', '#a7d56d'] },
  { title: 'Солнечные холмы', colors: ['#92451d', '#ffd17b'], description: 'Спокойное путешествие по тёплым холмам.', tags: ['adventure', 'exploration'] },
  { title: 'Приключение в лесу', colors: ['#164347', '#70e2c6'], description: 'Исследуй лес, собирай ресурсы, находи тайники и строй собственный лагерь. Днём открывай новые тропы, а ночью защищай убежище от лесных обитателей. Каждая вылазка приносит новые предметы, встречи и возможности для улучшений.', tags: ['survival', 'crafting', 'exploration', 'sandbox', 'building', 'adventure', 'singleplayer', 'procedural'] },
  { title: 'Лунная тропа', colors: ['#272252', '#b7a4fa'], version: '2.3.0', tags: ['platformer', '2d'] },
  { title: 'Звёздная смена', colors: ['#17365e', '#7bc9f2'], description: 'Управляй орбитальной станцией и встречай корабли.', tags: ['strategy', 'space', 'management'] },
  { title: 'Тихая бухта', colors: ['#185c68', '#a8e1d4'], description: '', tags: ['relax', 'fishing'] },
  { title: 'Башня искр', colors: ['#54283f', '#ff9992'], version: '10.24.128', tags: ['action', 'roguelike', 'magic', 'arena'] },
  { title: 'Мастерская облаков: путешествие над островами', colors: ['#5267a1', '#ffe4b2'], description: 'Собирай необычные механизмы и прокладывай маршруты между парящими островами.', tags: ['puzzle', 'building', 'physics', 'adventure'] },
  { title: 'Последний маяк', colors: null, description: 'Найди путь домой.', tags: ['story', 'exploration', 'atmospheric', 'singleplayer', 'adventure'] },
];
const catalogGames = () => catalogSamples.map((sample, index) => {
  const item = game(index === 0 ? 'superwalk' : `example-${index + 1}`, sample.title);
  item.entry.version = sample.version ?? item.entry.version;
  item.entry.manifest.description = sample.description ?? item.entry.manifest.description;
  item.entry.manifest.tags = sample.tags ?? item.entry.manifest.tags;
  item.coverUrl = sample.colors ? cover(...sample.colors) : null;
  return item;
});
export const listGames = () => scene() === 'catalog-empty' ? [] : catalogGames();
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
