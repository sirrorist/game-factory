<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Всплывающие поверхности хаба

Настоящие модальные окна и выдвижные панели используют `src/components/ui/popup.tsx`
(`Popup`), уведомления — `PopupNotice`. Основа задаёт анимации входа **и выхода**,
reduced motion и завершение закрытия; модальные варианты — также фокус, Escape,
backdrop и блокировку прокрутки. Не создавать собственные `<dialog>`, не вызывать
`close()` и не размонтировать открытый Popup в потребителе: передавать `open={false}`.
Статические образцы `/kit` не объявлять открытыми диалогами.
