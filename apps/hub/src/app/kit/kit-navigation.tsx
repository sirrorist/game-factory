'use client';

import { useEffect, useId, useState } from 'react';

export function KitNavigation({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const id = useId();

  useEffect(() => {
    function sync() {
      const hash = window.location.hash.slice(1);
      setActive(sections.find(section => section.id === hash)?.id ?? sections[0]?.id ?? '');
    }
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [sections]);

  return (
    <div className="gf-kit-navigation" id="kit-navigation">
      <label htmlFor={id} className="gf-kit-select">
        <span>Раздел</span>
        <span className="gf-kit-select-field">
          <select id={id} className="gf-input" value={active} onChange={event => {
            setActive(event.target.value);
            window.location.hash = event.target.value;
          }}>
            {sections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
          </select>
        </span>
      </label>
      <nav className="gf-kit-links" aria-label="Разделы дизайн-системы">
        {sections.map(section => (
          <a key={section.id} href={`#${section.id}`} aria-current={active === section.id ? 'location' : undefined}>
            {section.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
