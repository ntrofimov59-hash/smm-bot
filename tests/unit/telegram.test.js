import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let tg;
let fetchMock;

/**
 * Мок fetch: перехватывает вызовы, возвращает prepared response.
 * Работает с нативным fetch (undici) в Node 18+.
 *
 * Note: nock не подходит для fetch — он умеет только http.request.
 */
function mockFetchResponse({ ok = true, status = 200, body = { ok: true, result: { message_id: 1 } } } = {}) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  tg = await import('../../agent/telegram.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('telegram.notify', () => {
  it('возвращает error если нет конфига', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    vi.stubEnv('TELEGRAM_CHAT_ID', '');
    const r = await tg.notify('test');
    expect(r).toEqual({ ok: false, error: 'no telegram config' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('делает POST на api.telegram.org с правильным body', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '-100123');
    mockFetchResponse({ body: { ok: true, result: { message_id: 1 } } });

    const r = await tg.notify('hello');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('-100123');
    expect(body.text).toContain('hello');
    expect(body.parse_mode).toBe('HTML');
    expect(body.disable_web_page_preview).toBe(true);

    expect(r.ok).toBe(true);
  });

  it('возвращает ok:false если API вернул ошибку', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '-100123');
    mockFetchResponse({ body: { ok: false, description: 'chat not found' } });

    const r = await tg.notify('hello');
    expect(r.ok).toBe(false);
    expect(r.description).toBe('chat not found');
  });

  it('ловит сетевые ошибки и возвращает ok:false', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '-100123');
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const r = await tg.notify('hello');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ECONNREFUSED');
  });

  it('поддерживает кастомный prefix и parseMode', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('TELEGRAM_CHAT_ID', '1');
    mockFetchResponse();

    await tg.notify('msg', { prefix: 'PREFIX', parseMode: 'Markdown' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('PREFIX');
    expect(body.text).toContain('msg');
    expect(body.parse_mode).toBe('Markdown');
  });

  it('prefix=null → не добавляет префикс', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('TELEGRAM_CHAT_ID', '1');
    mockFetchResponse();

    await tg.notify('bare msg', { prefix: null });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe('bare msg');
  });
});

describe('telegram.notifyPublished', () => {
  it('формирует сообщение с аккаунтами и caption', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('TELEGRAM_CHAT_ID', '1');
    mockFetchResponse();

    await tg.notifyPublished({
      projectSlug: 'coucou',
      accounts: [{ username: 'a' }, { username: 'b' }],
      caption: 'Hello world',
      imageUrl: 'https://img',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('@a, @b');
    expect(body.text).toContain('Hello world');
    expect(body.text).toContain('coucou');
    expect(body.text).toContain('https://img');
  });

  it('обрезает caption >200 символов', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('TELEGRAM_CHAT_ID', '1');
    mockFetchResponse();

    await tg.notifyPublished({
      projectSlug: 'p',
      accounts: [],
      caption: 'x'.repeat(500),
      imageUrl: 'u',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('…');
    // оригинальная 500-символьная строка не должна попасть целиком
    expect(body.text).not.toContain('x'.repeat(300));
  });
});

describe('telegram.notifyFailed', () => {
  it('содержит текст ошибки и аккаунт', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('TELEGRAM_CHAT_ID', '1');
    mockFetchResponse();

    await tg.notifyFailed({ projectSlug: 'p', account: 'user1', error: 'rate limit' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('@user1');
    expect(body.text).toContain('rate limit');
  });

  it('обрезает очень длинную ошибку', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('TELEGRAM_CHAT_ID', '1');
    mockFetchResponse();

    await tg.notifyFailed({ projectSlug: 'p', account: 'u', error: 'e'.repeat(1000) });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text.length).toBeLessThan(1500);
  });
});

describe('telegram.notifyScheduled', () => {
  it('содержит count и nextTime', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
    vi.stubEnv('TELEGRAM_CHAT_ID', '1');
    mockFetchResponse();

    await tg.notifyScheduled({ projectSlug: 'p', count: 5, nextTime: '2026-09-28 11:00' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('5');
    expect(body.text).toContain('2026-09-28 11:00');
  });
});
