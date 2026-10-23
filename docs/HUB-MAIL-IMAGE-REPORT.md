# Образ почтового шлюза: локальная реализация

2026-10-22. Владелец утвердил [план](HUB-MAIL-IMAGE-PLAN.md) словом «да».
Подготовлены файлы сборки, CI/Publish, smoke и локальные проверки.
На этапе подготовки файлов образ не собирался, контейнеры не запускались.
2026-10-23 владелец прислал успешный результат локальной сборки и настоящего smoke:
[image ID, вывод и происхождение данных](HUB-MAIL-IMAGE-BUILD.md).
Публикация и работа GitHub Actions по-прежнему не подтверждены.

После независимого ревью владелец разрешил одним пакетом исправить два замечания
P2 и совместимость path. По присланному повторному ревью оба P2 и path закрыты,
новых находок в согласованной области нет. Прежний пакет — в test-results/mail-image/recheck.

## Что изменено

- [Dockerfile](../apps/mail-relay/Dockerfile) использует фиксированную официальную
  базу Node 22.23.4 bookworm-slim, без свободного build-arg.
  [Отдельный ignore](../apps/mail-relay/Dockerfile.dockerignore) допускает только
  package.json, Dockerfile/ignore и плоские .ts исходники шлюза; родительские
  каталоги широкими исключениями не открываются.
- В [CI](../.github/workflows/ci.yml) добавлен job mail-image с contents: read:
  локальные проверки, сборка linux/amd64 и smoke. Прежний job check сохранён.
- В [Publish](../.github/workflows/publish.yml) добавлены mail-gate и mail-image.
  Gate имеет только contents/actions read; издатель — contents read/packages write.
  Прежний job images сохранён, его ограничения и теги не менялись.
- [Допуск публикации](../.github/scripts/mail-publish-gate.mjs) сверяет событие,
  репозиторий, main, SHA, настоящий workflow ci.yml по ID/path, завершённый успешный
  run и успешный job mail-image того же SHA через GitHub API.
  Оба режима проверяют последний найденный CI от push в main для выбранного SHA,
  без фильтра success и поиска более старого зелёного результата. Новый красный
  или незавершённый run запрещает допуск. В автоматическом режиме id события
  должен совпадать с последним run, даже если новый тоже зелёный.
  Ответ отдельного run перечитывается и сверяется с выбранным id.
  Допустимы только path .github/workflows/ci.yml и .github/workflows/ci.yml@main;
  другой файл/ref отвергается при сохранении проверок workflow ID, main и SHA.
  API-ошибка/пустой ответ/пропущенный smoke закрывают допуск.
  Gate выполняется без права публикации; следующий job получает только проверенный SHA.
- Checkout издателя использует этот SHA, Dockerfile задан явно, тег только полный SHA.
  Итоговый digest, revision/SHA, linux/amd64 и база выводятся в summary.
  В build не передаются почтовые ключи, новый PAT не нужен.

## Проверка базы без сборки

Прочитаны публичный официальный список Node и Docker Hub Registry API.
Получен индекс для node:22.23.4-bookworm-slim; SHA-256 тела совпал с
Docker-Content-Digest, в индексе найден дескриптор linux/amd64.
Digest индекса в FROM:
`sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`.
Это проверка метаданных реестра, не слоёв или запущенного Node.
Запись — test-results/mail-image/node-base.json; слои не скачивались.

