import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  mockFetchPinterest,
  mockFetchOwnMedia,
  mockFetchUserMedia,
  mockDownloadImage,
} = vi.hoisted(() => ({
  mockFetchPinterest: vi.fn(),
  mockFetchOwnMedia: vi.fn(),
  mockFetchUserMedia: vi.fn(),
  mockDownloadImage: vi.fn(),
}));

vi.mock('../../agent/sources/pinterest.js', () => ({
  fetchPinterestBoard: mockFetchPinterest,
}));

vi.mock('../../agent/sources/instagram-graph.js', () => ({
  fetchOwnMedia: mockFetchOwnMedia,
  fetchUserMedia: mockFetchUserMedia,
}));

vi.mock('../../agent/sources/downloader.js', () => ({
  downloadImage: mockDownloadImage,
}));

let sources;
let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-'));
  vi.resetModules();
  mockFetchPinterest.mockReset();
  mockFetchOwnMedia.mockReset();
  mockFetchUserMedia.mockReset();
  mockDownloadImage.mockReset();
  sources = await import('../../agent/sources/index.js');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sources.fetchContent — dispatch', () => {
  it('rejects unknown source', async () => {
    await expect(sources.fetchContent('twitter', {}))
      .rejects.toThrow(/неизвестный источник "twitter"/);
  });

  it('pinterest: requires boardUrl', async () => {
    await expect(sources.fetchContent('pinterest', {}))
      .rejects.toThrow(/boardUrl/);
  });

  it('pinterest: delegates to fetchPinterestBoard', async () => {
    mockFetchPinterest.mockResolvedValue([{ imageUrl: 'https://i.pinimg.com/x.jpg' }]);
    const r = await sources.fetchContent('pinterest', { boardUrl: 'https://www.pinterest.com/u/b/' });
    expect(mockFetchPinterest).toHaveBeenCalledWith(
      'https://www.pinterest.com/u/b/',
      expect.any(Object),
    );
    expect(r).toHaveLength(1);
  });

  it('instagram-graph: requires accessToken', async () => {
    await expect(sources.fetchContent('instagram-graph', {}))
      .rejects.toThrow(/accessToken/);
  });

  it('instagram-graph: maps media_url → imageUrl', async () => {
    mockFetchOwnMedia.mockResolvedValue([
      { id: '1', mediaUrl: 'https://cdn/x.jpg', caption: 'c', permalink: 'p', timestamp: 't', mediaType: 'IMAGE' },
    ]);
    const r = await sources.fetchContent('instagram-graph', { accessToken: 'tok' });
    expect(r[0].imageUrl).toBe('https://cdn/x.jpg');
    expect(r[0].sourceId).toBe('1');
    expect(r[0].source).toBe('instagram-graph');
  });

  it('instagram-user: requires both igUserId and accessToken', async () => {
    await expect(sources.fetchContent('instagram-user', { igUserId: '1' }))
      .rejects.toThrow(/accessToken/);
    await expect(sources.fetchContent('instagram-user', { accessToken: 't' }))
      .rejects.toThrow(/igUserId/);
  });

  it('instagram-user: delegates to fetchUserMedia', async () => {
    mockFetchUserMedia.mockResolvedValue([]);
    await sources.fetchContent('instagram-user', { igUserId: '99', accessToken: 'tok' });
    expect(mockFetchUserMedia).toHaveBeenCalledWith({
      igUserId: '99', accessToken: 'tok',
    });
  });
});

describe('sources.fetchAndSave', () => {
  it('downloads all found and returns downloaded[]', async () => {
    mockFetchPinterest.mockResolvedValue([
      { imageUrl: 'https://i.pinimg.com/a.jpg' },
      { imageUrl: 'https://i.pinimg.com/b.jpg' },
    ]);
    mockDownloadImage.mockImplementation(async (url, dir) => ({
      path: path.join(dir, `file-${Math.random()}.jpg`),
      filename: 'x.jpg', sizeBytes: 100, sizeKB: 0,
      contentType: 'image/jpeg', sourceUrl: url,
    }));

    const r = await sources.fetchAndSave(
      'pinterest',
      { boardUrl: 'https://www.pinterest.com/u/b/' },
      tmpDir,
    );
    expect(r.downloaded).toHaveLength(2);
    expect(r.failed).toHaveLength(0);
  });

  it('partial failure: keeps going, collects failed[]', async () => {
    mockFetchPinterest.mockResolvedValue([
      { imageUrl: 'https://i.pinimg.com/a.jpg' },
      { imageUrl: 'https://i.pinimg.com/b.jpg' },
      { imageUrl: 'https://i.pinimg.com/c.jpg' },
    ]);
    mockDownloadImage
      .mockResolvedValueOnce({ path: '/x/a.jpg', filename: 'a.jpg', sizeBytes: 1, sizeKB: 0, contentType: 'image/jpeg', sourceUrl: 'a' })
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce({ path: '/x/c.jpg', filename: 'c.jpg', sizeBytes: 1, sizeKB: 0, contentType: 'image/jpeg', sourceUrl: 'c' });

    const r = await sources.fetchAndSave(
      'pinterest',
      { boardUrl: 'https://www.pinterest.com/u/b/' },
      tmpDir,
    );
    expect(r.downloaded).toHaveLength(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toBe('HTTP 404');
  });

  it('calls onProgress for each downloaded item', async () => {
    mockFetchPinterest.mockResolvedValue([
      { imageUrl: 'https://i.pinimg.com/a.jpg' },
      { imageUrl: 'https://i.pinimg.com/b.jpg' },
    ]);
    mockDownloadImage.mockImplementation(async (url, dir) => ({
      path: path.join(dir, 'f.jpg'), filename: 'f.jpg', sizeBytes: 1, sizeKB: 0,
      contentType: 'image/jpeg', sourceUrl: url,
    }));

    const progress = vi.fn();
    await sources.fetchAndSave(
      'pinterest',
      { boardUrl: 'https://www.pinterest.com/u/b/' },
      tmpDir,
      { onProgress: progress },
    );
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('returns empty when source returns nothing', async () => {
    mockFetchPinterest.mockResolvedValue([]);
    const r = await sources.fetchAndSave('pinterest', { boardUrl: 'https://www.pinterest.com/u/b/' }, tmpDir);
    expect(r).toEqual({ downloaded: [], failed: [], skipped: 0 });
  });
});
