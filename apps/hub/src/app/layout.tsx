import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Game Factory', template: '%s · Game Factory' },
  description: 'Браузерные игры: играть в хабе или скачать и играть без интернета.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh">
        <header className="border-b">
          <div className="mx-auto flex h-14 max-w-5xl items-center px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Logo />
              Game Factory
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