Основание выбора — [официальный список образов Node](https://raw.githubusercontent.com/docker-library/official-images/master/library/node).
Правила отдельного ignore — [Docker build context](https://docs.docker.com/build/concepts/context/#dockerignore-files).
Допуск использует [workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs)
и [workflow jobs API](https://docs.github.com/en/rest/actions/workflow-jobs).

## Проверено локально

| Проверка | Команда/способ | Результат |
|---|---|---|
| Допуск, wiring, база/ignore, валидаторы и синтетический CLI smoke | node --test --experimental-test-isolation=none tests/ops/mail-image.test.mjs | 55/55 |
| Мутации во временных копиях | test-results/mail-image/recheck/mutations.py | 14 красных целевых проверок |
| Новые регрессии на прежнем gate | previous-auto.tap и previous-path.tap в recheck | Два целевых красных теста |
| YAML и прежние задачи | PyYAML, сравнение разобранных check/images с исходным снимком | Пройдены |
| Синтаксис трёх .mjs | node --check | Пройден |
| Существующий TypeScript проекта | pnpm exec tsc -p tsconfig.json --pretty false | Пройден |

Мутации: снятие main, успешного CI, совпадения SHA, успешного smoke и ограничения
ручного запуска; замена Dockerfile, checkout проверенного SHA, снятие digest,
расширение ignore на .env и разрешение сети smoke; дополнительно потеря аргументов
в самом docker create, снятие проверки inspect, связи с последним run и откат
совместимости path. Каждая сделала целевой тест
красным; рабочие исходники не мутировались. Новые .mjs проверяются node --check
и тестами; root tsc не объявляется проверкой этих JavaScript-файлов.

Синтетический CLI-сценарий исполняет настоящую smokeImage с подменённым исполнителем
команд. Ответ HostConfig строится из фактически переданных argv, не sandboxArgs().
Проверены шесть полных create/inspect/start/remove, отказ до start при небезопасном
inspect и cleanup при исключениях, включая ошибку Docker wait. Это проверка
связывания команд и обработки ответов, не работа Docker Engine.
Новые результаты — recheck/unit.tap, mutations.json, mutant-*.tap и
previous-code-check.json. Прежние результаты сохранены с префиксом previous-.

## Что ещё должно пройти в CI

[Smoke](../tools/mail-image-smoke.mjs) подготовлен для настоящего образа:
metadata/User/Cmd/Node version/состав /app; четыре отказа конфигурации
(отсутствие, пустой служебный ключ, пустой API-ключ, неверный pin); успешный старт
с искусственными файлами и HTTP 401 без авторизации. Контейнеры без сети/портов,
read-only, uid 1000, без capabilities, с no-new-privileges и лимитами ресурсов.
После каждого create до start считывается настоящий container inspect:
проверяются User, NetworkMode, ReadonlyRootfs, CapDrop/CapAdd, SecurityOpt,
Memory/NanoCpus/PidsLimit, Privileged, PublishAllPorts/PortBindings и ReadOnly mounts.
Каждый внешний вызов ограничен timeout; ожидание готовности ограничено сроком,
имена контейнеров регистрируются до create, очистка выполняется в finally.
Секреты монтируются только при запуске, не во время сборки.

На этапе реализации эти сценарии на контейнере не запускались. Локальные тесты проверили функции
допуска, wiring и валидаторы на искусственных данных; они не доказывают работу
Docker, исключение файлов настоящим builder, контейнерный UID/права и cleanup.
Позже владелец прислал успешный итог настоящего smoke; отдельно агент его не повторял.
Пятисекундный цикл готовности проверяет срок между командами; одна команда Docker
может занять до десяти секунд. Cleanup предусмотрен для обычных исключений;
обработчики сигналов процесса не добавлялись. Потребление двух процессов Node
в пределах 128 МиБ остаётся непроверенным.
Не запускались GitHub Actions, авторизованный GitHub API, GHCR, сборка или публикация.
Реальные .env/секреты, root-копии и инфраструктура не читались/не менялись.
Транспорт/auth, миграции и тестовые письма не затронуты; подагентов не запускали.

Статическое ревью завершено без новых находок, сборка/smoke разрешены и выполнены
владельцем по его выводу. Для конкретных Git-операций, публикации и включения
нужны отдельные разрешения. После публикации требуется получить digest;
успешный CI и наличие файлов не считаются готовым размещением.
