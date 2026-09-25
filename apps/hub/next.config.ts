import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Корень монорепо: отсюда Next берёт пакеты рабочей области (@gf/*) и lockfile.
const repoRoot = resolve(import.meta.dirname, '..', '..');

// Хаб не встраивается никуда: ни на чужие сайты, ни в игры (кликджекинг).
// Полная CSP для самого хаба — этап 1, вместе с авторизацией (нужны nonce для скриптов Next).
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  // standalone — только для Docker-образа: `next start` с ним не дружит, а e2e и
  // локальный запуск идут через `next start`.
  output: process.env.GF_HUB_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Пакеты рабочей области отдают исходники на TypeScript — Next собирает их сам.
  transpilePackages: ['@gf/hub-bridge', '@gf/manifest', '@gf/registry'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
