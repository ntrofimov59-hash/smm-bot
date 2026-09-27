![CI](https://github.com/ntrofimov59-hash/smm-bot/actions/workflows/ci.yml/badge.svg)
![Tests](https://img.shields.io/badge/tests-287%2B%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-97%25-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D20-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

# SMM Bot — автоматический менеджер социальных сетей

Мульти-проектный бот для автоматической публикации в Instagram.
Сканирует `inbox/`, обрабатывает фото, генерирует подписи и публикует по расписанию.

## Документация

- [TESTING.md](./TESTING.md) — стратегия тестирования, как мокать, 4 бага, найденные тестами
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, стиль коммитов, правила PR


## Содержание

- [Быстрый старт](#быстрый-старт)
- [Архитектура](#архитектура)
- [Fetching content](#fetching-content)
- [Docker](#docker)
- [Очередь: JSON / SQLite](#бэкенды-очереди)
- [Тестирование](#testing)
- [Документация](#документация)
- [Безопасность](#безопасность)

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

## Fetching content

Перед сканированием можно наполнить `inbox/` проекта картинками из внешних источников.

    # Pinterest: парсит публичную доску
    node cli.js fetch pinterest https://www.pinterest.com/user/board/ --project coucou-events --limit 20

    # Instagram (свои аккаунты, официальный Graph API)
    node cli.js fetch instagram-graph --project coucou-events --limit 25

    # Instagram (бизнес-аккаунт по igUserId, доступ через Graph API)
    node cli.js fetch instagram-user --ig-user-id 12345 --project coucou-events

После fetch — обычный скан:

    node cli.js scan --dry   # посмотреть что найдено
    node cli.js scan         # запланировать

### Безопасность

| Источник | Риск бана | Прокси | Примечание |
|----------|-----------|--------|------------|
| Pinterest | средний (ToS) | рекомендуются резидентные | публичные доски, UA-маскировка |
| Instagram Graph | нет | не нужны | только свои аккаунты |
| Instagram User | нет | не нужны | только с разрешением |

**Почему не парсим чужие Instagram:** официальный API не даёт чужие медиа,
а неофициальный (через скрапинг) приведёт к бану IP. Для чужих постов —
только с явного согласия владельца через Graph API.


## Docker

Бот упакован в Docker. Одна команда — и всё работает на любой машине с Docker.

### Быстрый старт

    # 1. .env с ключами
    cp .env.example .env
    $EDITOR .env

    # 2. Сборка образа (multi-stage: builder + runtime)
    docker compose build

    # 3. Одноразовые команды для проверки (не запускают cron)
    docker compose run --rm smm-bot node cli.js help
    docker compose run --rm smm-bot node cli.js status
    docker compose run --rm smm-bot node cli.js validate

    # 4. Запуск бота в фоне (cron-процесс)
    docker compose up -d
    docker compose logs -f smm-bot

### Что внутри

- **Multi-stage build:** builder (pnpm + build tools) → runtime (только prod deps)
- **tini** как PID 1 — корректная обработка сигналов
- **`pnpm prune --prod`** — dev-зависимости (vitest) не попадают в runtime
- **`.dockerignore`** — контекст без `.git`, `node_modules`, `tests`, секретов

### Volumes

| Хост | Контейнер | Что хранит |
|------|-----------|------------|
| `./agent/data` | `/app/agent/data` | `queue.json` / `queue.db`, usage, hashtags-used |
| `./projects` | `/app/projects` | `project.json`, `accounts.json`, `inbox/`, `processed/` |
| `./logs` | `/app/logs` | логи (при необходимости) |
| `/var/www/smm-media` | `/var/www/smm-media` | публичные картинки (nginx раздаёт снаружи) |

### Переключение PM2 → Docker

    pm2 stop smm-bot && pm2 delete smm-bot && pm2 save
    docker compose up -d
    docker compose logs -f smm-bot

Откат:

    docker compose down
    pm2 start ecosystem.config.cjs
    pm2 save

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

- **CI: scan падал на чистом клоне** — `node cli.js scan --dry` в CI упал с `ENOENT: accounts.json`. Файл в `.gitignore` (содержит Instagram accessToken), поэтому в CI его нет. Локально он есть → тест зелёный. Прод-баг: сканер не умел работать с проектом без настроенных аккаунтов. Фикс: `scanProject` возвращает нулевую статистику с warn, если `accounts.json` отсутствует. **Урок:** e2e в CI на чистом клоне — это интеграционный тест окружения, а не только кода.

- **CI красный, локально зелёный (lazy SDK init)** — все 13 e2e cli-тестов падали с `exit code 1` и пустым stdout **только на CI**. Причина: `agent/vision.js` и `agent/caption.js` создавали `new GoogleGenAI(...)` и `new OpenAI(...)` на top-level модуля с `apiKey: process.env.X`. Локально `.env` есть → ключи подхватываются. На CI `.env` в `.gitignore` → ключи undefined → SDK бросает «Api key is required» при импорте → `cli.js` падает. Unit/integration тесты не ловили, потому что используют `vi.mock()` на SDK. Фикс: lazy init через `getGemini()` / `getGroq()`. Симптом-детект: `mv .env .env.bak && node cli.js help` → exit 1 до фикса, exit 0 после. См. `tests/e2e/cli.test.js`.

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

### Бэкенды очереди

Бот поддерживает два бэкенда. Выбор — через `QUEUE_BACKEND` в `.env`.

| Бэкенд | Файл | Когда использовать |
|--------|------|-------------------|
| `json` (по умолчанию) | `data/queue.json` | маленькая очередь, простой дебаг |
| `sqlite` | `data/queue.db` | прод, ACID, индексы, WAL |

Переключение:
```bash
# посмотреть, что где лежит
node cli.js queue info

# мигрировать (идемпотентно, безопасно)
QUEUE_BACKEND=sqlite node cli.js queue migrate

# переключить прод — добавить QUEUE_BACKEND=sqlite в .env
# затем
pm2 restart smm-bot --update-env
Миграция не удаляет queue.json (только если явно --delete-old). Откат — поменять env обратно.
