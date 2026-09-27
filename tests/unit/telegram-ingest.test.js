import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { mockDownload, mockSend } = vi.hoisted(() => ({
  mockDownload: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock('../../agent/telegram-api.js', async () => {
  const actual = await vi.importActual('../../agent/telegram-api.js');
  return {
    ...actual,
    downloadByFileId: mockDownload,
    sendMessage: mockSend,
  };
});

let tmpDir;
let ingest;

const PHOTO_UPDATE = (chatId, userId, mediaGroupId = null, forwardOrigin = null) => ({
  update_id: Date.now(),
  message: {
    message_id: 1,
    chat: { id: chatId },
    from: { id: userId, first_name: 'Tester' },
    photo: [{ file_id: 'small' }, { file_id: 'big', file_size: 1000 }],
    media_group_id: mediaGroupId,
    forward_origin: forwardOrigin,
  },
});

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ing-'));
  vi.stubEnv('SMM_DATA_DIR', tmpDir);
  vi.stubEnv('TELEGRAM_INGEST_USERS', '12345');
  vi.stubEnv('TELEGRAM_INGEST_DEFAULT_PROJECT', 'coucou-events');
  vi.resetModules();
  mockDownload.mockReset().mockResolvedValue(Buffer.from('fake-jpeg'));
  mockSend.mockReset().mockResolvedValue({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ingest = await import('../../agent/telegram-ingest.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('extractForwardInfo', () => {
  it('null for non-forwarded', () => {
    expect(ingest.extractForwardInfo({})).toBeNull();
  });

  it('user forward via forward_origin (Bot API 7.0+)', () => {
    const r = ingest.extractForwardInfo({
      forward_origin: { type: 'user', sender_user: { username: 'john', first_name: 'John' } },
    });
    expect(r).toEqual({ source: '@john', type: 'user' });
  });

  it('user forward without username uses first_name', () => {
    const r = ingest.extractForwardInfo({
      forward_origin: { type: 'user', sender_user: { first_name: 'John' } },
    });
    expect(r.source).toBe('John');
  });

  it('hidden_user forward', () => {
    const r = ingest.extractForwardInfo({
      forward_origin: { type: 'hidden_user', sender_user_name: 'Anonymous' },
    });
    expect(r).toEqual({ source: 'Anonymous', type: 'hidden' });
  });

  it('channel forward', () => {
    const r = ingest.extractForwardInfo({
      forward_origin: { type: 'channel', chat: { username: 'news' } },
    });
    expect(r).toEqual({ source: '@news', type: 'channel' });
  });

  it('legacy forward_from (Bot API ≤6.x)', () => {
    const r = ingest.extractForwardInfo({
      forward_from: { username: 'legacy', first_name: 'Legacy' },
    });
    expect(r.source).toBe('@legacy');
  });

  it('legacy forward_from_chat', () => {
    const r = ingest.extractForwardInfo({
      forward_from_chat: { title: 'Legacy Channel' },
    });
    expect(r).toEqual({ source: 'Legacy Channel', type: 'channel' });
  });
});

describe('processUpdate — forwarded photo', () => {
  it('saves photo and mentions forward source', async () => {
    const u = PHOTO_UPDATE(100, 12345, null, {
      type: 'user', sender_user: { username: 'other_bot' },
    });
    const r = await ingest.processUpdate(u);
    expect(r.ok).toBe(true);
    expect(r.forwarded).toBe(true);

    // Telegram reply содержит источник
    const [chatId, text] = mockSend.mock.calls[0];
    expect(chatId).toBe(100);
    expect(text).toContain('@other_bot');
    expect(text).toContain('переслано');
  });

  it('regular photo (no forward) — no forward line', async () => {
    const u = PHOTO_UPDATE(100, 12345);
    await ingest.processUpdate(u);
    const [, text] = mockSend.mock.calls[0];
    expect(text).not.toContain('переслано');
  });

  it('unauthorized user rejected', async () => {
    const u = PHOTO_UPDATE(100, 99999);
    const r = await ingest.processUpdate(u);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unauthorized');
    const [, text] = mockSend.mock.calls[0];
    expect(text).toContain('Доступ запрещён');
  });
});

describe('processMediaGroup — album', () => {
  it('saves all photos in group and sends ONE reply', async () => {
    const updates = [
      PHOTO_UPDATE(100, 12345, 'grp1'),
      PHOTO_UPDATE(100, 12345, 'grp1'),
      PHOTO_UPDATE(100, 12345, 'grp1'),
    ];
    const r = await ingest.processMediaGroup(updates);
    expect(r.ok).toBe(true);
    expect(r.saved).toBe(3);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [, text] = mockSend.mock.calls[0];
    expect(text).toContain('Альбом (3 файлов)');
  });

  it('propagates forward info', async () => {
    const updates = [
      PHOTO_UPDATE(100, 12345, 'grp2', { type: 'user', sender_user: { username: 'src' } }),
      PHOTO_UPDATE(100, 12345, 'grp2', { type: 'user', sender_user: { username: 'src' } }),
    ];
    await ingest.processMediaGroup(updates);
    const [, text] = mockSend.mock.calls[0];
    expect(text).toContain('@src');
  });

  it('unauthorized album rejected', async () => {
    const updates = [PHOTO_UPDATE(100, 99999, 'grp3')];
    const r = await ingest.processMediaGroup(updates);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unauthorized');
  });

  it('empty album returns ok', async () => {
    const r = await ingest.processMediaGroup([]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
