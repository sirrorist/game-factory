import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo.tsx';
import { SiteNav } from '@/components/site-nav.tsx';
import { UserMenu } from '@/components/user-menu.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Game Factory', template: '%s · Game Factory' },
  description: 'Браузерные игры: играть в хабе или скачать и играть без интернета.',
};

// viewport-fit=cover - чтобы браузер отдал env(safe-area-inset-*): по ним полный экран игры
// опускает кнопку выхода ниже выреза камеры (.gf-exit-pill), а страница в ландшафте - "чёлку" по бокам.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh">
        {/* Фон шапки - во всю ширину, содержимое - в той же колонке, что и страница. */}
        <header className="gf-header" style={{ padding: 0 }}>
          <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 sm:gap-6">
            <Link href="/" className="gf-logo">
              <Logo />
              <span className="gf-logo__word">
                Game <b>Factory</b>
              </span>
            </Link>
            <SiteNav />
            <div className="gf-header__end">
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
