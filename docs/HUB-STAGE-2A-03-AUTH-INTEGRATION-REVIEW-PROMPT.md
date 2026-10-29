# Промпт ревью standalone/browser-стенда A

Ревьюера запускает владелец. Передать текст:

```text
Проведи read-only security/design-ревью реализации тестового стенда A 2А-03.
Владелец утвердил реализацию плана с двумя уточнениями доказательности.
Разрешения на Git, CI-запуск/публикацию и production нет.

Патч: test-results/auth-a-integration/gf-auth-a-integration-review.patch
Копия: /tmp/gf-auth-a-integration-review.patch
Manifest: test-results/auth-a-integration/review-manifest.json
Это точный срез только текущего подшага, не общий diff рабочей копии.
Если файл недоступен, запроси путь; не получай его через Git.

Прочитай AGENTS.md, CLAUDE.md, apps/hub/AGENTS.md, .claude/agents/security.md
и указанную там полную инструкцию global-agent-kit/roles/SECURITY.md.
Модель фронтматтера себе не приписывай. Затем весь patch/manifest/candidate,
HUB-STAGE-2A-03-AUTH-INTEGRATION-PLAN.md, INTEGRATION-REPORT.md, SECURITY,
TESTING, D-049/D-064/D-065 и относящиеся ARCHITECTURE/PITFALLS.

Все файлы стенда:
- tests/auth-a/guards.ts, process.ts, network.ts, standalone.ts, browser.ts;
- tests/auth-a/auth.integration.ts, harness.test.ts;
- packages/db/test/auth-integration-fixtures.ts;
- .github/workflows/ci.yml и package.json.
Непосредственный неизменённый контекст:
- Dockerfile, tests/e2e/helpers.ts;
- apps/hub/src/instrumentation.ts, lib/auth-actions-runtime.ts,
  auth-mail-dispatcher.ts, auth-actions-http.ts, auth-core.ts, mail-client.ts,
  proxy.ts и config.ts; обе token-страницы, auth-action-form.tsx, next.config.ts;
- packages/db/src/auth-mail.ts, auth-crypto.ts, roles.ts и миграции 0000–0003;
- apps/mail-relay/src/protocol.ts;
- локальная документация Next instrumentation/output при необходимости.

Проверь реальную связь заявленных мер с исполняемыми границами:
1. Отдельные job/PG, gf_hub, отсутствие реальных ключей/БД/отправки и публикации;
   прежние jobs сохранены. Env allowlist, запрет env-файлов во время build.
2. Один настоящий standalone build с build-флагами без runtime credentials;
   static/public и внешние ссылки; ограничение чтения Node в самом spawn/start.
   Отрицательная абсолютная зависимость должна идти тем же путём, что server.js;
   cwd/NODE_PATH сами по себе доказательством не считать. Node permission model
   не объявляется sandbox недоверенного кода. Совместимость с Next ещё неизвестна.
3. HTTPS/Secure cookies/Origin/CSRF без ослабления защиты. Collector только
   loopback и фиксированный mail-relay:4102; TLS-заголовки и лимиты входа.
4. Свежий browser context, наблюдение до navigation; обязательное поступление
   CSS/JS/fonts и cross-origin probe плюс положительный Referer-контроль.
   Пустое наблюдение/HTTP-ошибка не должны давать зелёный результат. Реальные
   response headers важнее meta. Отказы auth должны проверять guard, а не
   неполный payload/случайную ошибку setup.
5. Autoload без ручного register; committed-снимок на HTTP-границе; управляемые
   ответы/конкурентность, restart/SIGKILL/SIGTERM, отсутствие resend. Таймауты,
   процессные группы и cleanup, отсутствие утечки bearer в ошибки/артефакты.

Артефакты harness.tap, typecheck.txt, mutations.py/json и mutant-*.tap —
результаты исполнителя, не твои запуски. После исправлений ревью локально 18/18, root tsc и шесть новых
целевых провалов мутаций; девять прежних не повторялись. Мутации исполнялись в временных копиях; не путай их
с браузерными/Next/PG испытаниями. Прежние 110/110 A не повторялись.
Новый standalone build/Chromium/CI/service PG не запускались и не утверждаются
работающими. Правку runtime при выявленной несовместимости оформлять отдельно.

Границы: повторный разбор неизменённых 2А-02/A/relay не требуется; конкретную
несовместимость непосредственного потребителя указать. B/C/D, Q3/CSP/регистрация,
рабочая ротация/миграция, D-047 и инфраструктура не стали готовыми от этого стенда.

Только чтение. Не менять файлы, не запускать тесты/сборки/приложение/миграции,
Chromium, Git, Docker/Compose, Actions, отправку, подагентов или мониторинг.
Не читать настоящие env/secrets/ключи, рабочую БД, root-копии и личные данные.
Дай короткий вердикт, адресные находки с минимальным исправлением, непроверенное
и решения владельца в обязательном формате security-роли. Ничего не исправляй.
```
