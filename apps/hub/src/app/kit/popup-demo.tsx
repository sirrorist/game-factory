'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Popup, PopupNotice } from '@/components/ui/popup.tsx';

/** Живые примеры той же основы, которую используют меню, теги и сообщения аккаунта. */
export function PopupDemo() {
  const [variant, setVariant] = useState<'dialog' | 'drawer'>('dialog');
  const [open, setOpen] = useState(false), [notice, setNotice] = useState(false);
  const id = useId();
  return <div className="gf-row">
    <Button variant="outline" onClick={() => { setVariant('dialog'); setOpen(true); }}>Открыть диалог</Button>
    <Button variant="outline" onClick={() => { setVariant('drawer'); setOpen(true); }}>Открыть панель</Button>
    <Button variant="outline" onClick={() => setNotice(true)}>Показать уведомление</Button>
    <Popup open={open} variant={variant} titleId={id} onClose={() => setOpen(false)}>
      <div className="gf-popup-heading"><h2 id={id}>Общий попап</h2>
        <button type="button" className="gf-popup-close" aria-label="Закрыть попап" autoFocus onClick={() => setOpen(false)}>×</button></div>
      <p>Одинаковые анимации появления и исчезновения, закрытие через Escape и возврат фокуса.</p>
      <Button onClick={() => setOpen(false)}>Готово</Button>
    </Popup>
    <PopupNotice open={notice} onClose={() => setNotice(false)}>Уведомление с рамкой и анимацией.</PopupNotice>
  </div>;
}
