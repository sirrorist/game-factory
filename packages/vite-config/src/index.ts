// Общий Vite-конфиг игр Game Factory (toolchain vite-ts).
//
// Офлайн-режим собирает игру в один index.html с классическим скриптом внутри:
// архив открывают двойным кликом, то есть через file://, а там не грузятся
// <script type="module" src>, fetch и динамический import (П-001, П-002).
// Поэтому: формат IIFE, без разбиения на чанки, ассеты — data:-URL.
//
// Вне офлайна игра собирается обычным образом, но тоже классическим скриптом:
// один и тот же бандл одинаково ведёт себя в хабе и в архиве.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, UserConfig } from 'vite';

export interface GameConfigOptions {
  /** Папка игры (где game.json). Обычно import.meta.dirname из vite.config.ts. */
  root: string;
  /** Переопределить поле offline из game.json. */
  offline?: boolean;
}

interface Asset {
  fileName: string;
  code: string;
}

/** `</script` внутри кода закрыл бы тег раньше времени. */
function escapeScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

function escapeStyle(code: string): string {
  return code.replace(/<\/(style)/gi, '<\\/$1');
}

function refersTo(tag: string, fileName: string): boolean {
  const m = tag.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i);
  if (!m) return false;
  const ref = m[1]!.replace(/^\.?\//, '');
  return ref === fileName;
}

/**
 * Встроить собранные скрипты и стили в HTML. Скрипт становится классическим и
 * переезжает в конец <body>: встроенному скрипту `defer` не помогает, а код игры
 * ждёт готовый DOM.
 */
export function inlineIntoHtml(html: string, scripts: Asset[], styles: Asset[]): { html: string; used: string[] } {
  const used: string[] = [];
  let out = html;

  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) {
      // modulepreload и прочее без скриптов-модулей не нужны.
      return /\brel\s*=\s*["']?modulepreload/i.test(tag) ? '' : tag;
    }
    const css = styles.find((s) => refersTo(tag, s.fileName));
    if (!css) return tag;
    used.push(css.fileName);
    return `<style>${escapeStyle(css.code)}</style>`;
  });

  const bodyScripts: string[] = [];
  out = out.replace(/<script\b[^>]*>\s*<\/script>/gi, (tag) => {
    const js = scripts.find((s) => refersTo(tag, s.fileName));
    if (!js) return tag;
    used.push(js.fileName);
    bodyScripts.push(`<script>${escapeScript(js.code)}</script>`);
    return '';
  });

  if (bodyScripts.length > 0) {
    const tail = bodyScripts.join('\n');
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, () => `${tail}\n</body>`) : `${out}\n${tail}\n`;
  }
  return { html: out, used };
}

/** Плагин: всё в один HTML. Работает после сборки, на готовом бандле. */
export function gfSingleFile(): Plugin {
  return {
    name: 'gf-single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const scripts: Asset[] = [];
      const styles: Asset[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') scripts.push({ fileName: item.fileName, code: item.code });
        else if (item.fileName.endsWith('.css')) styles.push({ fileName: item.fileName, code: String(item.source) });
      }
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || !item.fileName.endsWith('.html')) continue;
        const { html, used } = inlineIntoHtml(String(item.source), scripts, styles);
        item.source = html;
        for (const name of used) delete bundle[name];
      }
      const left = Object.values(bundle).filter((i) => i.type === 'chunk');
      if (left.length > 0) {
        this.error(`gf: офлайн-сборка — скрипты не встроились в HTML: ${left.map((c) => c.fileName).join(', ')}`);
      }
    },
  };
}

function readManifest(root: string): { id: string; offline: boolean } {
  const m = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')) as { id?: unknown; offline?: unknown };
  // Полная проверка манифеста — в gf validate; здесь только то, без чего сборка бессмысленна.
  if (typeof m.id !== 'string') throw new Error(`${join(root, 'game.json')}: нет строкового "id"`);
  return { id: m.id, offline: m.offline === true };
}

/** Конфиг Vite для игры. Входной файл — index.html в корне папки игры, результат — dist/. */
export function gameConfig(options: GameConfigOptions): UserConfig {
  const manifest = readManifest(options.root);
  const offline = options.offline ?? manifest.offline;
  return {
    root: options.root,
    // Относительные пути: игра живёт в корне своего поддомена, а архив — где угодно на диске.
    base: './',
    publicDir: 'public',
    plugins: offline ? [gfSingleFile()] : [],
    define: { __GF_GAME_ID__: JSON.stringify(manifest.id) },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      // Детерминированные имена: одинаковый исходник — одинаковый хеш версии (D-015).
      assetsDir: 'assets',
      modulePreload: false,
      cssCodeSplit: false,
      // В офлайне любой файл, кроме HTML, должен оказаться внутри HTML.
      assetsInlineLimit: offline ? Number.MAX_SAFE_INTEGER : 4096,
      reportCompressedSize: false,
      rolldownOptions: {
        output: {
          format: 'iife',
          codeSplitting: false,
        },
      },
    },
  };
}
