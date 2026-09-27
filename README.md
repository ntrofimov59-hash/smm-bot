![CI](https://github.com/ntrofimov59-hash/smm-bot/actions/workflows/ci.yml/badge.svg)

# SMM Bot — автоматический менеджер социальных сетей

Мульти-проектный бот для автоматической публикации в Instagram.
Сканирует `inbox/`, обрабатывает фото, генерирует подписи и публикует по расписанию.

## Быстрый старт

```bash
# 1. Кидаешь фото в inbox
cp my-photo.jpg projects/coucou-events/inbox/

# 2. Сканируешь (dry-run — только показать)
node cli.js scan --dry

# 3. Реальный скан — планирует публикации
node cli.js scan

# 4. Проверить состояние
node cli.js status

# 5. Ближайшие посты
node cli.js upcoming
Архитектура
text
projects/<project-slug>/
  ├── project.json     настройки (бренд, хештеги, фильтры, расписание)
  ├── accounts.json    аккаунты + токены (Instagram, Facebook, Threads)
  ├── inbox/           ← сюда кидаешь новые фото
  ├── scheduled/       обработанные фото с назначенным временем
  ├── published/       архив опубликованного
  └── failed/          с ошибками

agent/
  ├── vision.js         анализ фото через Gemini/Groq
  ├── vision-cache.js   кэш анализов (SHA256)
  ├── image-processor.js обработка + логотип
  ├── matcher.js        подбор аккаунтов по тегам
  ├── caption.js        генерация подписей через Groq
  ├── hashtags.js       хештеги с ротацией
  ├── planner.js        планирование времени
  ├── queue.js          очередь постов
  ├── scanner.js        сканирует inbox, всё объединяет
  ├── scheduler.js      публикует по расписанию
  ├── publishers/
  │   └── instagram.js  publication через graph.instagram.com
  ├── telegram.js       уведомления в аналитический бот
  └── usage.js          лимиты и расход

bot.js                  главный процесс (cron: scan 15мин, scheduler 1мин)
cli.js                  управление
Команды CLI
Команда	Что делает
node cli.js status	Состояние очереди + расход API
node cli.js scan	Сканировать все проекты
node cli.js scan --dry	Только показать, что будет сделано
node cli.js upcoming	Ближайшие запланированные посты
node cli.js publish-now <id>	Публиковать немедленно
PM2
bash
pm2 status                     # статус
pm2 logs smm-bot               # логи
pm2 restart smm-bot            # рестарт
pm2 stop smm-bot               # остановка
Токены Instagram
Токены хранятся в projects/<slug>/accounts.json:

json
{
  "instagram": [{
    "city": "phuket",
    "cityTags": ["beach", "tropical"],
    "username": "events.phuket_coucou",
    "igUserId": "28658696263816076",
    "accessToken": "IGAA...",
    "active": true
  }]
}
Срок жизни: 60 дней. Обновляется через Meta Developer.

Лимиты (в .env)
LIMIT_GROQ_TOKENS_DAY=200000

LIMIT_GEMINI_REQ_DAY=1500

LIMIT_POSTS_DAY=20

При 80% и 100% — уведомление в Telegram.

Уведомления
Все уведомления идут в аналитический Telegram-бот (ANALYTICS_BOT_TOKEN) с префиксом 🤖 [SMM], чтобы не смешиваться с заявками клиентов.

## Testing

Стек: **Vitest** + **@vitest/coverage-v8** + `vi.stubGlobal('fetch')` для мок-тестов API.

Запуск:

    pnpm test          # все тесты
    pnpm test:watch    # watch mode
    pnpm test:cov      # с покрытием

### Coverage ratchet

Чтобы CI не блокировался из-за непокрытых интеграционных модулей (`vision.js`, `instagram.js`), порог покрытия применяется только к модулям, у которых уже есть тесты. Список — в `vitest.config.js` → `coverage.include`. По мере написания тестов новые модули добавляются туда.

| Модуль | Покрытие | Статус |
|--------|----------|--------|
| `planner.js` | 98% | готово |
| `matcher.js` | 100% | готово |
| `hashtags.js` | 100% | готово |
| `usage.js` | 98% | готово |
| `queue.js` | 100% | готово |
| `telegram.js` | 100% | готово |
| `vision-cache.js` | 93% | готово |
| `caption.js` | — | следующая итерация |
| `vision.js` | — | следующая итерация |
| `instagram.js` | — | следующая итерация |
| `scanner.js` | — | e2e |

### Notable bugs caught by tests

- **Timezone bug in planner** — `scheduleNext` возвращал 15:00 UTC для `11:00 Yerevan` вместо 07:00 UTC. Знак offset был перевёрнут. Поймано unit-тестом на контракт (`getUTCHours() === 7`). См. `tests/unit/planner.test.js`, коммит `a9aae5d`.

- **Pinterest pin id — regex невозможен** — тест ожидал `sourceId = '123456789'`, но CDN-URL не содержит pin id (только hash). Pin id живёт в `<a href="/pin/.../">` отдельно от `<img>`. Фикс: убрали неверную функциональность, задокументировали ограничение, запланировали парсинг `__PWS_DATA__`. См. `tests/unit/sources-pinterest.test.js`.

- **Caption parser override** — при пустом `CAPTION:` от LLM парсер подменял его текстом `"CAPTION:\nHASHTAGS:"` через fallback «весь текст — caption». Main-код считал caption непустым и не применял `fallbackCaption`, публикуя мусор. Фикс: если секции найдены — доверяем им полностью. Поймано тестом на контракт. См. `tests/unit/caption.test.js`.

### CI

GitHub Actions запускает `pnpm test:cov` на каждый push и PR в `main`. Coverage-артефакт доступен для скачивания на странице Actions.



### Coverage out-of-process

`cli.js` тестируется через `execFileSync('node', ['cli.js', ...])` — реальный подпроцесс,
максимально близко к продакшену. Но vitest v8-coverage **не видит код подпроцессов**,
поэтому `cli.js` не включён в `coverage.include` — не хотим показывать ложные 0%.

**Альтернатива** (если понадобится покрытие e2e): запускать подпроцесс с
`NODE_V8_COVERAGE=<dir>` и мержить отчёты через `c8 report`. Не сделано, потому что
сложность не оправдана — сами e2e-сценарии (14 штук) полностью проверяют поведение CLI.

### Pinterest source: known limitations

`agent/sources/pinterest.js` использует regex-подход: собирает все
`i.pinimg.com/<size>/<hash>.jpg` из HTML доски. Это даёт картинки, но **не даёт pin id**.

**Почему:** Pinterest CDN url содержит только хэш, а pin id приходит в отдельном
`<a href="/pin/<id>/">` и связан с `<img>` только через структурированный JSON
(`__PWS_DATA__`), который меняется без предупреждения.

**Что это значит:** поле `sourceId` в результате всегда `null`. Дедуп работает
по самому URL картинки (нормализованному на 736x).

**План улучшения:** парсинг `__PWS_DATA__` JSON даст pin id + метаданные (описание,
ссылку на pin). Отложено — regex уже покрывает главный кейс (сбор картинок).

### nock не перехватывает fetch

Первая версия `tests/unit/telegram.test.js` использовала **nock** — все 8 тестов
упали, запросы уходили в реальную сеть и получали `Not Found` от Telegram.

**Причина:** nock перехватывает `http.request` / `https.request` (legacy Node API),
но **не** нативный `fetch` (undici), который используется в коде.

**Решение:** мок `fetch` напрямую через `vi.stubGlobal('fetch', mockFn)`.
Это работает с undici, быстрее и явно проверяет контракт (URL, method, headers, body).

Аналогичный подход используется для Instagram Graph API, Groq и Gemini.
