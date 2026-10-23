# Перепроверка размещения почты

2026-10-22. По «го» владельца добавлены только синтетические проверки и уточнения
документов. Затем владелец отдельным «да» разрешил применить показанный патч
к deploy/update.sh локально. Операторский Bash-блок, базовый Compose и транспорт
не менялись; root-копия updater не затронута.

| Проверка | Результат | Граница |
|---|---|---|
| Блок секретов через PTY | 17/17 | Linux bubblewrap: root внутри user namespace, временные искусственные файлы, без сети |
| Без проверки существующих файлов | 2 теста красные | Запрашивается ввод вместо раннего отказа |
| Без noclobber | 2 теста красные | Искусственные файлы, появившиеся после предварительной проверки, перезаписываются |
| Без set +x | 1 тест красный | Обнаружен искусственный ключ в перехваченном выводе; сам вывод не публикуется |
| Compose и фрагменты updater | 1/1 | Настоящий CLI 5.6.0, config; image inspect подменён, Engine и полный updater не запускались |
| Проверка типов | Пройдена | pnpm exec tsc -p tsconfig.json --pretty false |
| После применения updater | Compose 1/1, bash -n и tsc пройдены | Испытана текущая функция; Engine и полный updater не запускались |

Исходники проверок: tests/ops/mail-secrets.test.ts, mail-secrets-pty.py и
mail-compose.test.ts. Результаты и хеши — test-results/mail-deployment.
17 сценариев включают оба известных окна регистрации пути: после прерывания
остаётся только соответствующий пустой файл 0600. Это ограничение, не гарантия
полной очистки при любом сигнале. Доступ к реальным файлам и чтение контейнером
uid 1000 остаются отдельной операторской проверкой.

## Согласованное локальное исправление updater

Прежняя функция image_ids получает от `config --images hub` три образа: hub,
play и mail-relay. Она передаёт их одним многострочным аргументом image inspect;
в испытанном фрагменте наблюдается запасное «нет:…». Порядок строк Compose
между вызовами может отличаться. Отсутствие mail-relay в SERVICES не исключает
его из этого вывода. Прежняя функция воспроизводится только в памяти теста.

Показанный владельцу патч test-results/mail-deployment/gf-update-proposed.patch
применён локально без дополнительных изменений updater. Он выбирает
services[имя].image из JSON Compose и отвергает пустой/многострочный результат.
Текущая функция прошла 1/1 с подменённым image inspect; bash -n и root tsc пройдены.
Результаты: compose-applied.tap и compose-applied-check.json в каталоге артефактов.
Правка требует python3 на целевом VPS; наличие там не проверено.
Изменение root-копии и запуск требуют отдельного согласия; полноценное испытание updater
с Docker Engine, целевым CLI и операторской конфигурацией здесь не выполнялось.

Отдельно проверена существующая ветка неизменных образов: обычный вызов выходит,
а --force проходит к применению. Это проверка фрагмента условия, не запуск
настоящего --force. Поэтому первоначальная активация overlay отдельно согласуется.

## Повторение локальных проверок

Нужны Linux user namespaces, bubblewrap, Python 3, Bash и Node для PTY-suite;
Docker Compose CLI для второго suite. Настоящие секреты и Docker Engine не нужны.

```bash
node --test --experimental-test-isolation=none --test-concurrency=1 tests/ops/mail-secrets.test.ts
node --test --experimental-test-isolation=none tests/ops/mail-compose.test.ts
env GF_MAIL_TEST_MUTATION=guard node --test --experimental-test-isolation=none --test-name-pattern='ранний отказ' tests/ops/mail-secrets.test.ts
env GF_MAIL_TEST_MUTATION=noclobber node --test --experimental-test-isolation=none --test-name-pattern='noclobber после' tests/ops/mail-secrets.test.ts
env GF_MAIL_TEST_MUTATION=trace node --test --experimental-test-isolation=none --test-name-pattern='успешный скрытый' tests/ops/mail-secrets.test.ts
```

Последние три команды должны завершиться с ошибкой соответствующей проверки.
Мутации меняют только извлечённую временную копию блока, не документ.

Не проверялись реальные секреты, сети/egress, root-копии, образы, контейнеры,
доставка, аккаунт Resend и tracking. Git, подагенты, отправка и публикация
не выполнялись. Это не приёмка размещения на VPS.
