import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let api;
let fetchMock;

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('TELEGRAM_INGEST_BOT_TOKEN', 'test-ingest-token');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  api = await import('../../agent/telegram-api.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function ok(body) {
  return { ok: true, status: 200, json: async () => ({ ok: true, result: body }) };
}
function fail(desc) {
  return { ok: true, status: 200, json: async () => ({ ok: false, description: desc }) };
}

describe('telegram-api — token resolution', () => {
  it('throws when no token', async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const fresh = await import('../../agent/telegram-api.js');
    await expect(fresh.getUpdates({ fetchImpl: fetchMock }))
      .rejects.toThrow(/токен не задан|не задан/);
  });

  it('prefers TELEGRAM_INGEST_BOT_TOKEN over TELEGRAM_BOT_TOKEN', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'notify-token');
    fetchMock.mockResolvedValueOnce(ok([]));
    await api.getUpdates({ fetchImpl: fetchMock });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('bottest-ingest-token');
  });

  it('falls back to TELEGRAM_BOT_TOKEN', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'notify-token');
    vi.resetModules();
    const fresh = await import('../../agent/telegram-api.js');
    fetchMock.mockResolvedValueOnce(ok([]));
    await fresh.getUpdates({ fetchImpl: fetchMock });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('botnotify-token');
  });
});

describe('telegram-api.getUpdates', () => {
  it('sends offset and timeout', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ update_id: 1 }]));
    const r = await api.getUpdates({ offset: 42, timeoutSec: 15, fetchImpl: fetchMock });
    expect(r).toEqual([{ update_id: 1 }]);
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.offset).toBe(42);
    expect(body.timeout).toBe(15);
    expect(body.allowed_updates).toContain('message');
  });

  it('returns [] on timeout error (no new messages)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Request timeout'));
    const r = await api.getUpdates({ fetchImpl: fetchMock });
    expect(r).toEqual([]);
  });

  it('throws on real API error', async () => {
    fetchMock.mockResolvedValueOnce(fail('Unauthorized'));
    await expect(api.getUpdates({ fetchImpl: fetchMock })).rejects.toThrow(/Unauthorized/);
  });
});

describe('telegram-api.sendMessage', () => {
  it('sends chat_id, text, HTML', async () => {
    fetchMock.mockResolvedValueOnce(ok({ message_id: 1 }));
    await api.sendMessage('-100123', '<b>hi</b>', { fetchImpl: fetchMock });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/sendMessage');
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('-100123');
    expect(body.text).toBe('<b>hi</b>');
    expect(body.parse_mode).toBe('HTML');
    expect(body.disable_web_page_preview).toBe(true);
  });
});

describe('telegram-api.getFile / downloadFile', () => {
  it('getFile returns file metadata', async () => {
    fetchMock.mockResolvedValueOnce(ok({ file_id: 'f1', file_path: 'photos/x.jpg' }));
    const r = await api.getFile('f1', { fetchImpl: fetchMock });
    expect(r.file_path).toBe('photos/x.jpg');
  });

  it('downloadFile returns Buffer', async () => {
    const arr = new Uint8Array([1, 2, 3, 4]).buffer;
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      arrayBuffer: async () => arr,
    });
    const buf = await api.downloadFile('photos/x.jpg', { fetchImpl: fetchMock });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(4);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/file/bottest-ingest-token/photos/x.jpg');
  });

  it('downloadFile throws on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(api.downloadFile('x', { fetchImpl: fetchMock })).rejects.toThrow(/HTTP 404/);
  });

  it('downloadByFileId chains getFile + downloadFile', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ file_path: 'a/b.jpg' }))
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
    const buf = await api.downloadByFileId('fid', { fetchImpl: fetchMock });
    expect(buf.length).toBe(8);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
