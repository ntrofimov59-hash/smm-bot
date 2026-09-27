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
