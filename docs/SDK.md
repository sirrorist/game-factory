# Game Factory SDK и протокол хаб ↔ игра

## Подключение

**Статическая игра** (без сборщика) — классический скрипт. `gf build` сам подложит
`gf-sdk.js`, если HTML на него ссылается:

```html
<script src="gf-sdk.js"></script>
<script src="game.js"></script>
```

**Игра на Vite** (toolchain `vite-ts`, шаблон — `pnpm gf new <id>`):

```ts
import { GameFactory } from '@gf/game-sdk';

// Без top-level await: офлайн-сборка — классический скрипт (IIFE), П-018.
async function main() {
  const gf = await GameFactory.init({ gameId: __GF_GAME_ID__ }); // id из game.json, подставит сборка
  // …
  gf.ready();
}
void main();
```

Сборка — общий конфиг `@gf/vite-config`: при `offline: true` всё собирается в один
`index.html` с классическим скриптом внутри, и архив работает через `file://`.

Не подключай SDK как `<script type="module" src=…>`: через `file://` такой скрипт не
загрузится (PITFALLS.md, П-001).

## API

```js
const gf = await GameFactory.init({ gameId: 'snake' }); // id из game.json

gf.mode        // 'hub' — игра в хабе; 'standalone' — сама по себе (архив, прямой заход)
gf.player      // { id, name } или null
gf.persistent  // false — сохранения живут только до закрытия вкладки

await gf.save('progress', { level: 3 });    // JSON до 64 КБ
await gf.load('progress');                   // значение или null
await gf.submitScore(120);                   // { best, isBest }
await gf.bestScore();                        // число или null
gf.ready();                                  // игра готова к вводу
```

- Ключ: 1–64 символа `a-z A-Z 0-9 _ . -`.
- `ready()` ставит на `<html>` атрибут `data-gf-ready="hub|standalone"` и шлёт событие
  `gf:ready` — на это опираются e2e и превью ИИ-студии. Вызывай, когда игра реально
  готова, а не сразу после `init`.
- Одинаковый код игры работает в обоих режимах: режим выбирает SDK.

## Режимы

| | `hub` | `standalone` |
|---|---|---|
| Когда | игра в iframe и хаб ответил на `hello` за 1,5 с | нет родительского окна или хаб промолчал |
| Сохранения | у хаба (этап 0 — `localStorage` хаба, этап 1 — сервер) | `localStorage` игры, ключи `gf:<id>:…` |
| Очки | у хаба | локальный рекорд |
| Игрок | из хаба | `null` |

Если `localStorage` недоступен (приватный режим, запрет браузера) — хранилище в памяти,
`persistent: false`.

## Протокол (версия 1)

Все сообщения — объекты с полем `gf: 1`.

```
игра → хаб   { gf:1, type:'hello',   gameId, sdk }                       targetOrigin "*"
хаб  → игра  { gf:1, type:'welcome', gameId, player }                    targetOrigin = origin игры
игра → хаб   { gf:1, type:'request', id, method, params }                targetOrigin = origin хаба
хаб  → игра  { gf:1, type:'response', id, ok, result | error }           targetOrigin = origin игры
игра → хаб   { gf:1, type:'ready' }                                      targetOrigin = origin хаба
```

| method | params | result |
|---|---|---|
| `save` | `{ key, value }` — `value` уже JSON-строка | `null` |
| `load` | `{ key }` | JSON-строка или `null` |
| `submitScore` | `{ score }` | `{ best, isBest }` |
| `bestScore` | — | число или `null` |

Ошибки хаба (`error`): `bad-key`, `bad-value`, `bad-json`, `value-too-large`, `bad-score`,
`unknown-method`, `rate-limited`.

## Правила безопасности протокола

1. **`hello` — единственное сообщение с `"*"`**, в нём нет ничего секретного. Origin хаба
   игра берёт из `welcome`; встроить игру куда попало не даёт CSP `frame-ancestors`.
2. **Игра** принимает сообщения только от `window.parent` **и** только с origin хаба.
3. **Хаб** (`packages/hub-bridge`) принимает сообщения, только если совпали **и**
   `event.source === iframe.contentWindow`, **и** `event.origin === origin игры`.
   Проверка одного из двух — дыра: окно подменяется навигацией, origin — чужим фреймом.
4. Хаб отвечает только на точный origin игры: если iframe увели на другой адрес,
   браузер не доставит ответ.
5. Всё из игры — недоверенный ввод: форма сообщения, ключи, размеры, конечность чисел,
   лимит запросов (по умолчанию 20/с).
6. Очки от статической игры — **заявка, а не факт**. С этапа 1 — проверка правдоподобия
   на сервере; у серверных игр очки считает сервер игры.

Всё это покрыто e2e: `tests/e2e/hub-embed.test.ts`.
