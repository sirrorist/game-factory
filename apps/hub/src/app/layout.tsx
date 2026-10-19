import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header.tsx';
import { UserMenu } from '@/components/user-menu.tsx';
import { currentOwner } from '@/lib/session.ts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Game Factory', template: '%s · Game Factory' },
  description: 'Браузерные игры: играть в хабе или скачать и играть без интернета.',
};

// viewport-fit=cover - чтобы браузер отдал env(safe-area-inset-*): по ним полный экран игры
// опускает кнопку выхода ниже выреза камеры (.gf-exit-pill), а страница в ландшафте - "чёлку" по бокам.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const owner = (await currentOwner()) !== null;
  return (
    <html lang="ru">
      <body className="min-h-dvh">
        {/* Фон шапки - во всю ширину, содержимое - в той же колонке, что и страница. */}
        <SiteHeader owner={owner}><UserMenu /></SiteHeader>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
