# Промпт ревью образа mail-relay

Ревьюера запускает владелец. Скопировать текст ниже.

~~~text
Проведи повторное read-only security-ревью исправлений двух P2 и совместимости
GitHub API path в реализации образа mail-relay. Основной объём — последний CI
для обоих режимов, применение hardening в Docker create и точные формы path.
Владелец утвердил план и разрешил локальную подготовку, но не сборку, Git,
публикацию, изменение root-копий и реальную отправку.

Патч: test-results/mail-image/gf-mail-image-review.patch
Копия: /tmp/gf-mail-image-review.patch
Manifest: test-results/mail-image/review-manifest.json
Это точный локальный срез этого подшага, подготовленный без Git; не общий diff
всей рабочей копии. Не получай его через Git. Если файл недоступен — запроси путь.

Прочитай AGENTS.md, CLAUDE.md, .claude/agents/security.md и указанную там полную
инструкцию global-agent-kit/roles/SECURITY.md. Модель фронтматтера себе не приписывай.
Затем патч и текущие файлы:
- docs/HUB-MAIL-IMAGE-PLAN.md, HUB-MAIL-IMAGE-REPORT.md;
- apps/mail-relay/Dockerfile и Dockerfile.dockerignore;
- .github/workflows/ci.yml, .github/workflows/publish.yml;
- .github/scripts/mail-publish-gate.mjs;
- tools/mail-image-smoke.mjs, tests/ops/mail-image.test.mjs;
- корневые Dockerfile, .dockerignore, package.json и .nvmrc — контекст совместимости;
- apps/mail-relay/src/main.ts, config.ts, server.ts — только граница запуска/401;
- docs/HUB-MAIL-DEPLOYMENT.md, HUB-MAIL-OPERATIONS.md, SECURITY.md, TESTING.md;
- D-034/D-038/D-043 в docs/DECISIONS.md;
- test-results/mail-image/node-base.json, unit.tap, mutations.json, mutant-*.tap,
  mutations.py и yaml-check.json — прежние сведения исполнителя;
- test-results/mail-image/recheck/unit.tap, mutations.json, mutations.py,
  mutant-*.tap, previous-code-check.json, previous-auto.tap, previous-path.tap —
  результаты после исправлений, не твои запуски;
- test-results/mail-image/recheck/gf-mail-image-fixes.patch — только правки после
  предыдущего ревью. Полный патч выше обновлён; прежняя версия сохранена в recheck.

Проверь:
1. Закрепление официальной базы по digest и совместимость Node/.ts; отсутствие
   произвольного build-arg и расширения контекста. Не считай метаданные registry
   доказательством запуска образа. Не открывают ли ignore-исключения лишние каталоги.
2. CI job mail-image: без права публикации/настоящих ключей, собирается правильный
   Dockerfile/platform, есть положительный smoke и отрицательные проверки на том же
   образе. Прежний check и прежняя матрица images должны быть сохранены.
3. Допуск публикации: только main, CI от push в том же репозитории и того же SHA,
   правильный workflow ci.yml и успешный job mail-image; исключение PR/форков,
   API-ошибок, отсутствующего/пропущенного smoke и красного повторного CI.
   Для ручного запуска не должно быть обхода проверки успешного CI точного SHA.
   Оба пути должны запросить последний push-CI точного SHA без фильтра success;
   событие workflow_run должно соответствовать этому id. Новый красный,
   незавершённый или другой зелёный run исключает старое автоматическое событие.
   Ручной запуск может использовать новый зелёный run. Допустимы только точные
   .github/workflows/ci.yml и .github/workflows/ci.yml@main, с прежними ID/main/SHA.
4. Permissions и разделение jobs: у gate нет packages write, у издателя нет
   actions write; секреты не передаются через build. Checkout издателя, image tag
   и revision должны использовать единственный разрешённый SHA.
5. Smoke: настоящие команды Docker, network none, read-only/uid/caps/лимиты,
   отсутствие портов, искусственные файлы не в build, bounded start/wait,
   cleanup на ошибках и корректность проверяемого ответа/exit code/metadata/layout.
   Ошибка команды Docker не должна выглядеть как ожидаемый отказ конфигурации.
   После create до start сверяются фактические HostConfig/Config.User из inspect.
   Синтетический CLI исполняет smokeImage с подменённым исполнителем команд;
   HostConfig выводится из переданных argv. Удаление ...sandboxArgs() именно из
   вызова create и снятие проверки inspect должны делать целевые тесты красными.
6. Соразмерность проверок: теперь 55/55, 14 красных мутаций и два красных теста
   прежнего gate известны из отчёта; прежние 28/28 и 10 мутаций — история.
   Отдели реальные негативные проверки от одной лишь проверки текстового шаблона.
   Контейнерный smoke, builder, Actions/API/GHCR ещё не запускались; не объявляй
   это доказанной работой контейнера или уже готовой публикацией.

Границы: повторный разбор транспорта R2, auth/ролей, updater, почтовых токенов,
MFA и сетей VPS не требуется. Конкретную несовместимость непосредственного
потребителя укажи. Новый образ не подключён к прод-конфигу и не обновляется
автоматически gf-update: это согласованная граница, не пропущенная реализация.

Только чтение. Не менять файлы, не запускать Git, тесты, smoke/Docker/Compose,
сборки, Actions, публикацию, миграции, подагентов или мониторинг. Не читать
настоящие .env, deploy/secrets, ключи, рабочую БД, root-копии и персональные данные.
Разрешена публичная официальная документация и синтетические артефакты пакета.

Дай короткий вердикт, находки с приоритетом, адресом, сценарием и минимальным
исправлением, затем непроверенное и решения владельца. Соблюдай обязательный
формат security-роли. Ничего не исправляй и не выдавай чужие результаты за свои.
~~~
