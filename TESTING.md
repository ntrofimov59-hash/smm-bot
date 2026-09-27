# Testing Strategy

Стратегия тестирования SMM Bot. Основной принцип: **новая функциональность приходит вместе с тестами**. PR без тестов не принимается.

## Пирамида
┌─────────────┐
│ e2e (14) │ tests/e2e/ реальный cli.js как подпроцесс
├─────────────┤
│ integ (16) │ tests/integration/ scanner + fetch→inbox на tmpdir
├─────────────┤
│ unit (175) │ tests/unit/ всё остальное, всё мокается
└─────────────┘

text

Всего: **205 тестов**, 17 файлов, покрытие ~97% по 14 модулям.

## Инструменты

| Инструмент | Для чего |
|------------|----------|
| **Vitest 2.x** | раннер (ESM-native, быстрый) |
| **@vitest/coverage-v8** | покрытие + порог |
| `vi.mock()` | подмена SDK-модулей (`openai`, `@google/genai`) |
| `vi.hoisted()` | переменные для `vi.mock` (иначе hoisting сломает) |
| `vi.stubGlobal('fetch', fn)` | мок HTTP в модулях на нативном `fetch` |
| `vi.stubEnv()` + `vi.resetModules()` | изоляция env-зависимых модулей |
| `vi.useFakeTimers()` | polling, retry, setTimeout |
| `os.tmpdir()` + `fs.mkdtempSync()` | изоляция файловых операций |

## Как мокать

### Raw HTTP (`fetch`)

Модули `agent/publishers/instagram.js`, `agent/telegram.js`, `agent/sources/*` используют нативный `fetch` (undici):

```js
const fetchMock = vi.fn().mockResolvedValue({
  ok: true, status: 200,
  json: async () => ({ ... }),
});
vi.stubGlobal('fetch', fetchMock);
Почему не nock: nock перехватывает http.request (legacy API), но не fetch. См. README → «nock не перехватывает fetch».

SDK-клиенты
agent/caption.js использует openai, agent/vision.js — @google/genai и openai:

js
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  default: class { constructor() { this.chat = { completions: { create: mockCreate } }; } },
}));
vi.hoisted() обязателен — vi.mock поднимается в начало файла, обычные const выше него не существуют.

Env-зависимые модули
queue.js, usage.js, hashtags.js, vision-cache.js читают SMM_DATA_DIR:

js
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.resetModules();
  mod = await import('../../agent/queue.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
Coverage ratchet
Порог применяется только к модулям в coverage.include (vitest.config.js). Это защищает от падения CI, пока не покрыты интеграционные модули.

Правило: добавил модуль → добавил в include → добавил тесты. Список растёт монотонно, порог 70% для statements.

cli.js не включён — e2e-тесты запускают его как подпроцесс, v8-coverage не видит код подпроцессов. Альтернатива (NODE_V8_COVERAGE + c8 merge) не сделана сознательно.

Как написать новый тест
Определи границы модуля — что он импортирует, какие внешние API зовёт.

Реши, что мокать: SDK → vi.mock; fetch → stubGlobal; fs → SMM_DATA_DIR + tmpdir.

Покрой три класса кейсов: happy path, ошибки, границы (пустое/максимум/невалидное).

Один it = одна проверяемая идея. Если название содержит «и» — раздели.

Не бойся, если тест упал. Он часто ловит реальный баг — см. ниже.

Баги, найденные тестами
Тесты не для галочки — 4 реальных бага:

#	Баг	Тест	Коммит
1	Timezone: 11:00 Yerevan → 15:00 UTC вместо 07:00	tests/unit/planner.test.js	a9aae5d
2	Caption parser: пустой CAPTION: перезаписывался текстом секций	tests/unit/caption.test.js	0a3da58
3	Pinterest: regex не может достать pin id из CDN URL	tests/unit/sources-pinterest.test.js	02be27d
4	CI red / local green: SDK падал при импорте без .env	tests/e2e/cli.test.js	5424351
Полные описания — в README → «Notable bugs caught by tests».

Известные ограничения
Pinterest pin id — regex-подход даёт только imageUrl, sourceId всегда null. См. README.

Out-of-process coverage — cli.js не в отчёте покрытия.

bot.js (cron) — не покрыт, отложено (тестировать cron через fake timers можно, но ценность мала).

refresh-tokens.js — требует реальный Meta API, отложено.

Запуск
bash
pnpm test              # разово
pnpm test:watch        # watch mode
pnpm test:cov          # с покрытием + порог
pnpm test -- tests/unit/planner.test.js   # один файл
pnpm test -- -t "timezone"                 # по имени
CI
.github/workflows/ci.yml запускает pnpm test:cov на каждый push и PR в main. Артефакт coverage/ прикрепляется к прогону.
