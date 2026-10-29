// Тот же минимальный Node baseline, который Next загружает до серверных модулей.
import 'next/dist/server/node-environment-baseline.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server.js';
import config from '../next.config.ts';

test('token-страницы: итоговый HTTP Referrer-Policy не перезаписан общим правилом Next', async () => {
  for (const path of ['/account/verify-email', '/account/reset-password']) {
    const response = await unstable_getResponseFromNextConfig({ url: `https://hub.example${path}?token=synthetic`, nextConfig: config });
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', path);
    assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  }
  const ordinary = await unstable_getResponseFromNextConfig({ url: 'https://hub.example/account', nextConfig: config });
  assert.equal(ordinary.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});
