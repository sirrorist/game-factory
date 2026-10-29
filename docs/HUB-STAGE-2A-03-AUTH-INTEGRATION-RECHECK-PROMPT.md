# Перепроверка двух P2 standalone/browser-стенда

Ревьюера запускает владелец. Передать текст:

```text
Проведи read-only перепроверку двух P2 ревью standalone/browser-стенда A 2А-03.
Владелец разрешил исправления; Git, запуск Next/Chromium/CI и production не разрешены.

Исправления: test-results/auth-a-integration/recheck/gf-auth-a-integration-fixes.patch
Manifest: test-results/auth-a-integration/recheck/review-manifest.json
Копия: /tmp/gf-auth-a-integration-fixes.patch
Обновлённый полный пакет: test-results/auth-a-integration/gf-auth-a-integration-review.patch
Manifest полного пакета: test-results/auth-a-integration/review-manifest.json
Прежний пакет и свидетельства: test-results/auth-a-integration/recheck/previous/
Если путь недоступен, запроси путь. Не получай патч через Git.

Прочитай AGENTS.md, CLAUDE.md, apps/hub/AGENTS.md, .claude/agents/security.md
и всю указанную там инструкцию global-agent-kit/roles/SECURITY.md. Модель
фронтматтера себе не приписывай. Затем fixes/manifest, текущие файлы исправлений,
INTEGRATION-PLAN.md, INTEGRATION-REPORT.md, SECURITY/TESTING и П-069/П-070.

1. tests/auth-a/browser.ts: у документа/CSS/JS/probe отсутствие Referer сохранено.
   Для шрифта допускается только точный реально загруженный stylesheet,
   объявляющий этот шрифт в CSSOM. Bearer и URL token-страниц запрещены во всех
   наблюдениях, а не только в auto-ресурсах. Обязательное получение CSS/JS/fonts,
   успешные статусы, fresh context/наблюдение до navigation и положительный
   Referer-контроль сохранены. Production headers не менялись.
2. process.ts: PGID продолжает учитываться после exit лидера, ограниченные
   TERM/KILL и проверка исполняющихся участников Linux /proc. Переиспользование
   номера после наблюдённого исчезновения группы предотвращается retirement.
   Смена PGID между наблюдениями не исключена: абсолютная стабильная
   принадлежность группы этим кодом не доказывается. Зомби не исполняются
   и не держат порт; их собирает init, не Node harness. Ошибки signal/cleanup
   не должны теряться. standalone.ts/auth.integration.ts учитывают сбой abort
   в финальном cleanup и всё равно закрывают остальные ресурсы.
3. harness.test.ts: безопасный stylesheet Referer проходит, token URL/чужой CSS
   и неверный инициатор отвергаются. Настоящий потомок в группе игнорирует TERM;
   проверены вышедший лидер, лидер, выходящий по TERM, и общий abortResources.
   Проверяется прекращение исполнения и освобождение заранее занятого порта.
   Независимая страховка теста убирает группу и на старом коде/мутации.
   Ошибка одной задачи cleanup не отменяет остальные и не даёт успех.

Свидетельства исполнителя: recheck/harness.tap — 18/18, typecheck.txt пустой,
mutations.py/json и mutant-*.tap — 6 новых целевых testCodeFailure.
previous-process.tap/previous-code-check.json: реальный прежний ManagedProcess
воспроизводит ошибку с текущими тестами; новые cleanup exports добавлены только
как контекст теста, старый класс не исправлялся. Прежнее строгое CSS-условие
воспроизведено семантически; не выдавать это за запуск старого Chromium.
Девять прежних мутаций не повторялись; они исторические, отдельно сохранены.

Это только локальные процессы/loopback и типы. Next build/SSR, CSSOM Chromium,
настоящий standalone с permissions, PG/CI и lifecycle A ещё не запускались.
Не объявляй их проверенными. Прежние jobs и 30 исходников A сохранены; не открывай
повторный полный разбор auth/relay/B/C/D, если исправление их не затрагивает.

Только чтение. Не менять файлы, не запускать Git, тесты, мутации, сборки,
приложение, Chromium, PG, CI, Docker/Compose, отправку, подагентов и мониторинг.
Не читать настоящие env/secrets/ключи, рабочую БД/root-копии и личные данные.
Дай короткий вердикт по двум P2, новые адресные находки при наличии, непроверенное
и решения владельца в обязательном формате security-роли. Ничего не исправляй.
```
