# Contributing

Спасибо за интерес! Правила простые: не ломать прод, покрывать тестами, не коммитить секреты.

## Требования

- **Node.js 20+** (CI на 20)
- **pnpm 10+** (используется `allowBuilds` в `pnpm-workspace.yaml`)
- Git

## Установка

```bash
git clone https://github.com/ntrofimov59-hash/smm-bot
cd smm-bot
pnpm install

# скопировать шаблон переменных и заполнить
cp .env.example .env
$EDITOR .env

# запустить тесты — все должны пройти
pnpm test
Минимально нужно заполнить:

text
GEMINI_API_KEY=...   # https://aistudio.google.com/app/apikey
GROQ_API_KEY=...     # https://console.groq.com/keys
Остальное (TELEGRAM_BOT_TOKEN, MEDIA_DIR, лимиты) — опционально для локальной разработки.

Запуск бота локально
bash
# положить тестовое фото
cp my-photo.jpg projects/coucou-events/inbox/

# dry-run — не публикует и не пишет в очередь
node cli.js scan --dry

# реальный скан — добавляет в queue
node cli.js scan

# посмотреть состояние
node cli.js status
node cli.js upcoming
Перед коммитом
bash
pnpm test                # 205 тестов должны пройти
git diff --cached        # визуально проверить, что коммитишь
CI запустит pnpm test:cov автоматически на push и PR. Красный CI = PR не мержится.

Стиль коммитов
Conventional Commits:

text
feat(sources): add pinterest parser
fix(planner): correct timezone offset sign
test: add queue unit tests
docs: update README
chore(coverage): exclude cli.js
ci: pin pnpm 11
Формат: <type>(<scope>): <subject>. В теле — почему, а не только что.

Пример из истории:

text
fix(planner): correct timezone offset sign + locale-independent calc

- use Intl.DateTimeFormat.formatToParts instead of toLocaleString
- fix offset sign: Yerevan 11:00 now correctly maps to 07:00 UTC

The original test caught a real bug: scheduleNext was returning 15:00 UTC
for '11:00 Yerevan' instead of 07:00 UTC.
Правила PR
Каждая новая функция — с тестами. PR без тестов закрывается.

Не коммить секреты. .env, projects/*/accounts.json, data/, node_modules/, tmp/, coverage/ — в .gitignore.

Не ломать существующее покрытие. Если добавляешь модуль — добавь его в vitest.config.js → coverage.include.

Малые PR. Один PR — одна логическая единица. Если в PR 20 файлов и 5 несвязанных тем — раздели.

Дифф читаемый. Не переформатируй чужие файлы без причины.

Добавление нового модуля
Пошаговый чеклист:

Создать agent/your-module.js с одной ответственной задачей.

Внешние зависимости — через env (SMM_DATA_DIR, MEDIA_DIR) или через параметры функции. Никаких top-level new SDK({ apiKey: process.env.X }) — падает при импорте, если ключа нет (см. README, баг #4).

Создать tests/unit/your-module.test.js:

happy path

ошибки (что если API вернул 4xx/5xx, сеть отвалилась)

границы (пустой вход, максимум, невалидный тип)

Добавить в vitest.config.js → coverage.include.

pnpm test:cov — проверить, что новый модуль дал ≥70%.

Если модуль общается с внешним API — используй vi.stubGlobal('fetch') (raw HTTP) или vi.mock('sdk') (SDK). См. TESTING.md.

Структура проекта
text
agent/
  vision.js          анализ фото (Gemini + Groq fallback)
  vision-cache.js    SHA256-кэш
  caption.js         подписи (Groq)
  hashtags.js        подбор с ротацией
  matcher.js         фото → аккаунты по тегам
  planner.js         расписание (timezone-aware)
  queue.js           очередь (JSON, есть план на SQLite)
  scanner.js         inbox → очередь
  scheduler.js       очередь → публикация
  publishers/
    instagram.js     Graph API publish
  sources/           fetching внешнего контента
    downloader.js    https-only скачивание
    pinterest.js     парсинг доски
    instagram-graph.js  /me/media
    index.js         диспетчер
  telegram.js        уведомления
  usage.js           лимиты API
bot.js               main cron loop
cli.js               команды (status/scan/fetch/...)
Безопасность
Никогда не коммитить:

.env и любые .env.* (кроме .env.example)

projects/*/accounts.json (там Instagram accessToken)

data/, logs/, tmp/, coverage/, node_modules/

Что делать, если утечка:

Немедленно отозвать токен (Telegram: @BotFather /revoke; Instagram: перевыпустить в Meta Developer; Groq/Gemini: удалить ключ в кабинете).

Выпустить новые.

Если токен уже в истории git — переписать историю (git filter-repo), force-push, или сделать чистый старт (как в этом репо на этапе e7c1f8a..66f6c1b).

Не полагаться на «удалил файл» — токен остаётся в истории и в GitHub cache.

Вопросы
Открывай Issue с тегом question или пиши в PR.
