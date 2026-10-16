export const HUB_SCENES = [
  ['catalog', 'Каталог'], ['catalog-empty', 'Пустой каталог'],
  ['game', 'Страница игры'], ['game-loading', 'Загрузка игры'],
  ['login', 'Вход: форма'], ['login-unavailable', 'Вход: база не настроена'],
  ['account', 'Аккаунт'], ['account-empty', 'Аккаунт: нет passkey'], ['account-error', 'Аккаунт: ошибка'],
  ['kit', 'UI-kit'], ['not-found', '404'],
].map(([id, label]) => ({ id: id!, label: label! }));
