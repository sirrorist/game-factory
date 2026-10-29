# Промпт ревью закрытого A

Ревьюера запускает владелец. Текст для передачи:

```text
Проведи read-only security-ревью реализации только закрытого A 2А-03.
Владелец утвердил план после ревью без находок, включая сроки/mail-лимиты,
постоянные операции, диспетчер Node и отдельный ключ шифрования (D-064).
B/C/D, рабочая миграция/ключи, Git и публикация не разрешены.

Патч: test-results/auth-a/gf-auth-a-review.patch
Копия: /tmp/gf-auth-a-review.patch
Manifest: test-results/auth-a/review-manifest.json
Полные версии и исходные версии изменённых файлов: candidate/ и baseline/
рядом с manifest. Это срез изменений A относительно локального состояния
с уже существующим 2А-02, не общий diff рабочей копии и не патч относительно main.
Если патча нет, запроси путь; не получай через Git.

Прочитай AGENTS.md, CLAUDE.md, apps/hub/AGENTS.md, .claude/agents/security.md
и полную указанную там global-agent-kit/roles/SECURITY.md. Не приписывай себе
модель фронтматтера. Затем план HUB-STAGE-2A-03-AUTH-PLAN, отчёт
HUB-STAGE-2A-03-AUTH-REPORT, SECURITY, TESTING, D-047/D-062/D-063/D-064,
релевантные части контракта пользователей и план этапа 2А.

Проверь весь патч и текущие файлы по manifest, особенно:
- packages/db/src/{auth-actions,auth-mail,auth-crypto,auth-schema,schema,roles,index}.ts;
- migration 0003_auth_mail.sql, journal/snapshot и drizzle.config.ts;
- hub auth-actions-http/runtime, auth-mail-dispatcher, auth-core, instrumentation;
- четыре POST route, обе страницы, AuthActionForm и next.config.ts;
- auth-actions.pgtest.ts и дополнения access-concurrency.pgtest.ts.
Контекст: нынешние auth-access.ts/access.ts/transaction.ts/admin.ts, migration 0002,
mail-client.ts и непосредственно используемый protocol/config транспорта.
Не переоткрывай принятые сетевые границы и не считай B/C/D готовыми.

1. Потребление: исходный raw token, purpose/email/generation/expiry/status,
   повтор/NULL, конфликт другой сессии; отсутствие session/role/step-up после verify.
   Reset только user/developer без обязательного фактора, также после смены прав.
   auth_recovery_guards — операторский маркер для будущего B, не готовый MFA;
   необязательный player-passkey не равен обязательному фактору.
2. SQL: узкий SECURITY DEFINER, фиксированный search_path/EXECUTE, gf_hub без
   общего UPDATE служебных полей/журнала; raw hash из таблицы не является bearer;
   невозможность GUC-подделки operator. Полный rollback и порядок блокировок,
   исходное доказательство при retry 40P01/40001, отсутствие HTTP под lock.
   Включи границу auth_actions_not_before для ещё не подготовленных намерений.
3. Доставка: отсутствие user/provider lookup в публичном запросе, стабильный
   подписанный intent при потере cookie и изменении payload, предел суток.
   Ciphertext/metadata/key-id, отказ без ключа с сохранением pending, отсутствие
   plaintext fallback и нового ID. Сохраняется точный PreparedMail перед HTTP.
   Pending переживает рестарт, started становится unknown без resend; два
   dispatcher не отправляют одно задание, максимум два send на процесс.
   Сеть после commit; отзыв во время HTTP оставляет доставленную ссылку мёртвой.
4. Лимиты: email/browser/IP, HMAC и IPv6 /64, cooldown/скользящий час/UTC-день/месяц,
   неизвестный email и роли, источниковый 429, bounds/cleanup и отсутствие вытеснения.
   Общий LoginGuard не заменён, полной Q3 это не объявляется.
5. HTTP/Next: закрытые по умолчанию флаги и Node-only запуск вне build/Edge;
   GET не потребляет, POST Origin+CSRF, ограниченное чтение body;
   закрыты альтернативные Better Auth GET/POST/server API; F1–F4 не открылись.
   no-store/no-referrer, фиксированные пути, отсутствие bearer в ошибках/логах.
6. Проверяемость: сопоставь реальные негативные тесты/мутации с мерами.
   TAP, mutations.json и typecheck — сведения исполнителя, не твои запуски.
   Нативные тесты используют собственный временный PostgreSQL и два backend,
   включая отдельное подключение gf_hub. Это не рабочая БД и не браузерный e2e.
   Не объявляй проверенными Next build/instrumentation lifecycle, аппаратный
   WebAuthn, CI, рабочие миграцию/ротацию/доставку и журналы инфраструктуры.

Только чтение. Не менять файлы, не запускать Git, приложение, тесты, миграции,
сборки, Docker/Compose, Actions, публикацию, подагентов или мониторинг.
Не читать настоящие .env, deploy/secrets, ключи, рабочую БД, root-копии
и персональные данные. Разрешены синтетические артефакты и локальные исходники
установленных Better Auth/Next; официальная публичная документация при необходимости.

Дай короткий вердикт, находки с приоритетом/адресом/сценарием/минимальным
исправлением; отдельно непроверенное и решения владельца. Соблюдай обязательный
формат security-роли. Ничего не исправляй и не выдавай результаты исполнителя за свои.
```

Для трёх замечаний первого ревью подготовлен [промпт перепроверки](HUB-STAGE-2A-03-AUTH-RECHECK-PROMPT.md).
