import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalOrigin, MAIL_KINDS, validMailbox, validSecret, type MailKind } from './protocol.ts';

export type Profile = Readonly<{
  kind: MailKind; from: string; origin: string; subject: string;
  textBefore: string; textAfter: string; htmlBefore: string; htmlAfter: string;
}>;
export type Profiles = Readonly<Record<MailKind, Profile>>;
export type RelayConfig = Readonly<{ profiles: Profiles; profilePin: string; hubOrigin: string; serviceSecret: string; apiKey: string }>;
const CONTENT = Object.freeze({
  'verify-email.v1': Object.freeze({
    subject: 'Подтверждение почты Game Factory',
    textBefore: 'Подтверди адрес электронной почты Game Factory:\n',
    textAfter: '\nЕсли ты не запрашивал письмо, просто проигнорируй его.',
    htmlBefore: '<p>Подтверди адрес электронной почты Game Factory.</p><p><a href="',
    htmlAfter: '">Подтвердить почту</a></p><p>Если ты не запрашивал письмо, просто проигнорируй его.</p>',
  }),
  'reset-password.v1': Object.freeze({
    subject: 'Восстановление доступа Game Factory',
    textBefore: 'Чтобы восстановить доступ к Game Factory, открой ссылку:\n',
    textAfter: '\nЕсли ты не запрашивал восстановление, просто проигнорируй письмо.',
    htmlBefore: '<p>Восстановление доступа к Game Factory.</p><p><a href="',
    htmlAfter: '">Восстановить доступ</a></p><p>Если ты не запрашивал восстановление, просто проигнорируй письмо.</p>',
  }),
});
export function createProfiles(origin: string, sender: string): Profiles {
  canonicalOrigin(origin);
  if (!validMailbox(sender)) throw new Error('неверная конфигурация почтового профиля');
  return Object.freeze(Object.fromEntries(MAIL_KINDS.map((kind) => [kind, Object.freeze({
    kind, from: 'Game Factory <' + sender + '>', origin, ...CONTENT[kind],
  })]))) as Profiles;
}
export function profileFingerprint(profiles: Profiles): string {
  return createHash('sha256').update(JSON.stringify(MAIL_KINDS.map((kind) => profiles[kind]))).digest('hex');
}
export function secretFile(file: string | undefined): string {
  if (!file) throw new Error('не настроен файл почтового секрета');
  try {
    const value = readFileSync(file, 'utf8').trim();
    if (value) return value;
  } catch { /* Не журналируем путь или ошибку файловой системы. */ }
  throw new Error('не удалось загрузить почтовый секрет');
}
export function relayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  try {
    const hubOrigin = canonicalOrigin(env.GF_HUB_ORIGIN ?? '');
    const profiles = createProfiles(hubOrigin, env.GF_MAIL_FROM ?? '');
    // Pin хранится вместе с профилем: изменение v1 не меняет старые письма молча.
    if (!/^[0-9a-f]{64}$/.test(env.GF_MAIL_PROFILE_SHA256 ?? '') ||
        profileFingerprint(profiles) !== env.GF_MAIL_PROFILE_SHA256) throw new Error();
    const serviceSecret = secretFile(env.GF_MAIL_SERVICE_SECRET_FILE);
    const apiKey = secretFile(env.GF_RESEND_API_KEY_FILE);
    if (!validSecret(serviceSecret) || !/^re_[A-Za-z0-9_-]{16,256}$/.test(apiKey)) throw new Error();
    const config = Object.freeze({ profiles, profilePin: env.GF_MAIL_PROFILE_SHA256!, hubOrigin, serviceSecret, apiKey });
    assertRelayConfig(config);
    return config;
  } catch {
    throw new Error('почтовый шлюз: отсутствует или неверна обязательная конфигурация');
  }
}
export function assertRelayConfig(config: RelayConfig): void {
  try {
    canonicalOrigin(config.hubOrigin);
    if (!validSecret(config.serviceSecret) || !/^re_[A-Za-z0-9_-]{16,256}$/.test(config.apiKey) ||
        !/^[0-9a-f]{64}$/.test(config.profilePin) || profileFingerprint(config.profiles) !== config.profilePin) throw new Error();
    const from = config.profiles['verify-email.v1'].from;
    const match = /^Game Factory <([^<>]+)>$/.exec(from);
    if (!match || JSON.stringify(createProfiles(config.hubOrigin, match[1]!)) !== JSON.stringify(config.profiles)) throw new Error();
  } catch { throw new Error('неверная конфигурация почтового шлюза'); }
}
export function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function renderMail(profile: Profile, request: { kind: MailKind; to: string; url: string }) {
  if (!profile || profile.kind !== request.kind) throw new Error('почтовый профиль недоступен');
  return Object.freeze({
    from: profile.from, to: [request.to], subject: profile.subject,
    text: profile.textBefore + request.url + profile.textAfter,
    html: profile.htmlBefore + htmlEscape(request.url) + profile.htmlAfter,
  });
}
