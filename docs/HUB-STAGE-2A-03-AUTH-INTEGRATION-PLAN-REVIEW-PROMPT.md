# Промпт ревью плана собранного A

Ревьюера запускает владелец. Передать текст:

```text
Проведи read-only security/design-ревью docs/HUB-STAGE-2A-03-AUTH-INTEGRATION-PLAN.md.
Разрешено только подготовить план следующей проверки A; реализация/запуск CI,
Git, рабочая инфраструктура и переход к B этим разрешением не утверждены.

Документальный патч: test-results/auth-a-integration-plan/documents.patch
Manifest: test-results/auth-a-integration-plan/manifest.json
Копия: /tmp/gf-auth-a-integration-plan.patch
Если файл недоступен, запроси путь, не используй Git.

Прочитай AGENTS.md, CLAUDE.md, apps/hub/AGENTS.md, .claude/agents/security.md
и всю указанную там инструкцию global-agent-kit/roles/SECURITY.md. Не приписывай
себе модель фронтматтера. Затем весь план, его patch/manifest, SECURITY, TESTING,
релевантные ARCHITECTURE/PITFALLS, D-049/D-064 и отчёт реализации A.
Контекст исходников:
- .github/workflows/ci.yml, package.json, Dockerfile;
- tests/e2e/helpers.ts, auth.test.ts;
- apps/hub/src/instrumentation.ts, lib/auth-actions-runtime.ts;
- lib/mail-client.ts, auth-mail-dispatcher.ts, proxy.ts, config.ts;
- обе account token-страницы и auth-action-form.tsx;
- packages/db/src/auth-mail.ts, auth-crypto.ts, index.ts, roles.ts;
- apps/mail-relay/src/protocol.ts;
- документация instrumentation установленного Next при необходимости.

Проверь соразмерность и реализуемость стенда: отдельный CI job/PG вместо
изменения существующих tests, настоящий standalone layout вне checkout,
включённые build-флаги без runtime secrets и последующие runtime-переключения,
реальный запуск instrumentation без ручного вызова, HTTPS/Secure cookies,
фиксированный mail-relay:4102 без ослабления production URL/CSP/CSRF,
тестовый collector без настоящего Resend/ключей и без новых web debug API.

Отдельно оцени доказательство GET vs POST, browser Referer ранних ресурсов,
запрет утечек в CI artifacts, границы Origin/CORS, pending/started/unknown
и restart/crash/stop. Нужны управляемые барьеры, ограниченные сроки и cleanup;
ошибка setup не должна выглядеть как успешный негативный тест. Отметь недостающие
существенные зависимости или противоречия до реализации, не требуя готового кода.

Последние 110/110, три tsc/семь мутаций и чистое повторное ревью A — предыдущие
результаты/сообщённый владельцем отчёт. Интеграционные проверки ещё не реализованы
и не запускались. Не оценивай их как уже работающую защиту. Параметры D-064,
принятые сети/транспорт и B/C/D заново не открывай.

Только чтение. Не менять файлы, не запускать приложение/тесты/сборки/миграции,
Git, Docker/Compose, Actions, отправку, подагентов или мониторинг. Не читать
настоящие .env, deploy/secrets, ключи, рабочую БД, root-копии и персональные данные.
Дай короткий вердикт, адресные замечания к плану, непроверенное и решения владельца
по обязательному формату security-роли. Ничего не исправляй.
```
