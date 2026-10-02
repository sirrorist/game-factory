// Имена CSRF-куки и заголовка - отдельно от csrf.ts: тот тянет node:crypto, а клиенту хаба
// (auth-client.ts, браузер) нужны только имена.
export const CSRF_COOKIE = '__Host-gf-csrf';
export const CSRF_HEADER = 'x-gf-csrf';
