import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let downloadImage;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  vi.resetModules();
  const mod = await import('../../agent/sources/downloader.js');
  downloadImage = mod.downloadImage;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mockRes({ ok = true, status = 200, contentType = 'image/jpeg', body, contentLength } = {}) {
  const buf = body instanceof Buffer ? body : Buffer.from(body || 'fake-image-bytes');
  return {
    ok,
    status,
    headers: {
      get: (h) => {
        const lc = h.toLowerCase();
        if (lc === 'content-type') return contentType;
        if (lc === 'content-length') return String(contentLength ?? buf.length);
        return null;
      },
    },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

describe('downloader — validation', () => {
  it('rejects missing url', async () => {
    await expect(downloadImage(null, tmpDir)).rejects.toThrow(/url обязателен/);
  });

  it('rejects non-https url', async () => {
    await expect(downloadImage('http://insecure/x.jpg', tmpDir)).rejects.toThrow(/https/);
  });

  it('rejects missing destDir', async () => {
    await expect(downloadImage('https://x/y.jpg', null)).rejects.toThrow(/destDir/);
  });
});

describe('downloader — HTTP errors', () => {
  it('throws on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ ok: false, status: 404 }));
    await expect(downloadImage('https://x/y.jpg', tmpDir, { fetchImpl }))
      .rejects.toThrow(/HTTP 404/);
  });

  it('wraps network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(downloadImage('https://x/y.jpg', tmpDir, { fetchImpl }))
      .rejects.toThrow(/сеть\/таймаут.*ECONNRESET/);
  });
});

describe('downloader — content-type', () => {
  it('rejects non-image content-type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ contentType: 'text/html' }));
    await expect(downloadImage('https://x/y', tmpDir, { fetchImpl }))
      .rejects.toThrow(/Content-Type: text\/html/);
  });

  it('accepts image/jpeg with charset', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ contentType: 'image/jpeg; charset=binary' }));
    const r = await downloadImage('https://x/y.jpg', tmpDir, { fetchImpl });
    expect(r.filename).toMatch(/\.jpg$/);
  });

  it('accepts image/png', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ contentType: 'image/png' }));
    const r = await downloadImage('https://x/y.png', tmpDir, { fetchImpl });
    expect(r.filename).toMatch(/\.png$/);
  });

  it('accepts image/webp', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ contentType: 'image/webp' }));
    const r = await downloadImage('https://x/y.webp', tmpDir, { fetchImpl });
    expect(r.filename).toMatch(/\.webp$/);
  });
});

describe('downloader — size limits', () => {
  it('rejects when Content-Length > maxBytes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({
      contentType: 'image/jpeg', contentLength: 999_999_999,
    }));
    await expect(downloadImage('https://x/y.jpg', tmpDir, { fetchImpl, maxBytes: 1000 }))
      .rejects.toThrow(/слишком большой/);
  });

  it('rejects when actual size > maxBytes', async () => {
    const big = Buffer.alloc(5000, 0xff);
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({
      contentType: 'image/jpeg', body: big, contentLength: 0,
    }));
    await expect(downloadImage('https://x/y.jpg', tmpDir, { fetchImpl, maxBytes: 1000 }))
      .rejects.toThrow(/слишком большой/);
  });

  it('rejects empty body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({
      contentType: 'image/jpeg', body: Buffer.alloc(0), contentLength: 0,
    }));
    await expect(downloadImage('https://x/y.jpg', tmpDir, { fetchImpl }))
      .rejects.toThrow(/пустой ответ/);
  });
});

describe('downloader — happy path', () => {
  it('saves file with hash-based filename', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ contentType: 'image/jpeg' }));
    const r = await downloadImage('https://x/photo.jpg', tmpDir, { fetchImpl });
    expect(r.filename).toMatch(/^\d+-[a-f0-9]{16}\.jpg$/);
    expect(fs.existsSync(r.path)).toBe(true);
    expect(r.sizeBytes).toBeGreaterThan(0);
    expect(r.sizeKB).toBeGreaterThanOrEqual(0);
    expect(r.contentType).toBe('image/jpeg');
    expect(r.sourceUrl).toBe('https://x/photo.jpg');
  });

  it('two calls with different urls → different files', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ contentType: 'image/jpeg' }));
    const a = await downloadImage('https://x/a.jpg', tmpDir, { fetchImpl });
    const b = await downloadImage('https://x/b.jpg', tmpDir, { fetchImpl });
    expect(a.filename).not.toBe(b.filename);
    expect(fs.existsSync(a.path)).toBe(true);
    expect(fs.existsSync(b.path)).toBe(true);
  });

  it('creates destDir if missing', async () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ contentType: 'image/jpeg' }));
    const r = await downloadImage('https://x/a.jpg', nested, { fetchImpl });
    expect(fs.existsSync(r.path)).toBe(true);
  });

  it('passes User-Agent and https check to fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes({ contentType: 'image/jpeg' }));
    await downloadImage('https://x/a.jpg', tmpDir, { fetchImpl });
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.headers['User-Agent']).toMatch(/smm-bot/);
    expect(opts.headers['Accept']).toBe('image/*');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
