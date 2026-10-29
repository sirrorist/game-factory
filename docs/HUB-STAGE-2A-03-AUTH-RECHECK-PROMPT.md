# Промпт повторного ревью A

Ревьюера запускает владелец. Передать текст:

```text
Проведи read-only перепроверку трёх medium-замечаний первого ревью A.
Владелец разрешил исправления и соответствующие тесты/мутации; Git/прод не разрешены.

Изолированный патч исправлений: test-results/auth-a/recheck/gf-auth-a-fixes.patch
Manifest исправлений: test-results/auth-a/recheck/review-manifest.json
Полный обновлённый A: test-results/auth-a/gf-auth-a-review.patch
Manifest полного A: test-results/auth-a/review-manifest.json
Копия полного патча: /tmp/gf-auth-a-review.patch
Прежний проверенный пакет/логи: test-results/auth-a/recheck/previous/;
полные прежние версии — recheck/before.json, прежний пакет имел 39 файлов.
Всё подготовлено без Git. Если файла нет — запроси путь, не получай через Git.

Прочитай AGENTS.md, CLAUDE.md, apps/hub/AGENTS.md, .claude/agents/security.md
и полную указанную там инструкцию SECURITY.md global-agent-kit. Модель из
фронтматтера себе не приписывай. Затем patch/manifest и текущие версии файлов:
- apps/hub/next.config.ts, test/auth-headers.test.ts;
- apps/hub/src/lib/auth-actions-http.ts, test/auth-action-http.test.ts;
- packages/db/test/access-concurrency.pgtest.ts — новые committed PreparedMail;
- packages/db/src/auth-mail.ts и hub auth-mail-dispatcher.ts как неизменённый контекст;
- apps/hub/tsconfig.auth-tests.json и корневой tsconfig.json;
- docs/HUB-STAGE-2A-03-AUTH-REPORT.md, SECURITY.md, TESTING.md;
- recheck/mutations.py, mutations.json, mutant-*.tap, previous-tests.tap;
- regression.tap, native.tap, typecheck-*.txt и checks.json полного пакета.

Перепроверь:
1. Итоговый Referrer-Policy обеих token-страниц через matcher установленного Next,
   общее правило не перезаписывает no-referrer. Тест использует реальный helper
   unstable_getResponseFromNextConfig; обратный порядок должен давать красный тест.
   Это проверка конфигурации Next, не настоящий браузер/сетевой capture Referer.
2. Незавершённые потоки: >4096 фактических байт без EOF завершаются до deadline;
   без EOF на 5000 мс — отмена, освобождение reader и отсутствие store/session/consume.
   Проверяются все четыре действия и частичный/полный JSON. Таймаут с полным JSON
   на прежнем коде мог перейти к обработке: теперь cancel не считается успешным EOF.
   Размер, таймер и отказ разбора после таймаута имеют отдельные красные мутации.
3. В начале send другое настоящее PG-соединение видит committed started-запись,
   расшифровывает prepared с правильным AAD и сравнивает весь body/createdAt,
   operationId и kind. Проверены verify/reset. Ошибки assert внутри send должны
   быть вынесены из catch диспетчера и проваливать тест. Мутации: ciphertext отсутствует,
   сохранён другой body либо другой createdAt. Каждая обязана давать testCodeFailure.

Проверки 87/87 + 23/23, три tsc и семь новых мутаций — сведения исполнителя,
не твои запуски. Прежние 17 мутаций не повторялись; их логи сохранены отдельно.
Не расширяй ревью до неизменённых MFA/Q3/транспорта/сетей/инфраструктуры;
укажи конкретную новую регрессию при её наличии. B/C/D по-прежнему не реализованы.

Только чтение. Не менять файлы, не запускать Git, приложение, тесты/мутации,
миграции, сборки, Docker/Compose, Actions, подагентов, отправку и мониторинг.
Не читать настоящие .env, deploy/secrets, ключи, рабочую БД, root-копии
или персональные данные. Разрешены локальные исходники Next и синтетические артефакты.
Дай короткий вердикт, статусы трёх пунктов/новые находки, непроверенное и решения
владельца по обязательному формату security-роли. Ничего не исправляй.
```
