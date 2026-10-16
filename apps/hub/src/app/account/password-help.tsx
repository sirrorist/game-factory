'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';

export function PasswordHelp({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="gf-account-help" data-open={open}>
      <button type="button" className="gf-account-help-toggle" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(!open)}>Смена пароля</button>
      <div id={id} className="gf-account-help-content" aria-hidden={!open} inert={!open}>
        <div className="gf-account-help-inner"><div className="gf-account-help-body">{children}</div></div>
      </div>
    </div>
  );
}
