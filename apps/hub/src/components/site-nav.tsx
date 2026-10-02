'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Игры', match: (p: string) => p === '/' || p.startsWith('/games/'), owner: false },
  { href: '/kit', label: 'Web kit', match: (p: string) => p.startsWith('/kit'), owner: true },
];

/** Навигация шапки: текущий раздел - полоска brand под пунктом (aria-current). Web kit - только владельцу. */
export function SiteNav({ owner }: { owner: boolean }) {
  const path = usePathname() ?? '/';
  return (
    <nav className="gf-nav" aria-label="Разделы">
      {LINKS.filter((l) => owner || !l.owner).map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(path) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
