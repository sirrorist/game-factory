import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineIntoHtml } from '../src/index.ts';

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="./assets/index-abc.js"></script>
<link rel="modulepreload" href="./assets/dep.js">
<link rel="stylesheet" crossorigin href="./assets/index-abc.css">
<link rel="icon" href="./favicon.svg">
</head><body><div id="app"></div></body></html>`;

test('скрипт становится классическим и переезжает в конец body, стиль — встроенным', () => {
  const { html, used } = inlineIntoHtml(
    HTML,
    [{ fileName: 'assets/index-abc.js', code: 'window.x = 1;' }],
    [{ fileName: 'assets/index-abc.css', code: 'body{margin:0}' }],
  );
  assert.deepEqual(used.sort(), ['assets/index-abc.css', 'assets/index-abc.js']);
  assert.doesNotMatch(html, /type="module"/);
  assert.doesNotMatch(html, /modulepreload/);
  assert.match(html, /<style>body\{margin:0\}<\/style>/);
  assert.match(html, /<div id="app"><\/div><script>window\.x = 1;<\/script>\n<\/body>/);
  // Посторонние ссылки не трогаем.
  assert.match(html, /<link rel="icon" href="\.\/favicon\.svg">/);
});

test('</script> внутри кода не закрывает тег раньше времени', () => {
  const { html } = inlineIntoHtml(
    '<body><script type="module" src="/a.js"></script></body>',
    [{ fileName: 'a.js', code: 'const s = "</script><img src=x onerror=alert(1)>";' }],
    [],
  );
  assert.equal(html.match(/<\/script>/g)?.length, 1);
  assert.match(html, /<\\\/script><img/);
});

test('чужой скрипт, которого нет в бандле, остаётся как был', () => {
  const src = '<body><script src="https://example.com/x.js"></script></body>';
  const { html, used } = inlineIntoHtml(src, [{ fileName: 'a.js', code: '1' }], []);
  assert.equal(html, src);
  assert.deepEqual(used, []);
});
