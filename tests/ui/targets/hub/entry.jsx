// Только отдельный UI-предпросмотр: страницы и компоненты настоящие, данные — образцы.
import React, { cloneElement, isValidElement } from 'react';
import { createRoot } from 'react-dom/client';
import Layout from '@/app/layout.tsx';
import Catalog from '@/app/page.tsx';
import Game from '@/app/games/[id]/page.tsx';
import Login from '@/app/login/page.tsx';
import Account from '@/app/account/page.tsx';
import Kit from '@/app/kit/page.tsx';
import NotFound from '@/app/not-found.tsx';

const scene = new URLSearchParams(location.search).get('scene')
  ?? (location.pathname.startsWith('/games/') ? 'game'
    : location.pathname === '/login' ? 'login' : location.pathname === '/account' ? 'account'
      : location.pathname === '/kit' ? 'kit' : 'catalog');
globalThis.__HUB_UI_SCENE__ = scene;

// Серверные async-компоненты разрешаем до передачи дерева клиентскому React.
async function resolveServerTree(node) {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree));
  if (!isValidElement(node)) return node;
  if (typeof node.type === 'function' && node.type.constructor.name === 'AsyncFunction') {
    return resolveServerTree(await node.type(node.props));
  }
  return cloneElement(node, {}, await resolveServerTree(node.props.children));
}

async function main() {
  const page = scene.startsWith('catalog') ? await Catalog()
    : scene.startsWith('game') ? await Game({ params: Promise.resolve({ id: 'superwalk' }) })
      : scene.startsWith('login') ? await Login()
        : scene.startsWith('account') ? await Account()
          : scene === 'kit' ? await Kit() : NotFound();
  const html = await resolveServerTree(await Layout({ children: page }));
  const body = html.props.children;
  document.body.className = body.props.className;
  createRoot(document.getElementById('root')).render(body.props.children);
  await document.fonts.ready;
  document.documentElement.dataset.hubUiReady = scene;
}
main().catch(error => {
  document.getElementById('root').textContent = `Ошибка UI-предпросмотра: ${error.message}`;
  console.error(error);
});
