'use client';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { CSRF_COOKIE, CSRF_HEADER } from '@/lib/csrf-names.ts';

export function AuthActionForm({ purpose, token, initialIntent }: { purpose: 'verify' | 'reset'; token?: string; initialIntent?: string }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(false);
  const intent = useRef(initialIntent);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    if (token === undefined && !intent.current) { setMessage('Обновите страницу и повторите запрос.'); return; }
    const form = new FormData(e.currentTarget), consume = token !== undefined;
    const body = consume ? { token, ...(purpose === 'reset' ? { password: String(form.get('password')) } : {}) }
      : { email: String(form.get('email')), intent: intent.current };
    const csrf = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(CSRF_COOKIE + '='))?.slice(CSRF_COOKIE.length + 1) ?? '';
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/account/${purpose === 'verify' ? 'email-confirmation' : 'password-reset'}/${consume ? 'consume' : 'request'}`, {
        method: 'POST', headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrf }, body: JSON.stringify(body), cache: 'no-store',
      });
      const result = await response.json() as { code: string };
      if (response.ok) { setReceived(!consume); setMessage(consume ? 'Готово. Теперь можно войти.' : 'Если действие доступно, письмо будет отправлено.'); }
      else setMessage(result.code === 'conflict' ? 'Выйдите из другой учётной записи или откройте ссылку в приватном окне.'
        : response.status === 429 ? 'Слишком много запросов. Повторите позже.' : 'Действие недоступно. Запросите новую ссылку.');
    } catch { setMessage('Ответ не получен. Можно повторить запрос.'); }
    finally { setBusy(false); }
  }
  return <form className="gf-form" onSubmit={submit}>
    {token === undefined ? <label className="gf-field"><span>Почта</span><input className="gf-input" name="email" type="email" required autoComplete="email"
 /></label> : null}
    {token !== undefined && purpose === 'reset' ? <label className="gf-field"><span>Новый пароль</span>
      <input className="gf-input" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label> : null}
    <Button type="submit" disabled={busy}>{token === undefined ? 'Запросить письмо' : purpose === 'verify' ? 'Подтвердить почту' : 'Сохранить пароль'}</Button>
    {received ? <Button type="button" variant="ghost" disabled={busy} onClick={() => window.location.assign(window.location.pathname)}>Запросить новую ссылку</Button> : null}
    {message ? <p role="status">{message}</p> : null}
    <a href="/login">Перейти ко входу</a>
  </form>;
}
