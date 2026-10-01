'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Игры', match: (p: string) => p === '/' || p.startsWith('/games/') },
  { href: '/kit', label: 'Web kit', match: (p: string) => p.startsWith('/kit') },
];

/** Навигация шапки: текущий раздел - полоска brand под пунктом (aria-current). */
export function SiteNav() {
  const path = usePathname() ?? '/';
  return (
    <nav className="gf-nav" aria-label="Разделы">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(path) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
